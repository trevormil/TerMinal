import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// plugin/bin/forge stopped being seeded per-repo (.claude/forge) — resolution
// is now: legacy repo file → sidecar override → $FORGE → origin autodetect →
// github. Run the real script against fixture repos so every layer is pinned.

const FORGE = join(import.meta.dir, '..', 'plugin', 'bin', 'forge')

let tmp: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'forge-')))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function repoWithOrigin(url: string): string {
  const dir = join(tmp, `r${Math.abs(Buffer.from(url).reduce((a, b) => a + b, 0))}`)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url], { stdio: 'ignore' })
  return dir
}

const run = (cwd: string, env: Record<string, string> = {}) => {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(TERMINAL_|FORGE$)/.test(k)),
  )
  return execFileSync('bash', [FORGE], { cwd, encoding: 'utf8', env: { ...clean, ...env } }).trim()
}

describe('forge resolution without any per-repo seed', () => {
  test('autodetects github from origin', () => {
    expect(run(repoWithOrigin('https://github.com/o/r.git'))).toBe('github')
  })

  test('autodetects gitlab from origin (incl. self-hosted with gitlab in host)', () => {
    expect(run(repoWithOrigin('git@gitlab.example.com:o/r.git'))).toBe('gitlab')
  })

  test('$FORGE env is the top override (explicit per-invocation intent)', () => {
    const repo = repoWithOrigin('https://github.com/o/r.git')
    const sidecar = join(tmp, 'sidecar')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'forge'), 'github\n')
    expect(run(repo, { FORGE: 'gitlab', TERMINAL_STATE_DIR: sidecar })).toBe('gitlab')
  })

  test('sidecar forge file overrides autodetect and the legacy repo file', () => {
    const repo = repoWithOrigin('https://github.com/o/r.git')
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'forge'), 'github\n')
    const sidecar = join(tmp, 'sidecar')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'forge'), 'gitlab\n')
    expect(run(repo, { TERMINAL_STATE_DIR: sidecar })).toBe('gitlab')
  })

  test('legacy .claude/forge still wins when present', () => {
    const repo = repoWithOrigin('https://github.com/o/r.git')
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'forge'), 'gitlab\n')
    expect(run(repo)).toBe('gitlab')
  })

  test('no origin at all falls back to github', () => {
    const dir = join(tmp, 'bare')
    mkdirSync(dir, { recursive: true })
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
    expect(run(dir)).toBe('github')
  })

  test('GitHub Enterprise hosts autodetect as github', () => {
    expect(run(repoWithOrigin('https://github.mycorp.com/o/r.git'))).toBe('github')
  })

  test('an unrecognized self-hosted origin defaults to gitlab (matches the app)', () => {
    expect(run(repoWithOrigin('https://git.example.com/o/r.git'))).toBe('gitlab')
  })

  test('documented one-liner works on a fresh sidecar: echo > $(tm-state-dir forge)', () => {
    const repo = repoWithOrigin('https://github.com/o/fresh.git')
    const stateRoot = join(tmp, 'state-root') // does NOT exist yet
    const TSD = join(import.meta.dir, '..', 'plugin', 'bin', 'tm-state-dir')
    const p = execFileSync('bash', [TSD, 'forge'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !/^(TERMINAL_|FORGE$)/.test(k)),
        ),
        TERMINAL_REPO_STATE_DIR: stateRoot,
      },
    }).trim()
    // The parent dir must exist after resolution, or the documented
    // `echo gitlab > "$(tm-state-dir forge)"` fails with ENOENT.
    writeFileSync(p, 'gitlab\n')
    expect(run(repo, { TERMINAL_REPO_STATE_DIR: stateRoot })).toBe('gitlab')
  })
})
