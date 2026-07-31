import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveResolvedHitl,
  rotateLogFile,
  sweepTerminalState,
  type TerminalStateSweepOptions,
} from './run-retention'

// Retention deletes user data, so every case here pins the SAFETY property as
// hard as the reclaim property: what must survive, not just what goes away.
const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-retention-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const DAY = 24 * 60 * 60 * 1000
function writeBytes(path: string, bytes: number, ageDays = 0): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 'x'))
  if (ageDays) {
    const t = (Date.now() - ageDays * DAY) / 1000
    utimesSync(path, t, t)
  }
}
function ageDir(path: string, days: number): void {
  const t = (Date.now() - days * DAY) / 1000
  utimesSync(path, t, t)
}
// Budgets big enough that nothing is reclaimed by SIZE — isolates the axis
// under test from the pre-existing size sweep.
const noSizePressure: TerminalStateSweepOptions = {
  cronWorktreesMaxBytes: 1e12,
  checkpointGcMinBytes: 1e12,
}

describe('age-based worktree retention', () => {
  test('an old finished worktree is reclaimable even when the size budget is not exceeded', async () => {
    const root = tempRoot()
    const old = join(root, 'cron-worktrees', 'old-run')
    const recent = join(root, 'cron-worktrees', 'recent-run')
    writeBytes(join(old, 'f.bin'), 10)
    writeBytes(join(recent, 'f.bin'), 10)
    ageDir(old, 45)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      worktreeMaxAgeMs: 30 * DAY,
    })
    expect(report.worktrees.planned.map((e) => e.path)).toEqual([old])
    expect(existsSync(old)).toBe(true)
  })

  test('a RUNNING worktree is never reclaimed, however old it is', async () => {
    const root = tempRoot()
    const running = join(root, 'cron-worktrees', 'running-run')
    writeBytes(join(running, 'f.bin'), 10)
    ageDir(running, 400)
    mkdirSync(join(root, 'cron-runs'), { recursive: true })
    writeFileSync(
      join(root, 'cron-runs', 'r.json'),
      JSON.stringify({ id: 'r', status: 'running', worktree: running }),
    )

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      worktreeMaxAgeMs: 1,
    })
    expect(report.worktrees.deleted).toHaveLength(0)
    expect(report.worktrees.protectedRunning.map((e) => e.path)).toEqual([running])
    expect(existsSync(running)).toBe(true)
  })

  test('the SHIPPED default age budget is 30 days — the policy callers actually get', async () => {
    // index.ts calls sweepTerminalState with no retention options at all, so the
    // default is the real policy. Pin both sides of the boundary.
    const root = tempRoot()
    const justUnder = join(root, 'cron-worktrees', 'day-29')
    const justOver = join(root, 'cron-worktrees', 'day-31')
    writeBytes(join(justUnder, 'f.bin'), 10)
    writeBytes(join(justOver, 'f.bin'), 10)
    ageDir(justUnder, 29)
    ageDir(justOver, 31)

    const report = await sweepTerminalState(root, { ...noSizePressure, dryRun: true })
    expect(report.worktrees.planned.map((e) => e.path)).toEqual([justOver])
  })

  test('the agent-worktrees store is off when no directory resolves', async () => {
    const root = tempRoot()
    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      agentWorktreesDir: '',
    })
    expect(report.agentWorktrees.dir).toBe('')
    expect(report.agentWorktrees.planned).toHaveLength(0)
  })
})

