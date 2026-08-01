import { describe, expect, test } from 'bun:test'
import { ageColor, ageLabel, ageTierOf, untilLabel } from './inboxAge'

const NOW = 10 * 24 * 3_600_000 // arbitrary "now" well past epoch
const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('ageTierOf', () => {
  test('buckets by absolute age', () => {
    expect(ageTierOf(NOW, NOW)).toBe('fresh')
    expect(ageTierOf(NOW - 3 * HOUR, NOW)).toBe('fresh')
    expect(ageTierOf(NOW - 6 * HOUR, NOW)).toBe('today')
    expect(ageTierOf(NOW - 30 * HOUR, NOW)).toBe('aging')
    expect(ageTierOf(NOW - 5 * DAY, NOW)).toBe('stale')
  })

  test('boundaries fall into the older bucket', () => {
    expect(ageTierOf(NOW - 4 * HOUR, NOW)).toBe('today')
    expect(ageTierOf(NOW - DAY, NOW)).toBe('aging')
    expect(ageTierOf(NOW - 3 * DAY, NOW)).toBe('stale')
  })

  test('a future or missing timestamp is fresh, never stale', () => {
    expect(ageTierOf(NOW + HOUR, NOW)).toBe('fresh')
    expect(ageTierOf(0, 0)).toBe('fresh')
  })
})

describe('ageColor / ageLabel', () => {
  test('fresh is deliberately uncoloured', () => {
    expect(ageColor('fresh')).toBeUndefined()
  })

  test('older tiers escalate to amber then red', () => {
    expect(ageColor('aging')).toBe('#d6a84a')
    expect(ageColor('stale')).toBe('var(--gt-red)')
  })

  test('every tier has a label', () => {
    for (const t of ['fresh', 'today', 'aging', 'stale'] as const)
      expect(ageLabel(t).length).toBeGreaterThan(0)
  })
})

describe('untilLabel', () => {
  test('a past or present instant reads as due', () => {
    expect(untilLabel(NOW - 1, NOW)).toBe('due')
    expect(untilLabel(NOW, NOW)).toBe('due')
  })

  test('scales the unit with the distance', () => {
    expect(untilLabel(NOW + 30 * 60_000, NOW)).toBe('30m')
    expect(untilLabel(NOW + 5 * HOUR, NOW)).toBe('5h')
    expect(untilLabel(NOW + 3 * DAY, NOW)).toBe('3d')
  })
})
