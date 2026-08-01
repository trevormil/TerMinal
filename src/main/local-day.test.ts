import { describe, expect, test } from 'bun:test'
import { localDay } from './local-day'

describe('localDay', () => {
  test('formats as YYYY-MM-DD with zero padding', () => {
    expect(localDay(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
    expect(localDay(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31')
  })

  // The bug: toISOString() is UTC, so an evening edit west of UTC stamped
  // TOMORROW's date on ticket frontmatter, loop-log headings and the budget
  // day-key (rolling the daily spend cap over hours early).
  test('a local evening is still today, even though UTC has moved on', () => {
    const evening = new Date(2026, 6, 31, 22, 30) // 22:30 local, whatever the zone
    expect(localDay(evening)).toBe('2026-07-31')
    // Pin the contrast explicitly for any machine west of UTC.
    if (evening.getTimezoneOffset() > 0) {
      expect(evening.toISOString().slice(0, 10)).toBe('2026-08-01')
      expect(localDay(evening)).not.toBe(evening.toISOString().slice(0, 10))
    }
  })

  test('a local early morning is still today for zones east of UTC', () => {
    const morning = new Date(2026, 6, 31, 0, 30)
    expect(localDay(morning)).toBe('2026-07-31')
    if (morning.getTimezoneOffset() < 0) {
      expect(morning.toISOString().slice(0, 10)).toBe('2026-07-30')
    }
  })

  test('midday agrees with the UTC date in every zone (sanity)', () => {
    const noon = new Date(2026, 6, 31, 12, 0)
    expect(localDay(noon)).toBe('2026-07-31')
  })

  test('defaults to now and is always well-formed', () => {
    expect(localDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
