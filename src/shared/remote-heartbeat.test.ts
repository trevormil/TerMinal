import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_IDLE_SLEEP_MS,
  heartbeatDecision,
  idleSleepMsFromEnv,
} from '../shared/remote-heartbeat'

const HOUR = 60 * 60 * 1000
const T0 = 1_784_000_000_000

describe('heartbeatDecision', () => {
  it('parks while the idle span is short — the session must not die on a coffee break', () => {
    expect(heartbeatDecision({ now: T0 + HOUR, lastActivityAt: T0 })).toBe('park')
    expect(heartbeatDecision({ now: T0 + 5 * HOUR, lastActivityAt: T0 })).toBe('park')
  })

  it('sleeps once idle passes the threshold, so heartbeats stop accumulating', () => {
    expect(heartbeatDecision({ now: T0 + DEFAULT_IDLE_SLEEP_MS, lastActivityAt: T0 })).toBe('sleep')
    expect(heartbeatDecision({ now: T0 + 24 * HOUR, lastActivityAt: T0 })).toBe('sleep')
  })

  it('counts idle from the LAST activity, not the session start', () => {
    // Busy all night, one message an hour ago: still a live conversation.
    expect(heartbeatDecision({ now: T0 + 24 * HOUR, lastActivityAt: T0 + 23 * HOUR })).toBe('park')
  })

  it('honours a custom threshold', () => {
    expect(heartbeatDecision({ now: T0 + 2 * HOUR, lastActivityAt: T0, idleSleepMs: HOUR })).toBe(
      'sleep',
    )
    expect(
      heartbeatDecision({ now: T0 + 30 * 60_000, lastActivityAt: T0, idleSleepMs: HOUR }),
    ).toBe('park')
  })

  it('never sleeps a session the app cannot wake', () => {
    expect(heartbeatDecision({ now: T0 + 999 * HOUR, lastActivityAt: T0, wakeable: false })).toBe(
      'park',
    )
  })

  it('clamps clock skew instead of sleeping a session that just acted', () => {
    expect(heartbeatDecision({ now: T0, lastActivityAt: T0 + 10 * HOUR })).toBe('park')
  })
})

describe('idleSleepMsFromEnv', () => {
  it('reads seconds', () => {
    expect(idleSleepMsFromEnv('3600')).toBe(HOUR)
  })

  it('ignores junk and non-positive values rather than sleeping instantly', () => {
    expect(idleSleepMsFromEnv('nonsense')).toBeUndefined()
    expect(idleSleepMsFromEnv('-5')).toBeUndefined()
    expect(idleSleepMsFromEnv('0')).toBeUndefined()
    expect(idleSleepMsFromEnv(undefined)).toBeUndefined()
    expect(idleSleepMsFromEnv('')).toBeUndefined()
  })

  it('supports an explicit opt-out that parks forever', () => {
    expect(
      heartbeatDecision({
        now: T0 + 999 * HOUR,
        lastActivityAt: T0,
        idleSleepMs: idleSleepMsFromEnv('off'),
      }),
    ).toBe('park')
  })
})
