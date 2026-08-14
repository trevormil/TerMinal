import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Schedule } from '../shared/types/schedules'
import { readDisabled, readDisabledReasons, writeDisabled } from './disabled'
import { readSchedules, stamp } from './schedules'
import { maybeCircuitBreak, recentRuns, sweepStaleRuns } from './runs'
import { fileTicket, localDay, ticketWriteDir } from './tickets'
import { SCHED_FILE, RUNS_DIR, DISABLED_FILE, HITL_FILE } from './config'
import type { HitlItem } from '../shared/types/activity'

const prevCfg = process.env.TERMINAL_CONFIG_DIR
const prevState = process.env.TERMINAL_REPO_STATE_DIR
afterEach(() => {
  if (prevCfg === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prevCfg
  if (prevState === undefined) delete process.env.TERMINAL_REPO_STATE_DIR
  else process.env.TERMINAL_REPO_STATE_DIR = prevState
})

function sandbox(): string {
  const cfg = join(mkdtempSync(join(tmpdir(), 'tm-runner-state-')), 'TerMinal')
  mkdirSync(cfg, { recursive: true })
  process.env.TERMINAL_CONFIG_DIR = cfg
  process.env.TERMINAL_REPO_STATE_DIR = join(cfg, 'repos')
  return cfg
}

const sched = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 's1',
    repoRoot: '/repo',
    repoLabel: 'repo',
    agentId: 'nightly',
    agentTitle: 'Nightly',
    engine: 'codex',
    prompt: 'p',
    spec: { kind: 'cron', expr: '0 9 * * *' },
    enabled: true,
    createdAt: 0,
    ...over,
  }) as Schedule

const writeRun = (cfg: string, rec: Record<string, unknown>): string => {
  mkdirSync(RUNS_DIR(), { recursive: true })
  const p = join(RUNS_DIR(), `${rec.id as string}.json`)
  writeFileSync(p, JSON.stringify(rec))
  return p
}
const hitl = (): HitlItem[] => JSON.parse(readFileSync(HITL_FILE(), 'utf8')) as HitlItem[]

describe('schedules', () => {
  test('a torn schedules.json reads as no schedules, never a crash', () => {
    sandbox()
    writeFileSync(SCHED_FILE(), '[{"id":')
    expect(readSchedules()).toEqual([])
    writeFileSync(SCHED_FILE(), '{"not":"a list"}')
    expect(readSchedules()).toEqual([])
  })

  test('stamp patches FIELDS — it never writes back the list it read', () => {
    sandbox()
    writeFileSync(SCHED_FILE(), JSON.stringify([sched(), sched({ id: 's2' })]))
    // What the app does while the runner holds a stale snapshot: disable s1.
    const disable = (): void => {
      const list = JSON.parse(readFileSync(SCHED_FILE(), 'utf8')) as Schedule[]
      list[0].enabled = false
      writeFileSync(SCHED_FILE(), JSON.stringify(list))
    }
    disable()
    stamp('s1', { lastRun: 42, lastStatus: 'running' })
    const after = readSchedules()
    // The bug this exists to prevent: resurrecting enabled:true on a schedule
    // the user just disabled, so the job keeps firing.
    expect(after[0].enabled).toBe(false)
    expect(after[0].lastRun).toBe(42)
    expect(after[1].id).toBe('s2')
  })

  test('stamping an id that is gone writes nothing rather than appending it', () => {
    sandbox()
    writeFileSync(SCHED_FILE(), JSON.stringify([sched()]))
    stamp('deleted', { lastStatus: 'failed' })
    expect(readSchedules().map((s) => s.id)).toEqual(['s1'])
  })
})

describe('kill switch', () => {
  test('the legacy bare-array shape still disables', () => {
    sandbox()
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    writeFileSync(DISABLED_FILE(), JSON.stringify(['s1']))
    expect(readDisabled().has('s1')).toBe(true)
    expect(readDisabledReasons()).toEqual({})
  })

  test('a reason recorded by the UI survives a runner-side write', () => {
    sandbox()
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    writeFileSync(
      DISABLED_FILE(),
      JSON.stringify({ scheduleIds: ['ui'], reasons: { ui: { reason: 'by hand', at: 1 } } }),
    )
    writeDisabled(new Set(['ui', 's1']), { s1: { reason: 'auto', at: 2 } })
    const back = readDisabledReasons()
    expect(back.ui).toEqual({ reason: 'by hand', at: 1 })
    expect(back.s1.reason).toBe('auto')
  })

  test('a reason for an id no longer disabled is dropped, not kept forever', () => {
    sandbox()
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    writeDisabled(new Set(['a']), { a: { reason: 'x', at: 1 } })
    writeDisabled(new Set([]), {})
    expect(readDisabledReasons()).toEqual({})
  })
})

