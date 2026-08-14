import type { FailureCategory } from '../shared/monitor-flap'
import type { Monitor, MonitorState, Severity } from '../shared/types/monitors'

export type { FailureCategory }
export type { Monitor, MonitorState, MonitorType, Severity } from '../shared/types/monitors'

/**
 * A monitor as the daemon actually finds it on disk.
 *
 * `monitors.json` is hand-editable and predates several fields, so nothing
 * beyond `id` can be assumed present. Modelling that here rather than casting to
 * `Monitor` keeps every optional access honest instead of lying to the compiler.
 */
export type StoredMonitor = Partial<Omit<Monitor, 'config' | 'notify'>> & {
  id: string
  config?: Record<string, unknown>
  notify?: Partial<Monitor['notify']> & { onFailure?: Severity | 'off' }
}

/** What one probe observed. `category` is absent exactly when status is ok. */
export type ProbeResult = {
  status: MonitorState
  summary: string
  metrics?: Record<string, unknown>
  detail?: unknown
  category?: FailureCategory
}

/** The per-monitor record the daemon publishes to monitor-state/<id>.json. */
export type StoredState = {
  id: string
  status: MonitorState
  summary?: string
  metrics?: Record<string, unknown>
  detail?: unknown
  lastCheckedAt?: number
  since?: number
  lastTransition?: { from: MonitorState; to: MonitorState; at: number } | null
  history?: { at: number; status: MonitorState }[]
  consecutiveFailures?: number
  observed?: MonitorState
  category?: FailureCategory
  paused?: boolean
  pausedSince?: number
}

/** The daemon's latest verdict on whether THIS machine has connectivity. */
export type Connectivity = { offline: boolean; since?: number }
