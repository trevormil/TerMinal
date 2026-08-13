// Flap suppression for the Monitoring subsystem: the pure decision layer shared
// by the app (src/main/monitors.ts, the Monitoring tab) and mirrored by the
// daemon (bin/terminal-monitor).
//
// Two distinct sources of noise are handled here, and they are NOT the same
// problem:
//
//   THEIR END, briefly — one blown probe. `needsConfirmation` (monitors.ts)
//   already re-probes once within a tick; this module adds the slower guard,
//   requiring N *consecutive* checks to fail before a monitor is published as
//   down. A blip is recorded as a counter bump and nothing else.
//
//   OUR END — the operator's own uplink drops, and every monitor "fails" at
//   once. No threshold helps: each monitor genuinely fails N times in a row.
//   The tell is that ALL of them fail at the network layer simultaneously, so
//   the cycle is gated on a connectivity verdict instead, and while that verdict
//   is "we are offline" checks stop counting altogether.
//
// Everything here is pure — no clock, no network, no filesystem. The daemon
// supplies the probe results and the reference-probe outcomes.

/**
 * What kind of failure a probe hit. The split that matters is whether the
 * failure PROVES connectivity: an HTTP 500, a refused connection or a bad
 * certificate all mean our packets reached them and came back, so they can
 * never be evidence that our own network is down.
 */
export type FailureCategory =
  | 'dns'
  | 'refused'
  | 'unreachable'
  | 'timeout'
  | 'tls'
  | 'http-status'
  | 'body'
  | 'command'
  | 'unknown'

const NETWORK_LAYER: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  'dns',
  'unreachable',
  'timeout',
])

/** Whether this failure is consistent with OUR uplink being down. */
export function isNetworkLayer(category: FailureCategory | undefined): boolean {
  return category !== undefined && NETWORK_LAYER.has(category)
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'EAI_NONAME', 'NOTFOUND'])
const UNREACHABLE_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN'])
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])

/**
 * Classify a thrown probe error. `fetch` reports everything as a bare
 * `TypeError: fetch failed` and buries the real code in `cause`, so the cause
 * chain is unwrapped before anything else is tried.
 */
export function categorizeError(err: unknown): FailureCategory {
  if (!err || typeof err !== 'object') return 'unknown'
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }

  const code = typeof e.code === 'string' ? e.code : ''
  const name = typeof e.name === 'string' ? e.name : ''
  const message = typeof e.message === 'string' ? e.message : ''

  if (DNS_CODES.has(code)) return 'dns'
  if (UNREACHABLE_CODES.has(code)) return 'unreachable'
  if (TIMEOUT_CODES.has(code)) return 'timeout'
  if (code === 'ECONNREFUSED') return 'refused'
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS') || code.includes('SELF_SIGNED'))
    return 'tls'
  if (code.startsWith('UNABLE_TO_') || code.startsWith('DEPTH_ZERO_')) return 'tls'
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'

  // Message sniffing is the last resort: only reached when no code was set.
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|dns/i.test(message)) return 'dns'
  if (/ECONNREFUSED|refused/i.test(message)) return 'refused'
  if (/EHOSTUNREACH|ENETUNREACH|unreachable|network is down/i.test(message)) return 'unreachable'
  if (/ETIMEDOUT|timed? ?out/i.test(message)) return 'timeout'
  if (/certificate|tls|ssl/i.test(message)) return 'tls'

  if (e.cause) return categorizeError(e.cause)
  return 'unknown'
}

const LABELS: Record<FailureCategory, string> = {
  dns: 'DNS lookup failed — the name did not resolve',
  refused: 'connection refused — their end answered but nothing is listening',
  unreachable: 'unreachable — no network path to the host',
  timeout: 'timed out — no response before the deadline',
  tls: 'TLS problem — the certificate or handshake was rejected',
  'http-status': 'their end: the server returned an error status',
  body: 'their end: the response did not contain what we expect',
  command: 'the check command itself reported failure',
  unknown: 'failed for an unrecognised reason',
}

/** Human phrase for alert text and the monitor detail pane. */
export function categoryLabel(category: FailureCategory): string {
  return LABELS[category] ?? LABELS.unknown
}

// ---- consecutive-failure threshold ----------------------------------------

export type MonitorHealth = 'ok' | 'warn' | 'fail'

export const DEFAULT_MIN_CONSECUTIVE_FAILURES = 2
export const MAX_MIN_CONSECUTIVE_FAILURES = 10

