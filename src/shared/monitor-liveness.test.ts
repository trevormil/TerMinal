import { describe, expect, test } from 'bun:test'
import {
  KICKSTART_GRACE_MS,
  MIN_STALE_WINDOW_MS,
  STALE_AFTER_INTERVALS,
  checkMonitorDaemon,
  daemonHealth,
  stalenessOf,
  type LivenessDeps,
  type LivenessState,
} from './monitor-liveness'
import type { Monitor, MonitorStatus } from '../main/monitors'

// Ticket 117. The daemon stopped for 23 hours and the UI rendered frozen-green
// identically to fresh-green. These tests pin the two things that would have
// surfaced it, and the two ways the fix could itself become a problem:
// re-nagging every tick, and retrying launchctl forever.
//
// Nothing here shells out to real launchctl or touches ~/.config/TerMinal —
// every effect is injected. The suite pinged the owner's phone twice in one day
// once already; a test for a NOTIFICATION path is the last place to risk it.

const MIN = 60_000
const HOUR = 60 * MIN

function monitor(over: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm1',
    name: 'API',
    type: 'http',
    target: 'https://example.com',
    intervalSec: 300,
    enabled: true,
    notify: {
      onFailure: 'urgent',
      onRecovery: true,
      renotifyAfterSec: 3600,
      dailyDigest: false,
      digestHour: 9,
    },
    config: {},
    ...over,
  }
}

function status(lastCheckedAt: number): MonitorStatus {
  return {
    id: 'm1',
    status: 'ok',
    summary: '200 OK',
    lastCheckedAt,
    since: lastCheckedAt,
    lastTransition: null,
    history: [],
  }
}

describe('stalenessOf — the boundaries (ticket 117)', () => {
  const now = 1_000 * HOUR
  // 300s interval → 900s window, but the 5-minute floor does not bind here.
  const interval = 300
  const window = interval * 1000 * STALE_AFTER_INTERVALS

  test('a check that just ran is fresh', () => {
    expect(stalenessOf(now, interval, now).state).toBe('fresh')
  })

  test('one interval late is still fresh — jitter is not an outage', () => {
    expect(stalenessOf(now - interval * 1000, interval, now).state).toBe('fresh')
  })

  test('exactly at the window is fresh; one ms past it is stale', () => {
    expect(stalenessOf(now - window, interval, now).state).toBe('fresh')
    expect(stalenessOf(now - window - 1, interval, now).state).toBe('stale')
  })

  test('the 23-hour outage is unambiguously stale', () => {
    const s = stalenessOf(now - 23 * HOUR, interval, now)
    expect(s.state).toBe('stale')
    expect(s.ageMs).toBe(23 * HOUR)
  })

  test('never checked is NOT stale — a new monitor is not a dead daemon', () => {
    // Collapsing these would make every monitor you create file a false alarm.
    for (const v of [null, undefined, 0, NaN]) {
      expect(stalenessOf(v as number | null, interval, now).state).toBe('never')
    }
  })

  test('a fast monitor gets the 5-minute floor, not a 30-second hair trigger', () => {
    // A 10s monitor at 3 intervals would alarm after 30s — one slow probe.
    expect(stalenessOf(now - 60_000, 10, now).state).toBe('fresh')
    expect(stalenessOf(now - MIN_STALE_WINDOW_MS - 1, 10, now).state).toBe('stale')
  })

  test('a backwards clock jump does not read as a huge gap', () => {
    // A future timestamp means the clock moved, not that the daemon is ahead.
    expect(stalenessOf(now + HOUR, interval, now)).toMatchObject({ state: 'fresh', ageMs: 0 })
  })
})

describe('daemonHealth — judged against the FASTEST monitor (ticket 117)', () => {
  const now = 1_000 * HOUR

  test('a dead daemon is detected even when a slow monitor is not yet due', () => {
    // The trap: a 24h check is legitimately 20h old. Judging by the slowest
    // interval would let it mask a daemon that died 20 hours ago.
    const monitors = [
      monitor({ id: 'fast', intervalSec: 60 }),
      monitor({ id: 'slow', intervalSec: 86_400 }),
    ]
    const at = { fast: now - 20 * HOUR, slow: now - 20 * HOUR }
    const h = daemonHealth(monitors, (id) => status(at[id as keyof typeof at]), now)
    expect(h.stale).toBe(true)
    expect(h.intervalSec).toBe(60)
  })

  test('a live daemon is healthy', () => {
    const h = daemonHealth([monitor()], () => status(now - MIN), now)
    expect(h.stale).toBe(false)
    expect(h.newestCheckedAt).toBe(now - MIN)
  })

  test('disabled monitors are ignored', () => {
    // A disabled monitor is never checked, so its ancient timestamp is correct
    // and must not be read as the daemon being dead.
    const monitors = [monitor({ id: 'off', enabled: false }), monitor({ id: 'on' })]
    const h = daemonHealth(
      monitors,
      (id) => status(id === 'off' ? now - 30 * HOUR : now - MIN),
      now,
    )
    expect(h.stale).toBe(false)
    expect(h.staleIds).toEqual([])
  })

  test('a fresh install with no results yet is not an outage', () => {
    expect(daemonHealth([monitor()], () => null, now).stale).toBe(false)
    expect(daemonHealth([], () => null, now).stale).toBe(false)
  })
})

// ---- escalation policy ------------------------------------------------------

