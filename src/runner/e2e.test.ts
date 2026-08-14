import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HitlItem } from '../shared/types/activity'

// End-to-end over the BUILT artifact — the file launchd actually executes, not
// the modules it was built from. A bundling mistake (a missing entry, a dropped
// side effect, an ESM/CJS mismatch) typechecks and unit-tests perfectly and
// still produces a runner that dies on startup.
//
// Every path is a throwaway HOME; nothing here can see ~/.config/TerMinal.
const CRON = resolve(import.meta.dir, '../../bin/terminal-cron')

type Ran = { code: number; out: string; err: string; cfg: string; home: string }

function sandbox(): { home: string; cfg: string } {
  const home = mkdtempSync(join(tmpdir(), 'tm-cron-e2e-'))
  const cfg = join(home, '.config', 'TerMinal')
  mkdirSync(cfg, { recursive: true })
  return { home, cfg }
}

function run(where: { home: string; cfg: string }, args: string[]): Ran {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: where.home,
    TERMINAL_CONFIG_DIR: where.cfg,
  }
  // The suite preload points every test at a shared throwaway sidecar. Drop it
  // here so the runner resolves state the way it does in production — under the
  // config dir — which is half of what these tests are checking.
  delete env.TERMINAL_REPO_STATE_DIR
  const r = spawnSync('bun', [CRON, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr, ...where }
}

const cronLog = (cfg: string): string => {
  try {
    return readFileSync(join(cfg, 'cron.log'), 'utf8')
  } catch {
    return ''
  }
}
const hitl = (cfg: string): HitlItem[] => {
  try {
    return JSON.parse(readFileSync(join(cfg, 'hitl.json'), 'utf8')) as HitlItem[]
  } catch {
    return []
  }
}

const SCHEDULE = {
  id: 's1',
  repoRoot: '/definitely/not/a/repo',
  repoLabel: 'repo',
  agentId: 'nightly',
  agentTitle: 'Nightly',
  engine: 'codex',
  prompt: 'p',
  spec: { kind: 'cron', expr: '0 9 * * *' },
  enabled: true,
  createdAt: 1,
}

describe('bin/terminal-cron end to end', () => {
  test('no action prints usage and exits 2', () => {
    const r = run(sandbox(), [])
    expect(r.code).toBe(2)
    expect(r.err).toContain('usage: terminal-cron run <scheduleId>')
    expect(r.err).toContain('terminal-cron watchdog')
  })

  test('retention prints its JSON summary and exits 0', () => {
    const box = sandbox()
    writeFileSync(join(box.cfg, 'monitor.log'), 'x\n')
    const r = run(box, ['retention'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toMatchObject({ logBytes: 0, leftoverBytes: 0, archived: 0 })
    expect(cronLog(box.cfg)).toContain('retention: logs=0B')
  })

  test('watchdog ticks, logs its counts and appends an activity event', () => {
    const box = sandbox()
    const r = run(box, ['watchdog'])
    expect(r.code).toBe(0)
    expect(cronLog(box.cfg)).toContain('watchdog: swept=0 overdue=0')
    const events = readFileSync(join(box.cfg, 'activity.jsonl'), 'utf8').trim().split('\n')
    expect(JSON.parse(events[0])).toMatchObject({ kind: 'check' })
  })

  test('an unknown schedule id is a no-op success, not a crash', () => {
    const box = sandbox()
    writeFileSync(join(box.cfg, 'schedules.json'), '[]')
    const r = run(box, ['run', 'nosuch'])
    expect(r.code).toBe(0)
    expect(cronLog(box.cfg)).toContain('run: schedule nosuch not found — skipping')
  })

  test('a kill-switched schedule bails before touching the repo', () => {
    const box = sandbox()
    writeFileSync(join(box.cfg, 'schedules.json'), JSON.stringify([SCHEDULE]))
    mkdirSync(join(box.cfg, 'agents'), { recursive: true })
    writeFileSync(join(box.cfg, 'agents', 'disabled.json'), JSON.stringify({ scheduleIds: ['s1'] }))
    const r = run(box, ['run', 's1'])
    expect(r.code).toBe(0)
    expect(cronLog(box.cfg)).toContain('kill-switched')
    expect(existsSync(join(box.cfg, 'cron-runs'))).toBe(true)
    expect(readdirSync(join(box.cfg, 'cron-runs'))).toEqual([])
  })

  test('a run whose worktree cannot be created fails LOUDLY: exit 1, record, Inbox item, ticket', () => {
    const box = sandbox()
    writeFileSync(join(box.cfg, 'schedules.json'), JSON.stringify([SCHEDULE]))
    writeFileSync(join(box.cfg, 'hitl.json'), '[]')

    const r = run(box, ['run', 's1'])

    // Exit code is the contract with launchd: a failed run must not look
    // like a successful one (tickets 100/101).
    expect(r.code).toBe(1)

    const runs = readdirSync(join(box.cfg, 'cron-runs')).filter((f) => f.endsWith('.json'))
    expect(runs.length).toBe(1)
    const rec = JSON.parse(readFileSync(join(box.cfg, 'cron-runs', runs[0]), 'utf8'))
    expect(rec).toMatchObject({ status: 'failed', scheduleId: 's1', engine: 'codex' })
    expect(String(rec.error)).toContain('worktree failed')

    // lastRun/lastStatus stamped back onto the schedule, field-level.
    const sched = JSON.parse(readFileSync(join(box.cfg, 'schedules.json'), 'utf8'))
    expect(sched[0]).toMatchObject({ enabled: true, lastStatus: 'failed' })
    expect(sched[0].lastRun).toBeGreaterThan(0)

    const filed = hitl(box.cfg)
    expect(filed.length).toBe(1)
    expect(filed[0]).toMatchObject({ source: 'cron-fail', runSource: 'cron', status: 'open' })
    // The paired backlog ticket lands in the sidecar under the throwaway HOME.
    expect(filed[0].ticketPath).toContain(join(box.cfg, 'repos'))
    expect(readFileSync(filed[0].ticketPath as string, 'utf8')).toContain('source: cron-fail')
  })

  test('a second firing while one is running is refused rather than raced', () => {
    const box = sandbox()
    writeFileSync(join(box.cfg, 'schedules.json'), JSON.stringify([SCHEDULE]))
    writeFileSync(join(box.cfg, 'hitl.json'), '[]')
    mkdirSync(join(box.cfg, 'cron-runs'), { recursive: true })
    // A live run: this test's own pid, started long enough ago to be past the
    // sweep's warm-up grace, so it is NOT reaped first.
    writeFileSync(
      join(box.cfg, 'cron-runs', 'live.json'),
      JSON.stringify({
        id: 'live',
        scheduleId: 's1',
        status: 'running',
        startedAt: Date.now() - 60_000,
        pid: process.pid,
        branch: 'cron/live',
      }),
    )

    const r = run(box, ['run', 's1'])
    expect(r.code).toBe(0)
    expect(cronLog(box.cfg)).toContain('concurrent run blocked')
    expect(hitl(box.cfg)[0].title).toContain('Concurrent cron run blocked')
    // No new run record was opened.
    expect(readdirSync(join(box.cfg, 'cron-runs')).filter((f) => f.endsWith('.json'))).toEqual([
      'live.json',
    ])
  })
})
