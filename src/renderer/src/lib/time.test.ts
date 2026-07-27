import { describe, expect, test } from 'bun:test'
import { logTimestamp, fullTimestamp } from './time'

// A fixed "now" so these never depend on when the suite runs.
const NOW = new Date('2026-07-27T15:00:00.000Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('logTimestamp', () => {
  test('anything under a minute reads as just now, not "0m ago"', () => {
    expect(logTimestamp(ago(0), NOW)).toBe('just now')
    expect(logTimestamp(ago(59 * SEC), NOW)).toBe('just now')
  })

  test('minutes and hours stay relative — the common case while a run is live', () => {
    expect(logTimestamp(ago(1 * MIN), NOW)).toBe('1m ago')
    expect(logTimestamp(ago(59 * MIN), NOW)).toBe('59m ago')
    expect(logTimestamp(ago(1 * HOUR), NOW)).toBe('1h ago')
    expect(logTimestamp(ago(23 * HOUR), NOW)).toBe('23h ago')
  })

  test('yesterday is named rather than counted', () => {
    expect(logTimestamp(ago(25 * HOUR), NOW)).toMatch(/^Yesterday at /)
  })

  // Past a couple of days "6d ago" stops helping — you want the actual date.
  test('older than a week switches to an absolute date with the time', () => {
    const out = logTimestamp(ago(10 * DAY), NOW)
    expect(out).toMatch(/^Jul 17 at /)
    expect(out).not.toMatch(/ago/)
  })

  test('a different year includes the year so it is never ambiguous', () => {
    expect(logTimestamp('2025-03-04T10:00:00.000Z', NOW)).toMatch(/Mar 4, 2025/)
  })

  test('2–6 days still reads relatively', () => {
    expect(logTimestamp(ago(3 * DAY), NOW)).toBe('3d ago')
  })

  // Hand-edited or remote entries can carry anything; never render "NaN".
  test('an unparseable stamp falls back to the raw string', () => {
    expect(logTimestamp('not-a-date', NOW)).toBe('not-a-date')
    expect(logTimestamp('', NOW)).toBe('')
  })

  test('a future stamp does not render negative time', () => {
    expect(logTimestamp(ago(-5 * MIN), NOW)).toBe('just now')
  })
})

describe('fullTimestamp', () => {
  test('gives an unambiguous absolute stamp for the hover title', () => {
    const out = fullTimestamp('2026-07-27T15:00:00.000Z')
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/Jul/)
  })

  test('falls back to the raw string when unparseable', () => {
    expect(fullTimestamp('nope')).toBe('nope')
  })
})