function harness(overrides: Partial<LivenessDeps> = {}) {
  let state: LivenessState = {}
  const calls = { kickstart: 0, diagnose: 0, hitl: [] as { title: string; detail: string }[] }
  let now = 1_000 * HOUR
  const deps: LivenessDeps = {
    now: () => now,
    readState: () => state,
    writeState: (next) => {
      state = next
    },
    kickstart: async () => {
      calls.kickstart++
      // What actually happened: exit 0, and the interval did not resume.
      return { ok: true, detail: 'kickstart returned 0' }
    },
    diagnose: async () => {
      calls.diagnose++
      return 'state = running\nruns = 0\nlast exit code = 0'
    },
    fileHitl: (item) => calls.hitl.push(item),
    ...overrides,
  }
  return {
    deps,
    calls,
    advance: (ms: number) => {
      now += ms
    },
    state: () => state,
  }
}

const STALE = {
  stale: true,
  newestCheckedAt: 1,
  intervalSec: 30,
  staleIds: ['m1'],
  ageMs: 23 * HOUR,
}
const FRESH = { stale: false, newestCheckedAt: 2, intervalSec: 30, staleIds: [], ageMs: 1000 }

describe('checkMonitorDaemon escalates once, then goes quiet (ticket 117)', () => {
  test('a healthy daemon does nothing at all', async () => {
    const h = harness()
    expect(await checkMonitorDaemon(FRESH, h.deps)).toBe('healthy')
    expect(h.calls.kickstart).toBe(0)
    expect(h.calls.hitl).toEqual([])
  })

  test('first stale tick tries a kickstart — exactly one', async () => {
    const h = harness()
    expect(await checkMonitorDaemon(STALE, h.deps)).toBe('kickstarted')
    expect(h.calls.kickstart).toBe(1)
    // No inbox item yet: the kickstart may well fix it, and an item that
    // resolves itself before anyone reads it is noise.
    expect(h.calls.hitl).toEqual([])
  })

  test('it does NOT kickstart again while waiting for the grace window', async () => {
    const h = harness()
    await checkMonitorDaemon(STALE, h.deps)
    h.advance(KICKSTART_GRACE_MS - 1)
    expect(await checkMonitorDaemon(STALE, h.deps)).toBe('awaiting-kickstart')
    expect(h.calls.kickstart).toBe(1)
  })

  test('still stale after the grace window → exactly ONE inbox item', async () => {
    const h = harness()
    await checkMonitorDaemon(STALE, h.deps)
    h.advance(KICKSTART_GRACE_MS + 1)
    expect(await checkMonitorDaemon(STALE, h.deps)).toBe('escalated')
    expect(h.calls.hitl.length).toBe(1)
    expect(h.calls.hitl[0].detail).toContain('runs = 0')
    expect(h.calls.hitl[0].detail).toContain('23.0h')
  })

  test('every later tick is silent — a dead daemon must not re-nag forever', async () => {
    // The failure lasted 23 hours. At a 5-minute tick that is 276 inbox items,
    // which would bury every real blocker in the inbox.
    const h = harness()
    await checkMonitorDaemon(STALE, h.deps)
    h.advance(KICKSTART_GRACE_MS + 1)
    await checkMonitorDaemon(STALE, h.deps)
    for (let i = 0; i < 50; i++) {
      h.advance(5 * MIN)
      expect(await checkMonitorDaemon(STALE, h.deps)).toBe('quiet')
    }
    expect(h.calls.hitl.length).toBe(1)
    expect(h.calls.kickstart).toBe(1)
  })

  test('recovery re-arms the ladder for the NEXT outage', async () => {
    // Without clearing state on recovery, a second outage is never reported.
    const h = harness()
    await checkMonitorDaemon(STALE, h.deps)
    h.advance(KICKSTART_GRACE_MS + 1)
    await checkMonitorDaemon(STALE, h.deps)
    expect(h.calls.hitl.length).toBe(1)

    expect(await checkMonitorDaemon(FRESH, h.deps)).toBe('healthy')
    expect(h.state()).toEqual({})

    expect(await checkMonitorDaemon(STALE, h.deps)).toBe('kickstarted')
    h.advance(KICKSTART_GRACE_MS + 1)
    await checkMonitorDaemon(STALE, h.deps)
    expect(h.calls.hitl.length).toBe(2)
  })

  test('a kickstart that reports failure still escalates rather than looping', async () => {
    let attempts = 0
    const h = harness({
      kickstart: async () => {
        attempts++
        return { ok: false, detail: 'no such service' }
      },
    })
    await checkMonitorDaemon(STALE, h.deps)
    h.advance(KICKSTART_GRACE_MS + 1)
    expect(await checkMonitorDaemon(STALE, h.deps)).toBe('escalated')
    // Failure is not a reason to try again: whether launchd accepted the
    // command tells us nothing about whether the interval resumed, which is
    // decided next tick from the data.
    expect(attempts).toBe(1)
  })

  test('the policy survives an app restart, because a dead daemon outlives it', async () => {
    // State is read fresh each tick rather than held in a module variable, so a
    // relaunch mid-outage does not restart the ladder and re-file the item.
    let persisted: LivenessState = {}
    const mk = (now: number): LivenessDeps => ({
      now: () => now,
      readState: () => persisted,
      writeState: (s) => {
        persisted = s
      },
      kickstart: async () => ({ ok: true, detail: '' }),
      diagnose: async () => 'diag',
      fileHitl: () => filed++,
    })
    let filed = 0
    const t0 = 1_000 * HOUR
    await checkMonitorDaemon(STALE, mk(t0))
    await checkMonitorDaemon(STALE, mk(t0 + KICKSTART_GRACE_MS + 1))
    await checkMonitorDaemon(STALE, mk(t0 + 2 * HOUR)) // "after a relaunch"
    expect(filed).toBe(1)
  })
})
