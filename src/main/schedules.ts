import { readJsonState, updateJsonState } from './atomic-write'
import { configPath } from './config-dir'
import { randomUUID } from 'node:crypto'
import type { Engine } from './agents'
import type { ScheduleSpec } from './cron'
import type { Schedule } from '../shared/types/schedules'
export type { Schedule, ScheduleStatus } from '../shared/types/schedules'

// Scheduled agent runs, backed by REAL launchd jobs (see launchd.ts). This file
// is just the store of record; the launchd layer mirrors enabled schedules into
// per-schedule LaunchAgents and the headless runner (bin/terminal-cron) executes
// them. Each schedule snapshots everything the runner needs so it stays
// self-contained (no app import at run time).
export const schedulesFile = (): string => configPath('schedules.json')

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
