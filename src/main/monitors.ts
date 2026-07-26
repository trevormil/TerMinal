import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { writeJsonAtomic } from './atomic-write'
import { join } from 'node:path'
import { homedir } from 'node:os'

// The Monitoring subsystem's app-side surface: config + latest state, read by
// the Monitoring tab and the bridge. The DAEMON (bin/terminal-monitor) owns all
// writes to state and does the probing — this module never runs a check. Pure,
// deterministic infrastructure observability: NO inference, NOT runs/agents.

export type MonitorType = 'http' | 'tls-cert' | 'tcp' | 'dns' | 'command'
export type MonitorState = 'ok' | 'warn' | 'fail'
export type Severity = 'urgent' | 'normal' | 'low'

export type MonitorNotify = {
  /** Severity filed to the Inbox when the check starts failing. 'off' = silent. */
  onFailure: Severity | 'off'
  /** File a low-severity recovery item when it goes back to ok. */
  onRecovery: boolean
  /** Re-file a still-failing check this often (0 = once, never re-nag). */
  renotifyAfterSec: number
  /** A daily digest of this monitor's status at digestHour (local). */
  dailyDigest: boolean
  digestHour: number
}

export type Monitor = {
  id: string
  name: string
  type: MonitorType
  /** URL / host:port / hostname / command — the thing being checked. */
  target: string
  intervalSec: number
  enabled: boolean
  group?: string
  notify: MonitorNotify
  /** Type-specific knobs (thresholds, expected status, etc.). */
  config: Record<string, unknown>
}

export type MonitorStatus = {
  id: string
  status: MonitorState
  summary: string
  metrics?: Record<string, unknown>
  /** Generic drill-in the phone/desktop render without knowing the type. */
  detail?: {
    sections: {
      title: string
      items: { label: string; health: string; meta?: Record<string, unknown> }[]
    }[]
  }
  lastCheckedAt: number
  since: number
  lastTransition: { from: MonitorState; to: MonitorState; at: number } | null
  history: { at: number; status: MonitorState }[]
}

const CFG = join(homedir(), '.config', 'TerMinal')
export const MONITORS_FILE = join(CFG, 'monitors.json')
export const MONITOR_STATE_DIR = join(CFG, 'monitor-state')

// ---- pure classifiers (the check logic — unit tested) ----------------------

/** HTTP status → health. 2xx/3xx ok, 4xx warn, 5xx/none fail. A latency over
 *  the threshold downgrades ok→warn. */
export function classifyHttp(
  status: number | null,
  latencyMs: number | null,
  warnLatencyMs?: number,
): MonitorState {
  if (status === null || status >= 500) return 'fail'
  if (status >= 400) return 'warn'
  if (warnLatencyMs && latencyMs !== null && latencyMs > warnLatencyMs) return 'warn'
  return 'ok'
}

/** Days-until-expiry → health. Past due or unreadable = fail. */
export function classifyCert(
  daysRemaining: number | null,
  warnDays = 15,
  critDays = 5,
): MonitorState {
  if (daysRemaining === null) return 'fail'
  if (daysRemaining < 0 || daysRemaining <= critDays) return 'fail'
  if (daysRemaining <= warnDays) return 'warn'
  return 'ok'
}

/** A command check maps exit code → health (0 ok, else fail), unless it printed
 *  a `{status}` JSON, which wins. */
export function classifyCommand(exitCode: number, parsedStatus?: string): MonitorState {
  if (parsedStatus === 'ok' || parsedStatus === 'warn' || parsedStatus === 'fail')
    return parsedStatus
  return exitCode === 0 ? 'ok' : 'fail'
}

/** Whether a transition warrants re-filing to the Inbox: any status change, or
 *  a still-failing check whose renotify window has elapsed. */
export function shouldNotify(
  prev: MonitorStatus | null,
  next: MonitorState,
  now: number,
  renotifyAfterSec: number,
): boolean {
  const prevStatus = prev?.status ?? 'ok'
  if (prevStatus !== next) return true
  if (next === 'ok') return false
  if (!renotifyAfterSec) return false
  const since = prev?.since ?? now
  const lastAt = prev?.lastTransition?.at ?? since
  return now - lastAt >= renotifyAfterSec * 1000
}

// ---- config + state IO -----------------------------------------------------

export function readMonitors(file = MONITORS_FILE): Monitor[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.id === 'string') : []
  } catch {
    return []
  }
}

export function writeMonitors(list: Monitor[], file = MONITORS_FILE): void {
  mkdirSync(CFG, { recursive: true })
  writeJsonAtomic(file, list)
}

export function readMonitorStatus(id: string, dir = MONITOR_STATE_DIR): MonitorStatus | null {
  try {
    return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/** Every monitor joined with its latest status, worst-first for the UI. */
export function listMonitorsWithStatus(
  file = MONITORS_FILE,
  dir = MONITOR_STATE_DIR,
): (Monitor & { state: MonitorStatus | null })[] {
  const rank: Record<MonitorState, number> = { fail: 0, warn: 1, ok: 2 }
  return readMonitors(file)
    .map((m) => ({ ...m, state: readMonitorStatus(m.id, dir) }))
    .sort((a, b) => {
      const ra = a.state ? rank[a.state.status] : 3
      const rb = b.state ? rank[b.state.status] : 3
      return ra - rb || (b.state?.lastCheckedAt ?? 0) - (a.state?.lastCheckedAt ?? 0)
    })
}

/** Orphaned state files (monitor deleted) — for the daemon to prune. */
export function orphanStateIds(dir = MONITOR_STATE_DIR): string[] {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const known = new Set(readMonitors().map((m) => m.id))
  return files.map((f) => f.slice(0, -5)).filter((id) => !known.has(id))
}

export const DEFAULT_NOTIFY: MonitorNotify = {
  onFailure: 'urgent',
  onRecovery: true,
  renotifyAfterSec: 3600,
  dailyDigest: false,
  digestHour: 9,
}
