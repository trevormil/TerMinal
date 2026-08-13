import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MIN_CONSECUTIVE_FAILURES,
  applyThreshold,
  categorizeError,
  categoryLabel,
  confirmsLocalOutage,
  isNetworkLayer,
  normalizeMinConsecutiveFailures,
  suspectsLocalOutage,
  type ThresholdInput,
} from './monitor-flap'

// The three behaviours this module exists for, all as pure logic so they can be
// asserted without a network, a clock, or a daemon:
//
//   1. a monitor only goes down (and only alerts) after N consecutive failures;
//   2. when OUR end has no connectivity, checks stop counting entirely;
//   3. every failure carries a category, so "HTTP 500" never reads the same as
//      "we could not resolve the name".

describe('categorizeError', () => {
  const err = (over: Record<string, unknown>): unknown => Object.assign(new Error('x'), over)

  test('DNS failures', () => {
    expect(categorizeError(err({ code: 'ENOTFOUND' }))).toBe('dns')
    expect(categorizeError(err({ code: 'EAI_AGAIN' }))).toBe('dns')
    expect(categorizeError(new Error('getaddrinfo ENOTFOUND api.example'))).toBe('dns')
  })

  test('a refused connection proves we HAVE connectivity — their port is shut', () => {
    expect(categorizeError(err({ code: 'ECONNREFUSED' }))).toBe('refused')
    expect(isNetworkLayer('refused')).toBe(false)
  })

  test('unreachable and timeout are network-layer — they may be our end', () => {
    expect(categorizeError(err({ code: 'EHOSTUNREACH' }))).toBe('unreachable')
    expect(categorizeError(err({ code: 'ENETUNREACH' }))).toBe('unreachable')
    expect(categorizeError(err({ code: 'ETIMEDOUT' }))).toBe('timeout')
    expect(categorizeError(err({ name: 'TimeoutError' }))).toBe('timeout')
    expect(categorizeError(err({ name: 'AbortError' }))).toBe('timeout')
    expect(isNetworkLayer('unreachable')).toBe(true)
    expect(isNetworkLayer('timeout')).toBe(true)
    expect(isNetworkLayer('dns')).toBe(true)
  })

  test('unwraps the cause fetch buries the real code under', () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('inner'), { code: 'ECONNREFUSED' }),
    })
    expect(categorizeError(wrapped)).toBe('refused')
  })

  test('TLS problems are their end, not ours', () => {
    expect(categorizeError(err({ code: 'CERT_HAS_EXPIRED' }))).toBe('tls')
    expect(categorizeError(err({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toBe('tls')
    expect(isNetworkLayer('tls')).toBe(false)
  })

  test('anything unrecognised is unknown, never silently network-layer', () => {
    expect(categorizeError(new Error('something odd'))).toBe('unknown')
    expect(categorizeError(null)).toBe('unknown')
    // The whole local-outage gate hinges on this: an uncategorised failure must
    // not be able to vote for "our wifi is down" and mute a real outage.
    expect(isNetworkLayer('unknown')).toBe(false)
  })

  test('every category renders a distinct human phrase for alert text', () => {
    const cats = [
      'dns',
      'refused',
      'unreachable',
      'timeout',
      'tls',
      'http-status',
      'body',
      'command',
      'unknown',
    ] as const
    const phrases = cats.map((c) => categoryLabel(c))
    expect(new Set(phrases).size).toBe(cats.length)
    expect(categoryLabel('http-status')).toMatch(/their end/i)
    expect(categoryLabel('unreachable')).toMatch(/network/i)
  })
})

describe('applyThreshold — a monitor only goes down after N consecutive failures', () => {
  const run = (over: Partial<ThresholdInput>): ReturnType<typeof applyThreshold> =>
    applyThreshold({
      prev: null,
      observed: 'ok',
      minConsecutiveFailures: DEFAULT_MIN_CONSECUTIVE_FAILURES,
      ...over,
    })

  test('the default threshold is 2 — a lone blip is never published or alerted', () => {
    expect(DEFAULT_MIN_CONSECUTIVE_FAILURES).toBe(2)
    const d = run({ prev: { status: 'ok', consecutiveFailures: 0 }, observed: 'fail' })
    expect(d.status).toBe('ok')
    expect(d.consecutiveFailures).toBe(1)
    expect(d.changed).toBe(false)
    expect(d.alert).toBe(false)
    expect(d.suppressed).toBe(true)
  })

  test('the second consecutive failure transitions and alerts', () => {
    const d = run({ prev: { status: 'ok', consecutiveFailures: 1 }, observed: 'fail' })
    expect(d.status).toBe('fail')
    expect(d.consecutiveFailures).toBe(2)
    expect(d.changed).toBe(true)
    expect(d.alert).toBe(true)
    expect(d.suppressed).toBe(false)
  })

  test('blip → success clears the counter with no alert in either direction', () => {
    const d = run({ prev: { status: 'ok', consecutiveFailures: 1 }, observed: 'ok' })
    expect(d.status).toBe('ok')
    expect(d.consecutiveFailures).toBe(0)
    expect(d.changed).toBe(false)
    expect(d.alert).toBe(false)
  })

  test('recovery alerts only from a state that actually alerted', () => {
    const down = run({ prev: { status: 'fail', consecutiveFailures: 4 }, observed: 'ok' })
    expect(down.status).toBe('ok')
    expect(down.changed).toBe(true)
    expect(down.alert).toBe(true)
    // A monitor that only ever blipped was never published as down, so its
    // "recovery" is a non-event — this is the pair of items that used to spam.
    expect(run({ prev: { status: 'ok', consecutiveFailures: 1 }, observed: 'ok' }).alert).toBe(
      false,
    )
  })

  test('threshold 1 restores the old alert-immediately behaviour', () => {
    const d = run({
      prev: { status: 'ok', consecutiveFailures: 0 },
      observed: 'fail',
      minConsecutiveFailures: 1,
    })
    expect(d.status).toBe('fail')
    expect(d.alert).toBe(true)
  })

  test('an already-published bad state escalates immediately', () => {
    // warn→fail is not a fresh outage; the threshold guards ok→bad only.
    const d = run({ prev: { status: 'warn', consecutiveFailures: 3 }, observed: 'fail' })
    expect(d.status).toBe('fail')
    expect(d.changed).toBe(true)
    expect(d.alert).toBe(true)
  })

  test('a first-ever check with no prior state still needs N failures', () => {
    expect(run({ prev: null, observed: 'fail' }).status).toBe('ok')
    expect(run({ prev: null, observed: 'fail' }).alert).toBe(false)
  })

  test('a corrupt counter cannot skip the threshold', () => {
    const d = run({
      prev: { status: 'ok', consecutiveFailures: Number.NaN },
      observed: 'fail',
    })
    expect(d.consecutiveFailures).toBe(1)
    expect(d.status).toBe('ok')
  })
})

describe('applyThreshold — local outage freezes everything', () => {
  const paused = (over: Partial<ThresholdInput>): ReturnType<typeof applyThreshold> =>
    applyThreshold({
      prev: null,
      observed: 'fail',
      minConsecutiveFailures: 2,
      localOutage: true,
      ...over,
    })

  test('a failure during a local outage neither counts nor alerts', () => {
    const d = paused({ prev: { status: 'ok', consecutiveFailures: 1 } })
    expect(d.status).toBe('ok')
    expect(d.alert).toBe(false)
    expect(d.changed).toBe(false)
    expect(d.paused).toBe(true)
  })

  test('the counter is RESET, so resuming cannot alert off stale pre-outage failures', () => {
    // One failure before the outage + one after must not add up to a
    // transition: the post-outage run starts from zero.
    const during = paused({ prev: { status: 'ok', consecutiveFailures: 1 } })
    expect(during.consecutiveFailures).toBe(0)
    const afterResume = applyThreshold({
      prev: { status: during.status, consecutiveFailures: during.consecutiveFailures },
      observed: 'fail',
      minConsecutiveFailures: 2,
    })
    expect(afterResume.status).toBe('ok')
    expect(afterResume.alert).toBe(false)
  })

  test('a monitor already published as down stays down — no fake recovery', () => {
    const d = paused({ prev: { status: 'fail', consecutiveFailures: 5 } })
    expect(d.status).toBe('fail')
    expect(d.alert).toBe(false)
    expect(d.changed).toBe(false)
  })

  test('nothing is published during a pause, not even a success', () => {
    // The whole cycle is frozen: writing a transition off a probe taken while
    // the network was down is exactly the noise this feature removes.
    const d = paused({ prev: { status: 'fail', consecutiveFailures: 5 }, observed: 'ok' })
    expect(d.status).toBe('fail')
    expect(d.alert).toBe(false)
  })
})

describe('suspectsLocalOutage', () => {
  test('every monitor failing at the network layer is a suspicion', () => {
    expect(
      suspectsLocalOutage([
        { failed: true, category: 'timeout' },
        { failed: true, category: 'dns' },
        { failed: true, category: 'unreachable' },
      ]),
    ).toBe(true)
  })

  test('one reachable endpoint disproves it outright', () => {
    expect(
      suspectsLocalOutage([
        { failed: true, category: 'timeout' },
        { failed: false },
      ]),
    ).toBe(false)
  })

  test('a failure that proves connectivity disproves it', () => {
    // HTTP 500 / refused / bad TLS all mean packets got there and came back.
    for (const category of ['http-status', 'refused', 'tls', 'body', 'command'] as const) {
      expect(
        suspectsLocalOutage([
          { failed: true, category: 'timeout' },
          { failed: true, category },
        ]),
      ).toBe(false)
    }
  })

  test('an empty cycle suspects nothing', () => {
    expect(suspectsLocalOutage([])).toBe(false)
  })

  test('an uncategorised failure is not evidence of a local outage', () => {
    expect(suspectsLocalOutage([{ failed: true, category: 'unknown' }])).toBe(false)
    expect(suspectsLocalOutage([{ failed: true }])).toBe(false)
  })
})

describe('confirmsLocalOutage', () => {
  test('confirmed only when every reference probe also failed to reach the internet', () => {
    expect(confirmsLocalOutage([false, false])).toBe(true)
    expect(confirmsLocalOutage([false, true])).toBe(false)
    expect(confirmsLocalOutage([true, true])).toBe(false)
  })

  test('no reference evidence means no pause — silence is never assumed', () => {
    // Pausing on zero evidence would mute a genuine multi-target outage.
    expect(confirmsLocalOutage([])).toBe(false)
  })
})

describe('normalizeMinConsecutiveFailures — config migration', () => {
  test('an existing monitor with no field gets the default', () => {
    expect(normalizeMinConsecutiveFailures(undefined)).toBe(DEFAULT_MIN_CONSECUTIVE_FAILURES)
    expect(normalizeMinConsecutiveFailures(null)).toBe(DEFAULT_MIN_CONSECUTIVE_FAILURES)
    expect(normalizeMinConsecutiveFailures('two')).toBe(DEFAULT_MIN_CONSECUTIVE_FAILURES)
  })

  test('clamped so a bad value cannot mute a monitor forever', () => {
    expect(normalizeMinConsecutiveFailures(0)).toBe(1)
    expect(normalizeMinConsecutiveFailures(-3)).toBe(1)
    expect(normalizeMinConsecutiveFailures(1e9)).toBe(10)
    expect(normalizeMinConsecutiveFailures(3)).toBe(3)
    expect(normalizeMinConsecutiveFailures(2.6)).toBe(3)
  })
})
