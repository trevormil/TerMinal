export type MonitorType = 'http' | 'tls-cert' | 'tcp' | 'dns' | 'command'

export type MonitorState = 'ok' | 'warn' | 'fail'

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

export type Severity = 'urgent' | 'normal' | 'low'