/** Migration + clamp for the per-monitor knob. Absent ⇒ the default. */
export function normalizeMinConsecutiveFailures(raw: unknown): number {
  // `Number(null)` is 0, which would clamp to 1 and quietly disable the
  // threshold for every monitor written before this field existed.
  if (raw === null || raw === undefined || raw === '') return DEFAULT_MIN_CONSECUTIVE_FAILURES
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MIN_CONSECUTIVE_FAILURES
  return Math.min(MAX_MIN_CONSECUTIVE_FAILURES, Math.max(1, Math.round(n)))
}

export type ThresholdInput = {
  /** Last PUBLISHED state plus its consecutive-failure counter. */
  prev: { status: MonitorHealth; consecutiveFailures?: number } | null
  /** What this check actually saw (already confirm-re-probed by the daemon). */
  observed: MonitorHealth
  minConsecutiveFailures: number
  /** True when we have established that OUR end has no connectivity. */
  localOutage?: boolean
}

export type ThresholdDecision = {
  /** The state to publish — not necessarily what was observed. */
  status: MonitorHealth
  consecutiveFailures: number
  changed: boolean
  /** Whether this transition warrants an Inbox item. */
  alert: boolean
  /** Observed as bad, held back because the threshold is not met yet. */
  suppressed: boolean
  /** The check was discarded because we are offline. */
  paused: boolean
}

/**
 * Fold one observation into the published state.
 *
 * The threshold guards the ok→bad promotion ONLY. Once a monitor is published
 * as bad, warn→fail escalation and the recovery back to ok are believed on the
 * first check: delaying "it got worse" or "it's back" helps nobody, and neither
 * is the flap that produced the spam.
 */
export function applyThreshold(input: ThresholdInput): ThresholdDecision {
  const prevStatus: MonitorHealth = input.prev?.status ?? 'ok'
  const prevCount = Number(input.prev?.consecutiveFailures)
  const carried = Number.isFinite(prevCount) && prevCount > 0 ? Math.floor(prevCount) : 0

  // Offline: the whole check is discarded. The counter resets rather than
  // freezing, so the first failure after the uplink returns starts a fresh run
  // at the threshold instead of completing one begun before the outage.
  if (input.localOutage) {
    return {
      status: prevStatus,
      consecutiveFailures: 0,
      changed: false,
      alert: false,
      suppressed: false,
      paused: true,
    }
  }

  if (input.observed === 'ok') {
    const changed = prevStatus !== 'ok'
    return {
      status: 'ok',
      consecutiveFailures: 0,
      changed,
      // Only a state that was actually published as bad can recover from one.
      alert: changed,
      suppressed: false,
      paused: false,
    }
  }

  const consecutiveFailures = carried + 1
  const threshold = normalizeMinConsecutiveFailures(input.minConsecutiveFailures)

  // Already bad: escalation (or a steady bad state) is published as observed.
  if (prevStatus !== 'ok') {
    const changed = prevStatus !== input.observed
    return {
      status: input.observed,
      consecutiveFailures,
      changed,
      alert: changed,
      suppressed: false,
      paused: false,
    }
  }

  if (consecutiveFailures < threshold) {
    return {
      status: 'ok',
      consecutiveFailures,
      changed: false,
      alert: false,
      suppressed: true,
      paused: false,
    }
  }

  return {
    status: input.observed,
    consecutiveFailures,
    changed: true,
    alert: true,
    suppressed: false,
    paused: false,
  }
}

// ---- local-connectivity gate ----------------------------------------------

export type CycleResult = { failed: boolean; category?: FailureCategory }

/**
 * Cheap, dependency-free first pass: does this cycle LOOK like our own uplink
 * went away? Only true when every monitor that ran failed, and every one of
 * those failures was network-layer. A single success, a single HTTP status, a
 * single refused port — anything that proves a packet made the round trip —
 * settles it as their problem, not ours.
 *
 * Suspicion alone never pauses anything; it only earns the reference probes.
 */
export function suspectsLocalOutage(results: readonly CycleResult[]): boolean {
  if (results.length === 0) return false
  return results.every((r) => r.failed && isNetworkLayer(r.category))
}

/**
 * Second pass: corroborate with independent well-known endpoints. Each entry is
 * "this reference host was reached". Confirmed offline only when there was
 * evidence to gather and all of it says no — an empty list is treated as no
 * evidence, because pausing on none of it would silently mute a genuine outage
 * that happened to take every target down at once.
 */
export function confirmsLocalOutage(referenceReachable: readonly boolean[]): boolean {
  if (referenceReachable.length === 0) return false
  return referenceReachable.every((reached) => !reached)
}

/** The two independent majors used to corroborate. Different networks, both
 *  answer a tiny unauthenticated request, neither is a monitored target. */
export const REFERENCE_PROBES: readonly string[] = [
  'https://www.google.com/generate_204',
  'https://1.1.1.1/cdn-cgi/trace',
]
