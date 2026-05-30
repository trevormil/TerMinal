import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Engine } from './agents'
import type { ScheduleSpec } from './cron'

// Scheduled agent runs, backed by REAL launchd jobs (see launchd.ts). This file
// is just the store of record; the launchd layer mirrors enabled schedules into
// per-schedule LaunchAgents and the headless runner (bin/terminal-cron) executes
// them. Each schedule snapshots everything the runner needs so it stays
// self-contained (no app import at run time).
const FILE = join(homedir(), '.config', 'TerMinal', 'schedules.json')

export type ScheduleStatus = 'never' | 'running' | 'done' | 'failed'
export type Schedule = {
  id: string
  repoRoot: string
  repoLabel: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string // optional per-engine model alias (claude: haiku/sonnet/opus; codex: model name). Cron runner passes as --model <name>.
  prompt: string // snapshot of the agent prompt at save time (runner uses this)
  spec: ScheduleSpec
  enabled: boolean
  /**
   * Per-schedule environment variables. Spread into the spawned wrapper's env
   * after the standard TERMINAL_* keys, so the schedule can pin parameterized
   * inputs the agent prompt depends on (e.g. BEACON_PROJECT=bolt to drain a
   * specific project, RELEASE_CHANNEL=canary, etc). NOT a place for secrets
   * the agent itself shouldn't see — TerMinal launches the wrapper in the
   * user's shell, so these are visible to the spawned engine.
   */
  env?: Record<string, string>
  createdAt: number
  lastRun?: number
  lastStatus?: ScheduleStatus
  lastRunId?: string
}

// Migrate legacy {cadence: hourly|daily|weekly} entries to the spec model.
function migrate(s: Record<string, unknown>, now: number): Schedule {
  const out = { ...s } as Record<string, unknown>
  if (!out.spec) {
    const cadence = out.cadence
    out.spec =
      cadence === 'hourly'
        ? { kind: 'interval', everyMinutes: 60 }
        : cadence === 'weekly'
          ? { kind: 'calendar', minute: 0, hour: 9, weekdays: [1] }
          : { kind: 'calendar', minute: 0, hour: 9 } // daily default
    delete out.cadence
  }
  if (typeof out.createdAt !== 'number') out.createdAt = now
  if (typeof out.prompt !== 'string') out.prompt = ''
  return out as Schedule
}

export function readSchedules(now = Date.now()): Schedule[] {
  if (!existsSync(FILE)) return []
  try {
    const a = JSON.parse(readFileSync(FILE, 'utf8'))
    if (!Array.isArray(a)) return []
    return a.map((s) => migrate(s, now))
  } catch {
    return []
  }
}

function write(list: Schedule[]): boolean {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(list, null, 2))
    return true
  } catch {
    return false
  }
}

export function getSchedule(id: string): Schedule | null {
  return readSchedules().find((s) => s.id === id) || null
}

export type NewSchedule = Omit<Schedule, 'id' | 'createdAt' | 'lastRun' | 'lastStatus' | 'lastRunId'>

export function addSchedule(s: NewSchedule, now = Date.now()): Schedule {
  const sched: Schedule = { ...s, id: randomUUID(), createdAt: now, lastStatus: 'never' }
  write([...readSchedules(), sched])
  return sched
}

export function updateSchedule(id: string, patch: Partial<Schedule>): Schedule | null {
  const list = readSchedules()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  list[i] = { ...list[i], ...patch, id } // id immutable
  write(list)
  return list[i]
}

export function removeSchedule(id: string): boolean {
  return write(readSchedules().filter((s) => s.id !== id))
}

export function toggleSchedule(id: string, enabled: boolean): boolean {
  return write(readSchedules().map((s) => (s.id === id ? { ...s, enabled } : s)))
}
