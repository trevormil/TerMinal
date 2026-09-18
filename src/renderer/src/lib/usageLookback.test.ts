import { expect, test } from 'bun:test'
import { observedBurnRate, recordUsageSample } from './usageLookback'
test('observed rate needs a baseline and measures percentage points per hour', () => {
  expect(observedBurnRate([])).toBeNull()
  expect(observedBurnRate([{ at: 0, pct: 10 }])).toBeNull()
  expect(
    observedBurnRate([
      { at: 0, pct: 10 },
      { at: 60_000, pct: 12 },
    ]),
  ).toBe(120)
})
test('lookback prunes old samples and resets on a quota reset or context compaction', () => {
  const samples = [
    { at: 0, pct: 10 },
    { at: 300_000, pct: 20 },
  ]
  expect(recordUsageSample(samples, 25, 600_000, 5)).toEqual([
    { at: 300_000, pct: 20 },
    { at: 600_000, pct: 25 },
  ])
  expect(recordUsageSample(samples, 5, 600_000, 5)).toEqual([{ at: 600_000, pct: 5 }])
  expect(recordUsageSample(samples, 25, 600_000, 0)).toEqual([])
  expect(recordUsageSample(samples, undefined, 600_000, 5)).toEqual([])
})
