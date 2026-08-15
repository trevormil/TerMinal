// What a phone-spawned session does when a park window elapses with no message.
//
// The never-die Stop hook parks the turn inside `terminal-cli remote check
// --wait`. When that window times out it used to ALWAYS re-park by blocking the
// stop with a heartbeat reason — which costs one model turn per window. A
// session idle overnight therefore accumulated a heartbeat turn per hour
// (context + spend + noise) for a conversation nobody was having.
//
// So the timeout is a decision, not a reflex: keep parking while the idle is
// short, then SLEEP — let the turn end for real and stop burning turns. A
// sleeping session is not a dead one: the app pushes the next phone message
// straight into its live pty (see bridge-deps deliverReplyToPty), the same wake
// path every non-Claude engine already relies on.
//
// Pure: the clock and the session's own timestamps are inputs, so the policy is
// testable without waiting an hour.

/** Idle span after which parking stops and the session sleeps. Long enough that
 *  a normal think-time gap never sleeps a session; short enough that an
 *  overnight idle costs a handful of turns instead of one per hour. */
export const DEFAULT_IDLE_SLEEP_MS = 6 * 60 * 60 * 1000

export type HeartbeatInput = {
  now: number
  /** When the session last had real news — a phone message delivered, a post,
   *  or the registration itself. */
  lastActivityAt: number
  /** Override the sleep threshold (TERMINAL_REMOTE_IDLE_SLEEP, seconds). */
  idleSleepMs?: number
  /** A sleeping session can only be woken by a pty push, so a session the app
   *  cannot reach must keep parking or it goes silent for good. */
  wakeable?: boolean
}

export type HeartbeatDecision =
  /** Re-park: block the stop with a heartbeat so the hook fires again. */
  | 'park'
  /** Let the turn end. The next phone message wakes the session via the pty. */
  | 'sleep'

export function heartbeatDecision(input: HeartbeatInput): HeartbeatDecision {
  const threshold =
    input.idleSleepMs && input.idleSleepMs > 0 ? input.idleSleepMs : DEFAULT_IDLE_SLEEP_MS
  if (input.wakeable === false) return 'park'
  // Clock skew (a lastActivityAt in the future) must never sleep a session that
  // just did something — clamp the idle span at 0.
  const idle = Math.max(0, input.now - input.lastActivityAt)
  return idle >= threshold ? 'sleep' : 'park'
}

/** Parse TERMINAL_REMOTE_IDLE_SLEEP (seconds) into ms. Ignores junk and
 *  non-positive values so a typo can't make every session sleep immediately.
 *  `0`/`off` is the deliberate opt-out: park forever, as before. */
export function idleSleepMsFromEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  if (raw === 'off') return Number.POSITIVE_INFINITY
  const secs = Number(raw)
  if (!Number.isFinite(secs) || secs <= 0) return undefined
  return secs * 1000
}
