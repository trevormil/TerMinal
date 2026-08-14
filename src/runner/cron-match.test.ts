import { describe, expect, test } from 'bun:test'
import { parseCronFieldLocal, prevExpectedFire, specEntriesLocal } from './cron-match'

// The cadence watchdog files an Inbox item when a schedule misses its last TWO
// expected fires, so a wrong answer here either nags about healthy schedules or
// stays silent while launchd has quietly unloaded the plist. Both have shipped.

describe('parseCronFieldLocal', () => {
  test('* is "any", not an enumeration', () => {
    expect(parseCronFieldLocal('*', 0, 59)).toBeNull()
  })

  test('lists, ranges and steps expand', () => {
    expect(parseCronFieldLocal('1,3', 0, 59)).toEqual([1, 3])
    expect(parseCronFieldLocal('2-5', 0, 59)).toEqual([2, 3, 4, 5])
    expect(parseCronFieldLocal('*/15', 0, 59)).toEqual([0, 15, 30, 45])
    expect(parseCronFieldLocal('10-20/5', 0, 59)).toEqual([10, 15, 20])
  })

  test('anything malformed or out of range bails to null rather than guessing', () => {
    // null propagates to "skip this schedule" — a watchdog that guesses a
    // cadence files false overdue reports, which trains the operator to ignore
    // the Inbox.
    expect(parseCronFieldLocal('60', 0, 59)).toBeNull()
    expect(parseCronFieldLocal('5-2', 0, 59)).toBeNull()
    expect(parseCronFieldLocal('*/0', 0, 59)).toBeNull()
    expect(parseCronFieldLocal('MON', 0, 7)).toBeNull()
    expect(parseCronFieldLocal('1;2', 0, 59)).toBeNull()
  })
})

describe('specEntriesLocal', () => {
  test('cron day-of-week 7 folds onto 0 so Sunday matches Date.getDay()', () => {
    expect(specEntriesLocal({ kind: 'cron', expr: '0 9 * * 7' })?.dows).toEqual([0])
    expect(specEntriesLocal({ kind: 'cron', expr: '0 9 * * 0,7' })?.dows).toEqual([0])
  })

  test('an expression without exactly five fields is rejected', () => {
    expect(specEntriesLocal({ kind: 'cron', expr: '0 9 * *' })).toBeNull()
    expect(specEntriesLocal({ kind: 'cron', expr: '0 9 * * * *' })).toBeNull()
  })

  test('a calendar spec with no weekdays fires every day', () => {
    const e = specEntriesLocal({ kind: 'calendar', minute: 30, hour: 6 })
    expect(e).toEqual({ minutes: [30], hours: [6], days: null, months: null, dows: null })
  })
})

describe('prevExpectedFire', () => {
  const at = (s: string): number => new Date(s).getTime()

  test('finds the most recent slot at or before the given instant', () => {
    // 09:00 daily, asked at 10:05 → this morning's 09:00.
    const from = at('2026-03-10T10:05:00')
    const prev = prevExpectedFire({ kind: 'cron', expr: '0 9 * * *' }, from)
    expect(new Date(prev as number).toISOString()).toBe(
      new Date(at('2026-03-10T09:00')).toISOString(),
    )
  })

  test('the slot exactly at `from` counts — seconds are floored, not rounded up', () => {
    const from = at('2026-03-10T09:00:45')
    expect(prevExpectedFire({ kind: 'cron', expr: '0 9 * * *' }, from)).toBe(at('2026-03-10T09:00'))
  })

  test('walks back across days to reach a weekly slot', () => {
    // Tue 2026-03-10; Mondays at 08:00 → the day before.
    const prev = prevExpectedFire({ kind: 'cron', expr: '0 8 * * 1' }, at('2026-03-10T12:00'))
    expect(prev).toBe(at('2026-03-09T08:00'))
  })

  test('a cadence rarer than the 45-day scan window reports nothing, not a wrong answer', () => {
    // Feb 30 never happens. Returning a bogus fire would flag it overdue forever.
    expect(
      prevExpectedFire({ kind: 'cron', expr: '0 8 30 2 *' }, at('2026-03-10T12:00')),
    ).toBeNull()
  })

  test('a malformed spec yields null so the watchdog skips the schedule', () => {
    expect(prevExpectedFire({ kind: 'cron', expr: 'nonsense' }, Date.now())).toBeNull()
    expect(prevExpectedFire(undefined, Date.now())).toBeNull()
  })
})
