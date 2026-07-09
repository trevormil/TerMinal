import { test, expect, describe } from 'bun:test'
import { cronToTrigger, specToTrigger, describeSpec, nextRun } from './cron'

describe('cronToTrigger', () => {
  test('*/N * * * * → interval', () => {
    expect(cronToTrigger('*/15 * * * *')).toEqual({ kind: 'interval', seconds: 900 })
  })
  test('* * * * * → every minute (interval 60)', () => {
    expect(cronToTrigger('* * * * *')).toEqual({ kind: 'interval', seconds: 60 })
  })
  test('weekday range expands to one entry per day', () => {
    const t = cronToTrigger('30 9 * * 1-5')
    expect(t.kind).toBe('calendar')
    if (t.kind !== 'calendar') return
    expect(t.entries).toHaveLength(5)
    expect(t.entries).toEqual([
      { Minute: 30, Hour: 9, Weekday: 1 },
      { Minute: 30, Hour: 9, Weekday: 2 },
      { Minute: 30, Hour: 9, Weekday: 3 },
      { Minute: 30, Hour: 9, Weekday: 4 },
      { Minute: 30, Hour: 9, Weekday: 5 },
    ])
  })
  test('comma list of hours', () => {
    const t = cronToTrigger('0 9,17 * * *')
    if (t.kind !== 'calendar') throw new Error('expected calendar')
    expect(t.entries).toEqual([
      { Minute: 0, Hour: 9 },
      { Minute: 0, Hour: 17 },
    ])
  })
  test('day-of-month only', () => {
    expect(cronToTrigger('0 0 1 * *')).toEqual({ kind: 'calendar', entries: [{ Minute: 0, Hour: 0, Day: 1 }] })
  })
  test('dow 7 normalizes to 0 (Sunday)', () => {
    const t = cronToTrigger('0 12 * * 7')
    if (t.kind !== 'calendar') throw new Error('expected calendar')
    expect(t.entries).toEqual([{ Minute: 0, Hour: 12, Weekday: 0 }])
  })
  test('rejects malformed / out-of-range', () => {
    expect(() => cronToTrigger('nope')).toThrow()
    expect(() => cronToTrigger('* * * *')).toThrow() // 4 fields
    expect(() => cronToTrigger('99 * * * *')).toThrow() // minute > 59
    expect(() => cronToTrigger('0 25 * * *')).toThrow() // hour > 23
  })
})

describe('specToTrigger', () => {
  test('interval spec', () => {
    expect(specToTrigger({ kind: 'interval', everyMinutes: 30 })).toEqual({ kind: 'interval', seconds: 1800 })
  })
  test('interval floors at 60s', () => {
    expect(specToTrigger({ kind: 'interval', everyMinutes: 0 })).toEqual({ kind: 'interval', seconds: 60 })
  })
  test('calendar daily (no weekdays)', () => {
    expect(specToTrigger({ kind: 'calendar', minute: 5, hour: 8 })).toEqual({
      kind: 'calendar',
      entries: [{ Minute: 5, Hour: 8 }],
    })
  })
  test('calendar with weekdays → one entry each', () => {
    const t = specToTrigger({ kind: 'calendar', minute: 0, hour: 9, weekdays: [1, 3] })
    if (t.kind !== 'calendar') throw new Error('expected calendar')
    expect(t.entries).toEqual([
      { Minute: 0, Hour: 9, Weekday: 1 },
      { Minute: 0, Hour: 9, Weekday: 3 },
    ])
  })
})

describe('describeSpec', () => {
  test('human-readable summaries', () => {
    expect(describeSpec({ kind: 'interval', everyMinutes: 120 })).toBe('every 2h')
    expect(describeSpec({ kind: 'interval', everyMinutes: 15 })).toBe('every 15m')
    expect(describeSpec({ kind: 'calendar', minute: 30, hour: 9 })).toBe('daily at 09:30')
    expect(describeSpec({ kind: 'calendar', minute: 0, hour: 17, weekdays: [1, 2, 3, 4, 5] })).toBe(
      'Mon,Tue,Wed,Thu,Fri at 17:00',
    )
    expect(describeSpec({ kind: 'cron', expr: '30 9 * * 1-5' })).toBe('cron: 30 9 * * 1-5')
  })
})

describe('nextRun', () => {
  const MIN = 60_000

  test('interval anchors to lastRun, not now', () => {
    // launchd StartInterval fires every N min relative to the last fire. The
    // next fire is lastRun + interval — NOT now + interval. Anchoring to now
    // was the bug: the countdown never counted down and the absolute "next"
    // time drifted forward on every reload.
    const now = 100 * MIN
    const lastRun = now - 36 * MIN // ran 36m ago (a 60m interval)
    const spec = { kind: 'interval', everyMinutes: 60 } as const
    // Real next fire is lastRun + 60m = 24m from now, not 60m from now.
    expect(nextRun(spec, now, lastRun)).toBe(lastRun + 60 * MIN)
    expect(nextRun(spec, now, lastRun)).toBe(now + 24 * MIN)
  })

  test('interval with no lastRun falls back to now + interval', () => {
    const now = 100 * MIN
    const spec = { kind: 'interval', everyMinutes: 30 } as const
    expect(nextRun(spec, now)).toBe(now + 30 * MIN)
    expect(nextRun(spec, now, undefined)).toBe(now + 30 * MIN)
  })

  test('overdue interval (missed fires) reads as due now-or-past, not a full interval out', () => {
    const now = 100 * MIN
    const lastRun = now - 90 * MIN // last fire was 90m ago on a 60m interval
    const spec = { kind: 'interval', everyMinutes: 60 } as const
    // Anchored to lastRun → 30m in the past (overdue), so the UI shows "now".
    // The bug returned now + 60m, hiding that the job is overdue.
    expect(nextRun(spec, now, lastRun)).toBeLessThanOrEqual(now)
  })
})
