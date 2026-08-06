import { readJsonState, updateJsonState } from './atomic-write'
import { configPath } from './config-dir'
import { randomUUID } from 'node:crypto'
import type { Engine } from './agents'
import type { ScheduleSpec } from './cron'

// Scheduled agent runs, backed by REAL launchd jobs (see launchd.ts). This file
// is just the store of record; the launchd layer mirrors enabled schedules into
// per-schedule LaunchAgents and the headless runner (bin/terminal-cron) executes
// them. Each schedule snapshots everything the runner needs so it stays
// self-contained (no app import at run time).
export const schedulesFile = (): string => configPath('schedules.json')

export type ScheduleStatus = 'never' | 'running' | 'done' | 'failed'
export type Schedule = {
  id: string
  repoRoot: string
  repoLabel: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string // optional per-engine model alias (claude: haiku/sonnet/opus; codex: model name). Cron runner passes as --model <name>.
  effort?: string // optional reasoning-effort level; cron runner passes the engine's native flag (claude --effort / codex -c model_reasoning_effort / pi --thinking / or-agent --effort)
  prompt: string // snapshot of the agent prompt at save time (runner uses this)
  spec: ScheduleSpec
  enabled: boolean
  /**
   * Where this schedule fires (ADR-0002). Absent → local, triggered by launchd.
   * A hostId referencing settings.remoteHosts[] → fired by a systemd --user timer
   * on that always-on host (never a literal host name). The trigger layer is
   * chosen by the resolved host's `platform`, routed in schedule-router.ts.
   */
  host?: string
  /**
   * Execution substrate on the target host (ADR-0002 C3). Absent/`bare` → the
   * runner spawns the engine directly in a git worktree (default). `container` →
   * the run executes in a Docker image whose entrypoint dispatches the engine
   * (opt-in; the same image is the future DOKS CronJob artifact). Landed in #13.
   */
  runtime?: 'bare' | 'container' | 'k8s'
  /**
   * Per-schedule environment variables. Spread into the spawned wrapper's env
   * after the standard TERMINAL_* keys, so the schedule can pin parameterized
   * inputs the agent prompt depends on (e.g. BEACON_PROJECT=bolt to drain a
   * specific project, RELEASE_CHANNEL=canary, etc). NOT a place for secrets
   * the agent itself shouldn't see — TerMinal launches the wrapper in the
   * user's shell, so these are visible to the spawned engine.
   */
  env?: Record<string, string>
  /**
   * Optional per-schedule retry policy for flaky runs. When a run exits
   * non-zero, the headless runner (bin/terminal-cron) retries up to
   * `maxRetries` more times with exponential backoff before finalizing the run
   * as failed (and only then filing HITL / tripping the circuit breaker).
   * Absent → the runner's built-in defaults.
   */
  retry?: { maxRetries: number; backoffSec: number }
  /**
   * Optional hard wall-clock cap (seconds) on a single run attempt. The runner
   * kills a run that exceeds it and treats the timeout as a (retryable)
   * failure. Absent → the runner's built-in default.
   */
  timeoutSec?: number
  createdAt: number
  lastRun?: number
  lastStatus?: ScheduleStatus
  lastRunId?: string
}

// Convert a legacy interval (everyMinutes) into an equivalent wall-clock cron
// expression. Sub-hour intervals that divide 60 map to `*/N`; whole-hour
// intervals that divide 24 map to `0 */H`; anything else falls back to hourly.
function intervalToCron(everyMinutes: number): string {
  const n = Math.max(1, Math.round(everyMinutes))
  if (n < 60) return `${60 % n === 0 ? `*/${n}` : '*'} * * * *`
  if (n % 60 === 0) {
    const h = n / 60
    if (h < 24 && 24 % h === 0) return `0 */${h} * * *`
  }
  return '0 * * * *' // hourly fallback
}

