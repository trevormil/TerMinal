import { test, expect, describe } from 'bun:test'
import { bucketRunTrends } from './run-trends'

const DAY = 86_400_000
const today = 1_700_000_000_000 // fixed local-midnight-ish anchor for determinism

describe('bucketRunTrends', () => {
  test('buckets by day oldest→newest with success rate + avg duration', () => {
    const runs = [
      { startedAt: today, endedAt: today + 2000, status: 'done' }, // today, 2s
      { startedAt: today + 100, endedAt: today + 100 + 4000, status: 'failed' }, // today, 4s
      { startedAt: today - DAY, endedAt: today - DAY + 1000, status: 'done' }, // yesterday, 1s
    ]
    const t = bucketRunTrends(runs, 2, today)
    expect(t.map((p) => p.date).length).toBe(2)
    // oldest first
    const [yesterday, todayPt] = t
    expect(yesterday.total).toBe(1)
    expect(yesterday.succeeded).toBe(1)
    expect(yesterday.successRate).toBe(1)
    expect(yesterday.avgDurationMs).toBe(1000)
    expect(todayPt.total).toBe(2)
    expect(todayPt.succeeded).toBe(1)
    expect(todayPt.failed).toBe(1)
    expect(todayPt.successRate).toBe(0.5)
    expect(todayPt.avgDurationMs).toBe(3000) // (2000+4000)/2
  })
  test('a day with no terminal runs has successRate 0 (not NaN)', () => {
    const runs = [{ startedAt: today, status: 'running' }]
    const [pt] = bucketRunTrends(runs, 1, today)
    expect(pt.total).toBe(1)
    expect(pt.successRate).toBe(0)
    expect(pt.avgDurationMs).toBe(0)
  })
  test('empty history → zeroed buckets, one per requested day', () => {
    const t = bucketRunTrends([], 7, today)
    expect(t).toHaveLength(7)
    expect(t.every((p) => p.total === 0 && p.successRate === 0)).toBe(true)
  })
})