describe('agent worktrees under <projectsDir>/.worktrees (ticket 69 P8)', () => {
  test('an old agent worktree is reported and reclaimable', async () => {
    const root = tempRoot()
    const projects = tempRoot()
    const stale = join(projects, '.worktrees', 'SomeRepo', 'feat-x')
    writeBytes(join(stale, 'f.bin'), 20)
    ageDir(stale, 60)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      worktreeMaxAgeMs: 30 * DAY,
      agentWorktreesDir: join(projects, '.worktrees'),
    })
    expect(report.agentWorktrees.planned.map((e) => e.path)).toEqual([stale])
    expect(report.agentWorktrees.bytes).toBeGreaterThanOrEqual(20)
  })

  test('an agent worktree belonging to a running run is protected', async () => {
    const root = tempRoot()
    const projects = tempRoot()
    const live = join(projects, '.worktrees', 'SomeRepo', 'feat-live')
    writeBytes(join(live, 'f.bin'), 20)
    ageDir(live, 60)
    mkdirSync(join(root, 'agent-runs'), { recursive: true })
    writeFileSync(
      join(root, 'agent-runs', 'a.json'),
      JSON.stringify({ id: 'a', status: 'running', worktree: live }),
    )

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      worktreeMaxAgeMs: 1,
      agentWorktreesDir: join(projects, '.worktrees'),
    })
    expect(report.agentWorktrees.deleted).toHaveLength(0)
    expect(report.agentWorktrees.protectedRunning.map((e) => e.path)).toEqual([live])
    expect(existsSync(live)).toBe(true)
  })

  test('a worktree with uncommitted work is protected even when stale', async () => {
    const root = tempRoot()
    const projects = tempRoot()
    const dirty = join(projects, '.worktrees', 'SomeRepo', 'feat-dirty')
    writeBytes(join(dirty, 'f.bin'), 20)
    // A .git file marks a registered worktree; the guard below is what matters.
    writeFileSync(join(dirty, '.git'), 'gitdir: /nowhere\n')
    ageDir(dirty, 60)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      worktreeMaxAgeMs: 1,
      agentWorktreesDir: join(projects, '.worktrees'),
      isDirty: async (p: string) => p === dirty,
    })
    expect(report.agentWorktrees.deleted).toHaveLength(0)
    expect(report.agentWorktrees.protectedDirty.map((e) => e.path)).toEqual([dirty])
    expect(existsSync(dirty)).toBe(true)
  })

  test('the sweep never leaves the configured roots', async () => {
    const root = tempRoot()
    const outside = tempRoot()
    const victim = join(outside, 'precious')
    writeBytes(join(victim, 'f.bin'), 5)
    ageDir(victim, 999)

    // agentWorktreesDir points at `outside`, so `precious` is legitimately in
    // scope; anything ABOVE it must still be untouchable.
    await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      worktreeMaxAgeMs: 1,
      agentWorktreesDir: join(outside, 'nope'),
    })
    expect(existsSync(victim)).toBe(true)
  })
})

describe('write-path leftovers', () => {
  test('stale .tmp / .lock / .corrupt-* files are reported and cleaned', async () => {
    const root = tempRoot()
    writeBytes(join(root, 'monitors.json.tmp'), 30, 5)
    writeBytes(join(root, 'hitl.json.lock'), 3, 5)
    writeBytes(join(root, 'schedules.json.corrupt-1700000000000'), 40, 120)
    writeBytes(join(root, 'monitors.json'), 50)

    const dry = await sweepTerminalState(root, { ...noSizePressure, dryRun: true })
    expect(dry.leftovers.planned.map((e) => e.path).sort()).toEqual(
      [
        join(root, 'hitl.json.lock'),
        join(root, 'monitors.json.tmp'),
        join(root, 'schedules.json.corrupt-1700000000000'),
      ].sort(),
    )
    expect(existsSync(join(root, 'monitors.json.tmp'))).toBe(true)

    await sweepTerminalState(root, { ...noSizePressure, dryRun: false })
    expect(existsSync(join(root, 'monitors.json.tmp'))).toBe(false)
    // The real state file is not a leftover.
    expect(existsSync(join(root, 'monitors.json'))).toBe(true)
  })

  test('a FRESH lock is left alone — it may belong to a live writer', async () => {
    const root = tempRoot()
    writeBytes(join(root, 'hitl.json.lock'), 3)

    const report = await sweepTerminalState(root, { ...noSizePressure, dryRun: false })
    expect(report.leftovers.planned).toHaveLength(0)
    expect(existsSync(join(root, 'hitl.json.lock'))).toBe(true)
  })

  test('a RECENT quarantine file is kept — it is the only copy of the lost data', async () => {
    const root = tempRoot()
    writeBytes(join(root, 'hitl.json.corrupt-1700000000000'), 40, 2)

    const report = await sweepTerminalState(root, { ...noSizePressure, dryRun: true })
    expect(report.leftovers.planned).toHaveLength(0)
  })
})