describe('stale run sweep', () => {
  test('a run whose pid is dead is reaped after the warm-up grace period', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    writeFileSync(SCHED_FILE(), JSON.stringify([sched()]))
    const p = writeRun(cfg, {
      id: 'dead',
      scheduleId: 's1',
      status: 'running',
      startedAt: Date.now() - 60_000,
      pid: 999_999,
      agentTitle: 'Nightly',
      branch: 'cron/x',
    })
    expect(sweepStaleRuns()).toBe(1)
    const rec = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    expect(rec.status).toBe('failed')
    expect(String(rec.error)).toContain('dead process')
    expect(readSchedules()[0].lastStatus).toBe('failed')
    expect(hitl()[0].title).toContain('Cron run stale')
  })

  test('a just-spawned run inside the grace window is left alone', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    writeRun(cfg, { id: 'warm', status: 'running', startedAt: Date.now() - 2_000, pid: 999_999 })
    expect(sweepStaleRuns()).toBe(0)
  })

  test('a LIVE run is never reaped, however the record looks', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    writeRun(cfg, {
      id: 'live',
      status: 'running',
      startedAt: Date.now() - 60_000,
      pid: process.pid,
    })
    expect(sweepStaleRuns()).toBe(0)
  })

  test('a pid-less run is reaped only after the 2h fallback', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    writeRun(cfg, { id: 'old', status: 'running', startedAt: Date.now() - 3 * 60 * 60 * 1000 })
    writeRun(cfg, { id: 'recent', status: 'running', startedAt: Date.now() - 60 * 60 * 1000 })
    expect(sweepStaleRuns()).toBe(1)
  })

  test('an unparseable run file is skipped, not fatal to the sweep', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    mkdirSync(RUNS_DIR(), { recursive: true })
    writeFileSync(join(RUNS_DIR(), 'torn.json'), '{"id":')
    writeRun(cfg, { id: 'dead', status: 'running', startedAt: Date.now() - 60_000, pid: 999_999 })
    expect(sweepStaleRuns()).toBe(1)
  })
})

describe('circuit breaker', () => {
  const failRun = (cfg: string, id: string, startedAt: number): void => {
    writeRun(cfg, { id, scheduleId: 's1', status: 'failed', startedAt })
  }

  test('three consecutive failures disable the schedule and file an Inbox item', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    for (let i = 0; i < 3; i++) failRun(cfg, `f${i}`, Date.now() - i * 1000)
    expect(maybeCircuitBreak('s1', sched())).toBe(true)
    expect(readDisabled().has('s1')).toBe(true)
    expect(hitl()[0].title).toContain('Circuit broken')
  })

  test('a success inside the window keeps it closed — the breaker is CONSECUTIVE', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    failRun(cfg, 'f0', Date.now() - 3000)
    failRun(cfg, 'f1', Date.now() - 2000)
    writeRun(cfg, { id: 'ok', scheduleId: 's1', status: 'done', startedAt: Date.now() - 1000 })
    expect(maybeCircuitBreak('s1', sched())).toBe(false)
    expect(readDisabled().has('s1')).toBe(false)
  })

  test('another schedule s failures never trip this one', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    for (let i = 0; i < 3; i++)
      writeRun(cfg, { id: `o${i}`, scheduleId: 'other', status: 'failed', startedAt: i })
    expect(recentRuns('s1')).toEqual([])
    expect(maybeCircuitBreak('s1', sched())).toBe(false)
  })

  test('an already-disabled schedule is not re-filed on every tick', () => {
    const cfg = sandbox()
    writeFileSync(HITL_FILE(), '[]')
    mkdirSync(join(DISABLED_FILE(), '..'), { recursive: true })
    for (let i = 0; i < 3; i++) failRun(cfg, `f${i}`, Date.now() - i * 1000)
    expect(maybeCircuitBreak('s1', sched())).toBe(true)
    expect(maybeCircuitBreak('s1', sched())).toBe(false)
    expect(hitl().length).toBe(1)
  })
})

describe('ticket filing', () => {
  const gitRepo = (): string => {
    const repo = mkdtempSync(join(tmpdir(), 'tm-ticket-repo-'))
    execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' })
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/o/t.git'], {
      stdio: 'ignore',
    })
    return repo
  }

  test('a ticket lands in the SIDECAR, never back in the repo', () => {
    const cfg = sandbox()
    const repo = gitRepo()
    const path = fileTicket(repo, { title: 'Cron run failed: X', body: 'why' })
    expect(path).toBe(join(cfg, 'repos', 'github.com/o/t', 'backlog', '0001-cron-run-failed-x.md'))
    const md = readFileSync(path as string, 'utf8')
    expect(md).toContain('source: cron-fail')
    expect(md).toContain(`created: ${localDay()}`)
    expect(readdirSync(repo).includes('backlog')).toBe(false)
  })

  test('ids continue past what the repo already holds, so two tickets never share one', () => {
    sandbox()
    const repo = gitRepo()
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(join(repo, 'backlog', '0042-old.md'), '')
    const path = fileTicket(repo, { title: 'next', body: '' })
    expect(path).toEndWith('0043-next.md')
  })

  test('a provider that cannot be served from a script FAILS CLOSED', () => {
    const cfg = sandbox()
    const repo = gitRepo()
    const sidecar = join(cfg, 'repos', 'github.com/o/t')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'tickets.json'), JSON.stringify({ provider: 'linear' }))
    expect(ticketWriteDir(repo)).toBeNull()
    // Misrouting a write is worse than refusing it (ADR-0015).
    expect(fileTicket(repo, { title: 'x', body: '' })).toBeNull()
  })

  test('an obsidian repo files into its vault, not the backlog', () => {
    const cfg = sandbox()
    const repo = gitRepo()
    const vault = mkdtempSync(join(tmpdir(), 'tm-vault-'))
    const sidecar = join(cfg, 'repos', 'github.com/o/t')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(
      join(sidecar, 'tickets.json'),
      JSON.stringify({ provider: 'obsidian', obsidian: { vaultPath: vault } }),
    )
    expect(fileTicket(repo, { title: 'x', body: '' })).toBe(join(vault, 'tickets', '0001-x.md'))
  })

  test('a title with no usable characters still produces a filename', () => {
    sandbox()
    const repo = gitRepo()
    expect(fileTicket(repo, { title: '!!!', body: '' })).toEndWith('0001-cron-fail.md')
  })
})
