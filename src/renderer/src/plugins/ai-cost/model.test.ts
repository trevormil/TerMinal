import { expect, test } from 'bun:test'
import { dailyCost, formatCost } from './model'

const now = new Date(2026, 8, 10, 12).getTime()
test('today uses local midnight; trailing window includes six prior calendar days', () => {
  const result = dailyCost(
    [
      { startedAt: new Date(2026, 8, 10).getTime(), costUsd: 0.25 },
      { startedAt: new Date(2026, 8, 9, 23).getTime(), costUsd: 1 },
      { startedAt: new Date(2026, 8, 3).getTime(), costUsd: 50 },
      { startedAt: now + 1, costUsd: 50 },
    ],
    now,
  )
  expect(result.todayUsd).toBe(0.25)
  expect(result.weekUsd).toBe(1.25)
  expect(result.todayRuns).toBe(1)
})
test('missing data differs from recorded zero cost; malformed costs do not poison sums', () => {
  expect(dailyCost([], now).weekRuns).toBe(0)
  expect(dailyCost([{ startedAt: now, costUsd: 0 }], now).todayRuns).toBe(1)
  expect(
    dailyCost(
      [
        { startedAt: now, costUsd: NaN },
        { startedAt: now, costUsd: -1 },
      ],
      now,
    ).weekRuns,
  ).toBe(0)
  expect(formatCost(0)).toBe('$0.00')
  expect(formatCost(0.001)).toBe('<$0.01')
  expect(formatCost(12.345)).toBe('$12.35')
})