describe('log rotation', () => {
  test('a log over budget is truncated to its most recent bytes', () => {
    const root = tempRoot()
    const log = join(root, 'monitor.log')
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n') + '\n'
    writeFileSync(log, lines)

    const res = rotateLogFile(log, 2000)
    expect(res.rotated).toBe(true)
    const after = readFileSync(log, 'utf8')
    expect(after.length).toBeLessThanOrEqual(2200)
    // The RECENT end is what you debug with, so that is what survives.
    expect(after).toContain('line 1999')
    expect(after).not.toContain('line 0\n')
    // Truncation must not split a line.
    expect(after.startsWith('line ')).toBe(true)
    // Previous contents are kept once, as a single .1 sibling.
    expect(readFileSync(`${log}.1`, 'utf8')).toContain('line 0')
  })

  test('a log under budget is untouched and leaves no .1 behind', () => {
    const root = tempRoot()
    const log = join(root, 'monitor.log')
    writeFileSync(log, 'small\n')
    expect(rotateLogFile(log, 1024).rotated).toBe(false)
    expect(readFileSync(log, 'utf8')).toBe('small\n')
    expect(existsSync(`${log}.1`)).toBe(false)
  })

  test('an absent log is a no-op, not an error', () => {
    expect(rotateLogFile(join(tempRoot(), 'nope.log'), 10).rotated).toBe(false)
  })

  test('the sweep rotates monitor.log and cron.log', async () => {
    const root = tempRoot()
    writeFileSync(join(root, 'monitor.log'), 'x\n'.repeat(5000))
    writeFileSync(join(root, 'cron.log'), 'y\n'.repeat(5000))

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      logMaxBytes: 1000,
    })
    expect(report.logs.rotated.map((e) => e.path).sort()).toEqual(
      [join(root, 'cron.log'), join(root, 'monitor.log')].sort(),
    )
    expect(readFileSync(join(root, 'monitor.log'), 'utf8').length).toBeLessThan(2000)
  })

  test('a dry run reports the rotation without performing it', async () => {
    const root = tempRoot()
    writeFileSync(join(root, 'monitor.log'), 'x\n'.repeat(5000))
    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      logMaxBytes: 1000,
    })
    expect(report.logs.planned).toHaveLength(1)
    expect(report.logs.rotated).toHaveLength(0)
    expect(readFileSync(join(root, 'monitor.log'), 'utf8').length).toBe(10000)
  })
})