// Migrate legacy entries: {cadence: hourly|daily|weekly} and any stored
// {kind:'interval'} spec both fold into the calendar/cron model. Interval
// schedules no longer exist — StartInterval drifts, so everything is a
// wall-clock cron/calendar now.
function migrate(s: Record<string, unknown>, now: number): Schedule {
  const out = { ...s } as Record<string, unknown>
  if (!out.spec) {
    const cadence = out.cadence
    out.spec =
      cadence === 'hourly'
        ? { kind: 'cron', expr: '0 * * * *' }
        : cadence === 'weekly'
          ? { kind: 'calendar', minute: 0, hour: 9, weekdays: [1] }
          : { kind: 'calendar', minute: 0, hour: 9 } // daily default
    delete out.cadence
  }
  const spec = out.spec as Record<string, unknown> | undefined
  if (spec && spec.kind === 'interval') {
    out.spec = { kind: 'cron', expr: intervalToCron(Number(spec.everyMinutes) || 60) }
  }
  if (typeof out.createdAt !== 'number') out.createdAt = now
  if (typeof out.prompt !== 'string') out.prompt = ''
  return out as Schedule
}

export function readSchedules(now = Date.now()): Schedule[] {
  const raw = readJsonState<Record<string, unknown>[]>(schedulesFile(), () => [], {
    accept: Array.isArray,
  })
  return raw.value.map((s) => migrate(s, now))
}

/**
 * Locked read-modify-write over the schedule list.
 *
 * Every mutation goes through here on purpose. Four processes write this file,
 * and the classic failure is the cron runner stamping `lastRun` from a snapshot
 * it read before the user disabled the schedule — the write-back resurrects
 * `enabled: true` and a disabled job keeps firing. Re-reading under the lock
 * makes that impossible.
 */
function mutate(
  fn: (list: Schedule[]) => Schedule[] | undefined,
  now = Date.now(),
): Schedule[] | undefined {
  return updateJsonState<Schedule[]>(
    schedulesFile(),
    () => [],
    (raw) => fn((raw as unknown as Record<string, unknown>[]).map((s) => migrate(s, now))),
    { accept: Array.isArray },
  )
}

export function getSchedule(id: string): Schedule | null {
  return readSchedules().find((s) => s.id === id) || null
}

export type NewSchedule = Omit<
  Schedule,
  'id' | 'createdAt' | 'lastRun' | 'lastStatus' | 'lastRunId'
>

export function addSchedule(s: NewSchedule, now = Date.now()): Schedule {
  const sched: Schedule = { ...s, id: randomUUID(), createdAt: now, lastStatus: 'never' }
  mutate((list) => [...list, sched], now)
  return sched
}

// Seed a capability-module schedule INERT. Idempotent on (repoRoot, agentId) so
// re-seeding a module/profile never duplicates entries in the global store. Forces
// enabled:false — launchd.syncSchedule skips registration, so no plist is written
// until the user toggles it on from the Admin tab.
export function seedSchedule(s: NewSchedule, now = Date.now()): Schedule {
  const existing = readSchedules().find((x) => x.repoRoot === s.repoRoot && x.agentId === s.agentId)
  if (existing) return existing
  return addSchedule({ ...s, enabled: false }, now)
}

/**
 * Apply a FIELD-LEVEL patch to one schedule under the lock.
 *
 * Everything that changes a schedule goes through here, including the cron
 * runner stamping lastRun/lastStatus/lastRunId. Writing back a whole list read
 * minutes earlier is what resurrected `enabled: true` on a schedule the user had
 * just disabled (R1) — patching the freshly-read record makes that impossible.
 */
export function updateSchedule(id: string, patch: Partial<Schedule>): Schedule | null {
  let updated: Schedule | null = null
  mutate((list) => {
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) return undefined
    const next = [...list]
    next[i] = { ...next[i], ...patch, id } // id immutable
    updated = next[i]
    return next
  })
  return updated
}

export function removeSchedule(id: string): boolean {
  let removed = false
  mutate((list) => {
    const next = list.filter((s) => s.id !== id)
    removed = next.length !== list.length
    return removed ? next : undefined
  })
  return removed
}

export function toggleSchedule(id: string, enabled: boolean): boolean {
  return !!updateSchedule(id, { enabled })
}
