import { test, expect, describe } from 'bun:test'
import { cronToTrigger, specToTrigger, describeSpec, nextRun, prevRun } from './cron'

describe('cronToTrigger', () => {
  test('*/N minute → concrete calendar minutes (no StartInterval)', () => {
    const t = cronToTrigger('*/15 * * * *')
    expect(t.kind).toBe('calendar')
    expect(t.entries).toEqual([{ Minute: 0 }, { Minute: 15 }, { Minute: 30 }, { Minute: 45 }])
  })
  test('* * * * * → a single empty dict (launchd fires that every minute)', () => {
    // Every field is "*" (unconstrained) → one calendar dict with no keys,
    // which launchd treats as "match every minute". NOT 60 explicit entries.
    expect(cronToTrigger('* * * * *')).toEqual({ kind: 'calendar', entries: [{}] })
  })
  test('*/N hour → concrete calendar hours', () => {
    const t = cronToTrigger('0 */4 * * *')
    expect(t.entries).toEqual([
      { Minute: 0, Hour: 0 },
      { Minute: 0, Hour: 4 },
      { Minute: 0, Hour: 8 },
      { Minute: 0, Hour: 12 },
      { Minute: 0, Hour: 16 },
      { Minute: 0, Hour: 20 },
    ])
  })
  test('weekday range expands to one entry per day', () => {
    const t = cronToTrigger('30 9 * * 1-5')
    expect(t.entries).toEqual([
      { Minute: 30, Hour: 9, Weekday: 1 },
      { Minute: 30, Hour: 9, Weekday: 2 },
      { Minute: 30, Hour: 9, Weekday: 3 },
      { Minute: 30, Hour: 9, Weekday: 4 },
      { Minute: 30, Hour: 9, Weekday: 5 },
    ])
  })
  test('comma list of hours', () => {
    expect(cronToTrigger('0 9,17 * * *').entries).toEqual([
      { Minute: 0, Hour: 9 },
      { Minute: 0, Hour: 17 },
    ])
  })
  test('day-of-month only', () => {
    expect(cronToTrigger('0 0 1 * *')).toEqual({
      kind: 'calendar',
      entries: [{ Minute: 0, Hour: 0, Day: 1 }],
    })
  })
  test('dow 7 normalizes to 0 (Sunday)', () => {
    expect(cronToTrigger('0 12 * * 7').entries).toEqual([{ Minute: 0, Hour: 12, Weekday: 0 }])
  })
  test('rejects malformed / out-of-range', () => {
    expect(() => cronToTrigger('nope')).toThrow()
    expect(() => cronToTrigger('* * * *')).toThrow() // 4 fields
    expect(() => cronToTrigger('99 * * * *')).toThrow() // minute > 59
    expect(() => cronToTrigger('0 25 * * *')).toThrow() // hour > 23
  })
})

describe('specToTrigger', () => {
  test('cron spec delegates to cronToTrigger', () => {
    expect(specToTrigger({ kind: 'cron', expr: '0 9 * * *' })).toEqual({
      kind: 'calendar',
      entries: [{ Minute: 0, Hour: 9 }],
    })
  })
  test('calendar daily (no weekdays)', () => {
    expect(specToTrigger({ kind: 'calendar', minute: 5, hour: 8 })).toEqual({
      kind: 'calendar',
      entries: [{ Minute: 5, Hour: 8 }],
    })
  })
  test('calendar with weekdays → one entry each', () => {
    expect(
      specToTrigger({ kind: 'calendar', minute: 0, hour: 9, weekdays: [1, 3] }).entries,
    ).toEqual([
      { Minute: 0, Hour: 9, Weekday: 1 },
      { Minute: 0, Hour: 9, Weekday: 3 },
    ])
  })
})

describe('describeSpec', () => {
  test('human-readable summaries', () => {
    expect(describeSpec({ kind: 'calendar', minute: 30, hour: 9 })).toBe('daily at 09:30')
    expect(describeSpec({ kind: 'calendar', minute: 0, hour: 17, weekdays: [1, 2, 3, 4, 5] })).toBe(
      'Mon,Tue,Wed,Thu,Fri at 17:00',
    )
    expect(describeSpec({ kind: 'cron', expr: '30 9 * * 1-5' })).toBe('cron: 30 9 * * 1-5')
  })
})

// Use real local-time anchors so the minute-scan matches getHours()/getDay().
describe('nextRun', () => {
  test('daily calendar → the next occurrence of that wall-clock time', () => {
    const from = new Date(2026, 6, 10, 8, 0, 0) // Fri 08:00 local
    const next = new Date(nextRun({ kind: 'calendar', minute: 30, hour: 9 }, from.getTime())!)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(30)
    expect(next.getDate()).toBe(10) // still today (09:30 > 08:00)
  })
  test('rolls to tomorrow once today’s time has passed', () => {
    const from = new Date(2026, 6, 10, 10, 0, 0) // Fri 10:00, past 09:30
    const next = new Date(nextRun({ kind: 'calendar', minute: 30, hour: 9 }, from.getTime())!)
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(9)
  })
  test('weekday-gated cron skips to the next allowed day', () => {
    const from = new Date(2026, 6, 11, 12, 0, 0) // Sat
    const next = new Date(nextRun({ kind: 'cron', expr: '0 9 * * 1-5' }, from.getTime())!)
    expect(next.getDay()).toBe(1) // Monday
    expect(next.getHours()).toBe(9)
  })
})

describe('prevRun', () => {
  test('most recent occurrence earlier today', () => {
    const from = new Date(2026, 6, 10, 10, 0, 0) // Fri 10:00
    const prev = new Date(prevRun({ kind: 'calendar', minute: 30, hour: 9 }, from.getTime())!)
    expect(prev.getDate()).toBe(10)
    expect(prev.getHours()).toBe(9)
    expect(prev.getMinutes()).toBe(30)
  })
  test('falls back to yesterday when today’s time has not arrived', () => {
    const from = new Date(2026, 6, 10, 8, 0, 0) // Fri 08:00, before 09:30
    const prev = new Date(prevRun({ kind: 'calendar', minute: 30, hour: 9 }, from.getTime())!)
    expect(prev.getDate()).toBe(9) // Thursday
    expect(prev.getHours()).toBe(9)
  })
  test('weekday-gated cron walks back to the last allowed day', () => {
    const from = new Date(2026, 6, 12, 12, 0, 0) // Sun
    const prev = new Date(prevRun({ kind: 'cron', expr: '0 9 * * 1-5' }, from.getTime())!)
    expect(prev.getDay()).toBe(5) // Friday
    expect(prev.getHours()).toBe(9)
  })
  test('includes the current minute when it matches', () => {
    const from = new Date(2026, 6, 10, 9, 30, 45) // exactly 09:30 (seconds ignored)
    const prev = new Date(prevRun({ kind: 'calendar', minute: 30, hour: 9 }, from.getTime())!)
    expect(prev.getHours()).toBe(9)
    expect(prev.getMinutes()).toBe(30)
    expect(prev.getDate()).toBe(10)
  })
})