describe('hitl archival', () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    source: 'manual',
    status: 'open',
    createdAt: Date.now(),
    ...over,
  })

  test('read items older than the window move to a dated archive; the live file shrinks', () => {
    const root = tempRoot()
    const file = join(root, 'hitl.json')
    const old = Date.now() - 120 * DAY
    writeFileSync(
      file,
      JSON.stringify([
        item('open-now'),
        item('read-old', { readAt: old, status: 'resolved', resolvedAt: old, createdAt: old }),
        item('read-recent', { readAt: Date.now(), status: 'resolved' }),
      ]),
    )

    const res = archiveResolvedHitl(file, { olderThanMs: 30 * DAY })
    expect(res.archived).toBe(1)
    const live = JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]
    expect(live.map((h) => h.id).sort()).toEqual(['open-now', 'read-recent'])

    const archives = readdirSync(join(root, 'hitl-archive'))
    expect(archives).toHaveLength(1)
    const archived = JSON.parse(readFileSync(join(root, 'hitl-archive', archives[0]), 'utf8'))
    expect(archived.map((h: { id: string }) => h.id)).toEqual(['read-old'])
  })

  test('an OPEN item is never archived, however old', () => {
    const root = tempRoot()
    const file = join(root, 'hitl.json')
    const old = Date.now() - 999 * DAY
    writeFileSync(file, JSON.stringify([item('ancient-blocker', { createdAt: old })]))

    expect(archiveResolvedHitl(file, { olderThanMs: DAY }).archived).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })

  test('a corrupt hitl.json is not archived and not rewritten', () => {
    const root = tempRoot()
    const file = join(root, 'hitl.json')
    writeFileSync(file, '[{"id":"real"},{"id"')
    expect(() => archiveResolvedHitl(file, { olderThanMs: DAY })).toThrow()
    expect(existsSync(join(root, 'hitl-archive'))).toBe(false)
  })

  test('archiving twice does not lose the first archive', () => {
    const root = tempRoot()
    const file = join(root, 'hitl.json')
    // A fixed `now` so both sweeps land in the same dated archive file.
    const now = 1_700_000_000_000
    const old = now - 120 * DAY
    const mk = (id: string) =>
      item(id, { readAt: old, status: 'resolved', resolvedAt: old, createdAt: old })
    writeFileSync(file, JSON.stringify([mk('a')]))
    archiveResolvedHitl(file, { olderThanMs: 30 * DAY, now })
    writeFileSync(file, JSON.stringify([mk('b')]))
    archiveResolvedHitl(file, { olderThanMs: 30 * DAY, now })

    const dir = join(root, 'hitl-archive')
    const all = readdirSync(dir).flatMap(
      (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string }[],
    )
    expect(all.map((h) => h.id).sort()).toEqual(['a', 'b'])
  })
})

describe('report totals', () => {
  test('reclaimableBytes counts every store, and a dry run deletes nothing', async () => {
    const root = tempRoot()
    const wt = join(root, 'cron-worktrees', 'old')
    writeBytes(join(wt, 'f.bin'), 100)
    ageDir(wt, 90)
    writeBytes(join(root, 'monitors.json.tmp'), 30, 5)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      worktreeMaxAgeMs: 30 * DAY,
    })
    expect(report.reclaimableBytes).toBeGreaterThanOrEqual(130)
    expect(report.reclaimedBytes).toBe(0)
    expect(existsSync(wt)).toBe(true)
    expect(existsSync(join(root, 'monitors.json.tmp'))).toBe(true)
  })
})

describe('checkpoint store retention', () => {
  test('a shadow repo untouched past the age budget is reclaimable; a recent one is not', async () => {
    const root = tempRoot()
    const stale = join(root, 'checkpoints', 'aaaa.git')
    const live = join(root, 'checkpoints', 'bbbb.git')
    writeBytes(join(stale, 'objects', 'pack', 'p.pack'), 100)
    writeBytes(join(live, 'objects', 'pack', 'p.pack'), 100)
    ageDir(stale, 200)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: true,
      checkpointMaxAgeMs: 90 * DAY,
    })
    expect(report.checkpoints.stores.planned.map((e) => e.path)).toEqual([stale])
    expect(existsSync(stale)).toBe(true)
  })

  test('reclaim deletes only the stale store', async () => {
    const root = tempRoot()
    const stale = join(root, 'checkpoints', 'aaaa.git')
    const live = join(root, 'checkpoints', 'bbbb.git')
    writeBytes(join(stale, 'objects', 'pack', 'p.pack'), 100)
    writeBytes(join(live, 'objects', 'pack', 'p.pack'), 100)
    ageDir(stale, 200)

    const report = await sweepTerminalState(root, {
      ...noSizePressure,
      dryRun: false,
      checkpointMaxAgeMs: 90 * DAY,
    })
    expect(report.checkpoints.stores.deleted.map((e) => e.path)).toEqual([stale])
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(live)).toBe(true)
  })

  test('the SHIPPED default keeps a store used within the last 90 days', async () => {
    const root = tempRoot()
    const recent = join(root, 'checkpoints', 'aaaa.git')
    writeBytes(join(recent, 'objects', 'pack', 'p.pack'), 100)
    ageDir(recent, 80)

    const report = await sweepTerminalState(root, { ...noSizePressure, dryRun: true })
    expect(report.checkpoints.stores.planned).toHaveLength(0)
  })
})
