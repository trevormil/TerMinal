// Monitor daemon liveness (ticket 117).
//
// The monitoring daemon stopped for 23 HOURS and nothing surfaced it. Every
// check kept rendering its last known result — all green — so the Monitoring
// tab was indistinguishable from "everything is healthy". The owner noticed
// only because the timestamps looked old.
//
// The launchd cause was not TerMinal's fault (the job was loaded, enabled, last
// exit 0, `pended nondemand spawn = interval`, and simply never spawned — a
// throwaway control LaunchAgent behaved identically, so interval spawning was
// broken for the whole user domain). Diagnosing macOS is explicitly out of
// scope. The defect that IS ours is that the app could not tell.
//
// Two things live here, both pure or fully injected, because the one thing this
// must never do is what it is detecting: reach out to the real system and
// quietly do nothing.
//
//   1. `stalenessOf` — a pure function of (last checked, interval, now).
//   2. `checkMonitorDaemon` — the escalation policy: kickstart at most ONCE,
//      then file exactly ONE inbox item. A dead daemon that re-nagged every
//      tick would be its own incident.

// Structural, not imported from src/main/monitors.ts: this module is bundled
// into the RENDERER too (the Monitoring tab needs the same staleness rule), and
// that module reaches for node:fs. Same discipline as shared/engines.ts — pure
// and dependency-free, so main, preload and the renderer can all import it.
export type LivenessMonitor = { id: string; intervalSec: number; enabled?: boolean }
export type LivenessStatus = { lastCheckedAt?: number | null }

/**
 * How many intervals late a check must be before it reads as stale.
 *
 * 3 rather than 1: a probe that takes a few seconds, a laptop that slept
 * briefly, or a daemon that fired a touch late are all normal, and a monitoring
 * system that cries wolf on ordinary jitter gets muted — after which it detects
 * nothing at all. The failure this exists to catch lasted 23 hours; three
 * intervals of tolerance costs nothing against that.
 */
export const STALE_AFTER_INTERVALS = 3

/** Floor for the staleness window, so a 10s monitor doesn't alarm on a hiccup. */
export const MIN_STALE_WINDOW_MS = 5 * 60_000

export type StalenessState = 'fresh' | 'stale' | 'never'

export type Staleness = {
  state: StalenessState
  /** Time since the last check, or null when it has never run. */
  ageMs: number | null
  /** How long a gap is tolerated before `stale`. */
  windowMs: number
}

export function stalenessWindowMs(intervalSec: number): number {
  const interval = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 60
  return Math.max(MIN_STALE_WINDOW_MS, interval * 1000 * STALE_AFTER_INTERVALS)
}

/**
 * Is this monitor's newest result still trustworthy?
 *
 * `never` is deliberately NOT `stale`: a monitor added a moment ago has no
 * result yet and is not evidence of a dead daemon. Collapsing the two would
 * make every newly-created monitor file a false alarm.
 */
export function stalenessOf(
  lastCheckedAt: number | null | undefined,
  intervalSec: number,
  now: number,
): Staleness {
  const windowMs = stalenessWindowMs(intervalSec)
  if (typeof lastCheckedAt !== 'number' || !Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) {
    return { state: 'never', ageMs: null, windowMs }
  }
  // A clock that jumped backwards leaves a future timestamp. That is not stale,
  // and reporting a negative age as a huge gap would be worse than saying fresh.
  const ageMs = Math.max(0, now - lastCheckedAt)
  return { state: ageMs > windowMs ? 'stale' : 'fresh', ageMs, windowMs }
}

export type DaemonHealth = {
  /** True when the daemon has plainly stopped writing results. */
  stale: boolean
  /** Newest `lastCheckedAt` across all enabled monitors, null if none ever ran. */
  newestCheckedAt: number | null
  /** The cadence we judged against: the shortest enabled interval. */
  intervalSec: number
  /** Enabled monitors that are individually stale. */
  staleIds: string[]
  ageMs: number | null
}

/**
 * Daemon-level verdict from the per-monitor results.
 *
 * Judged against the SHORTEST enabled interval, because the daemon is one
 * process serving all of them: if the fastest monitor has not been written in
 * several of its own intervals, the daemon is not running, whatever the slow
 * ones say. Judging against the slowest would let a 24h check mask a dead
 * daemon for a day.
 */
