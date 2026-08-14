// The Monitoring subsystem's pure classifiers: probe observation → health.
//
// Shared by the app (src/main/monitors.ts re-exports them for the Monitoring
// tab and the bridge) and the daemon (src/monitor, bundled to
// bin/terminal-monitor). The daemon used to carry a hand-copy of every function
// below — see ADR-0024 §24.5. It no longer does: the daemon is a bundle now, so
// it can import this module and still ship as a single self-contained file.
//
// Everything here is pure: no clock, no network, no filesystem.
import type { MonitorState } from './types/monitors'

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

/**
 * Whether a probe result needs a confirmation re-probe before it is believed.
 *
 * Every "is down" the Inbox saw over a week of real use was a single blown
 * probe — "no response" once, HTTP 200 on the next check (laptop sleep/wake,
 * Wi-Fi blip) — each one filing an urgent item plus a recovery. So a result
 * that would move a monitor to a WORSE state is probed a second time before
 * the transition is recorded; a real outage fails the confirm probe too and
 * still alerts within seconds of the first probe. Recoveries and steady states
 * are believed immediately — delaying "it's back" helps nobody.
 */
export function needsConfirmation(prev: MonitorState, next: MonitorState): boolean {
  const rank: Record<MonitorState, number> = { ok: 0, warn: 1, fail: 2 }
  return rank[next] > rank[prev]
}
