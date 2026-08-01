import { execFile } from 'node:child_process'
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { updateJsonState } from './atomic-write'
import { join } from 'node:path'
import { terminalConfigDir } from './config-dir'

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

const CFG = (): string => terminalConfigDir()
export const MONITORS_FILE = (): string => join(CFG(), 'monitors.json')
export const MONITOR_STATE_DIR = (): string => join(CFG(), 'monitor-state')

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

/**
 * Fold certificate CHAIN VALIDITY into the expiry-based health (ticket 67 F-15).
 *
 * The TLS probe connects with `rejectUnauthorized: false` on purpose — you want
 * to be told a cert expires in 3 days even when the chain is already broken, and
 * a rejected handshake would report nothing at all. But the old probe then threw
 * the trust result away, so a self-signed cert, a wrong-hostname cert, or an
 * untrusted issuer all rendered as a plain green "88d until expiry". The monitor
 * was not merely silent about it; it actively asserted health.
 *
 * `warn`, not `fail`: an untrusted chain is often deliberate (an internal CA, a
 * staging box), and a monitor that hard-fails on it gets muted — after which it
 * detects nothing. Expiry still escalates to `fail` on its own schedule, and a
 * genuinely-bad chain is never allowed to read as `ok`.
 */
export function classifyCertTrust(expiryState: MonitorState, authorized: boolean): MonitorState {
  if (authorized) return expiryState
  return expiryState === 'ok' ? 'warn' : expiryState
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

export const DEFAULT_NOTIFY: MonitorNotify = {
  onFailure: 'urgent',
  onRecovery: true,
  renotifyAfterSec: 3600,
  dailyDigest: false,
  digestHour: 9,
}

// ---- probing (the daemon, not this process) --------------------------------

/** Where installMonitorDaemon puts the runner. */
export const MONITOR_BIN = (): string => join(CFG(), 'bin', 'terminal-monitor')

export type ProbeResult = { ok: boolean; error?: string }

/**
 * Ask the DAEMON to run one check, out of process and off the event loop.
 *
 * This was `execFileSync(..., { timeout: 40000 })` inline in the `monitors:run`
 * IPC handler, so a single "Run check" click on a hung endpoint froze the whole
 * main process — every window, session and timer — for up to 40 seconds. It
 * lives here, with injectable bin/timeout, so the non-blocking property is
 * actually testable instead of being asserted about `node:child_process` in the
 * abstract.
 *
 * Never rejects: a failing probe is reported through the monitor's state file,
 * exactly as before.
 */
export function runMonitorProbe(
  id: string,
  opts: { bin?: string; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      opts.bin ?? MONITOR_BIN(),
      ['run', id],
      {
        timeout: opts.timeoutMs ?? 40_000,
        // The old call used stdio:'ignore'; execFile buffers instead, and the
        // 1 MB default would SIGTERM a chatty command monitor with ENOBUFS.
        maxBuffer: 8 * 1024 * 1024,
      },
      (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }),
    )
  })
}

// ---- validation ------------------------------------------------------------
//
// monitors.json is written straight from the renderer and later executed by
// bin/terminal-monitor on a launchd timer — a `command` monitor's target runs
// via /bin/bash -lc, on a schedule that survives quitting the app. So the write
// path validates the SHAPE here rather than trusting whatever JSON arrives:
// an unknown `type` is rejected outright (it would otherwise persist and be
// re-interpreted by a future daemon version), and the numeric knobs are clamped
// so a bad value can't turn into a 1ms poll loop.

export const MONITOR_TYPES: MonitorType[] = ['http', 'tls-cert', 'tcp', 'dns', 'command']
const SEVERITIES: (Severity | 'off')[] = ['urgent', 'normal', 'low', 'off']

/** Min 10s: anything faster is a runaway, not a monitor. Max 24h. */
export const MIN_INTERVAL_SEC = 10
export const MAX_INTERVAL_SEC = 86_400

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

function validateNotify(raw: unknown): MonitorNotify {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const onFailure = SEVERITIES.includes(r.onFailure as Severity | 'off')
    ? (r.onFailure as Severity | 'off')
    : DEFAULT_NOTIFY.onFailure
  return {
    onFailure,
    onRecovery: typeof r.onRecovery === 'boolean' ? r.onRecovery : DEFAULT_NOTIFY.onRecovery,
    renotifyAfterSec: clamp(
      r.renotifyAfterSec,
      0,
      MAX_INTERVAL_SEC,
      DEFAULT_NOTIFY.renotifyAfterSec,
    ),
    dailyDigest: r.dailyDigest === true,
    digestHour: clamp(r.digestHour, 0, 23, DEFAULT_NOTIFY.digestHour),
  }
}

/** A single monitor, or null if it can't be made safe (unknown kind, no id/target). */
export function validateMonitor(raw: unknown): Monitor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id.trim()) return null
  if (!MONITOR_TYPES.includes(r.type as MonitorType)) return null
  if (typeof r.target !== 'string' || !r.target.trim()) return null
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name : r.id,
    type: r.type as MonitorType,
    target: r.target,
    intervalSec: clamp(r.intervalSec, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC, 300),
    enabled: r.enabled !== false,
    ...(typeof r.group === 'string' ? { group: r.group } : {}),
    notify: validateNotify(r.notify),
    config:
      r.config && typeof r.config === 'object' && !Array.isArray(r.config)
        ? (r.config as Record<string, unknown>)
        : {},
  }
}

/** Validate a whole monitors.json payload, reporting what was dropped. */
export function validateMonitors(raw: unknown): { monitors: Monitor[]; rejected: number } {
  if (!Array.isArray(raw)) return { monitors: [], rejected: 0 }
  const monitors: Monitor[] = []
  let rejected = 0
  const seen = new Set<string>()
  for (const entry of raw) {
    const m = validateMonitor(entry)
    // A duplicate id would make the state file (keyed on id) ambiguous.
    if (!m || seen.has(m.id)) {
      rejected++
      continue
    }
    seen.add(m.id)
    monitors.push(m)
  }
  return { monitors, rejected }
}

// ---- config + state IO -----------------------------------------------------

export function readMonitors(file = MONITORS_FILE()): Monitor[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.id === 'string') : []
  } catch {
    return []
  }
}

export function writeMonitors(list: Monitor[], file = MONITORS_FILE()): void {
  mkdirSync(CFG(), { recursive: true })
  // `bin/terminal-cli monitor add/rm/...` edits this same file from a separate
  // process and takes the advisory lock. Writing atomically but WITHOUT the lock
  // still loses the CLI's edit whenever the two overlap — atomicity stops a torn
  // file, not a lost update (ticket 110).
  updateJsonState<Monitor[]>(
    file,
    () => [],
    () => list,
    { accept: Array.isArray },
  )
}

export function readMonitorStatus(id: string, dir = MONITOR_STATE_DIR()): MonitorStatus | null {
  try {
    return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/** Every monitor joined with its latest status, worst-first for the UI. */
export function listMonitorsWithStatus(
  file = MONITORS_FILE(),
  dir = MONITOR_STATE_DIR(),
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
export function orphanStateIds(dir = MONITOR_STATE_DIR()): string[] {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const known = new Set(readMonitors().map((m) => m.id))
  return files.map((f) => f.slice(0, -5)).filter((id) => !known.has(id))
}