export function daemonHealth(
  monitors: LivenessMonitor[],
  statusOf: (id: string) => LivenessStatus | null,
  now: number,
): DaemonHealth {
  const enabled = monitors.filter((m) => m.enabled !== false)
  const intervalSec = enabled.length
    ? Math.min(...enabled.map((m) => (m.intervalSec > 0 ? m.intervalSec : 60)))
    : 60

  let newest: number | null = null
  const staleIds: string[] = []
  for (const m of enabled) {
    const at = statusOf(m.id)?.lastCheckedAt
    if (typeof at === 'number' && at > 0 && (newest === null || at > newest)) newest = at
    if (stalenessOf(at, m.intervalSec, now).state === 'stale') staleIds.push(m.id)
  }

  // No enabled monitors, or none has ever produced a result: there is nothing
  // for the daemon to have failed to do. Reporting "dead" here would fire on a
  // fresh install, which is exactly the false alarm that gets alerts ignored.
  if (!enabled.length || newest === null) {
    return { stale: false, newestCheckedAt: newest, intervalSec, staleIds, ageMs: null }
  }

  const health = stalenessOf(newest, intervalSec, now)
  return {
    stale: health.state === 'stale',
    newestCheckedAt: newest,
    intervalSec,
    staleIds,
    ageMs: health.ageMs,
  }
}

// ---- escalation policy ------------------------------------------------------

/** Persisted so the policy survives an app restart — a dead daemon outlives it. */
export type LivenessState = {
  /** When we last tried a kickstart for the CURRENT outage. */
  kickstartedAt?: number
  /** When we filed the inbox item for the CURRENT outage. */
  escalatedAt?: number
  /** The `newestCheckedAt` that outage started from, so recovery is detectable. */
  outageFrom?: number
}

export type LivenessDeps = {
  now: () => number
  readState: () => LivenessState
  writeState: (next: LivenessState) => void
  /** Ask launchd to restart the job. Never throws; reports what happened. */
  kickstart: () => Promise<{ ok: boolean; detail: string }>
  /** Collect launchd diagnostics for the inbox item (print output, runs, exit). */
  diagnose: () => Promise<string>
  fileHitl: (item: { title: string; action: string; detail: string }) => void
}

export type LivenessOutcome =
  'healthy' | 'kickstarted' | 'escalated' | 'awaiting-kickstart' | 'quiet'

/** How long to let a kickstart take effect before deciding it did not work. */
export const KICKSTART_GRACE_MS = 2 * 60_000

/**
 * One liveness tick.
 *
 * The escalation ladder is deliberately short and terminal:
 *   healthy            → clear any outage state
 *   stale, first sight → ONE `launchctl kickstart`, then wait
 *   still stale after  → ONE inbox item carrying the diagnostics, then silence
 *   the grace window
 *
 * It stops there on purpose. When this actually happened, kickstart forced
 * exactly one run and the interval did not resume — so retrying forever would
 * have burned a launchctl call every tick for 23 hours and told the operator
 * nothing new. Reinstalling the plist on a loop would have been worse.
 */
export async function checkMonitorDaemon(
  health: DaemonHealth,
  deps: LivenessDeps,
): Promise<LivenessOutcome> {
  const now = deps.now()
  const state = deps.readState()

  if (!health.stale) {
    // Recovered (or never broken). Clearing here is what re-arms the ladder for
    // the NEXT outage; without it the second outage would never be reported.
    if (state.kickstartedAt || state.escalatedAt || state.outageFrom) deps.writeState({})
    return 'healthy'
  }

  if (!state.kickstartedAt) {
    const result = await deps.kickstart()
    deps.writeState({
      ...state,
      kickstartedAt: now,
      outageFrom: health.newestCheckedAt ?? undefined,
    })
    // Report the attempt either way; whether it worked is decided next tick by
    // looking at the data, not by trusting launchctl's exit code. When this
    // happened for real, `launchctl kickstart -k` exited 0 and changed nothing.
    return result.ok ? 'kickstarted' : 'kickstarted'
  }

  if (now - state.kickstartedAt < KICKSTART_GRACE_MS) return 'awaiting-kickstart'

  if (state.escalatedAt) return 'quiet'

  const diagnostic = await deps.diagnose()
  const hours = health.ageMs !== null ? (health.ageMs / 3_600_000).toFixed(1) : '?'
  deps.fileHitl({
    title: 'Monitoring daemon has stopped',
    action:
      'Check System Settings → General → Login Items & Extensions for a disabled TerMinal background item, then reboot if it is not listed. Monitoring results are frozen until it runs again.',
    detail: [
      `No monitor has been checked for ${hours}h (expected every ${health.intervalSec}s).`,
      'A kickstart was attempted and did not restore the interval.',
      '',
      diagnostic,
    ].join('\n'),
  })
  deps.writeState({ ...state, escalatedAt: now })
  return 'escalated'
}
