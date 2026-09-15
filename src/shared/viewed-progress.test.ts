import { expect, test } from 'bun:test'
import { viewedProgress } from './viewed-progress'

test('viewed percentage handles empty, partial and complete diffs', () => {
  expect(viewedProgress(0, 0)).toBe(0)
  expect(viewedProgress(1, 4)).toBe(25)
  expect(viewedProgress(4, 4)).toBe(100)
  expect(viewedProgress(5, 4)).toBe(100)
  expect(viewedProgress(-1, 4)).toBe(0)
})
