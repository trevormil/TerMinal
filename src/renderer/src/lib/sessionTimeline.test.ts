import { expect, test } from 'bun:test'
import { selectedTimelineTurn } from './sessionTimeline'

test('selection follows source lines across refreshed or trimmed timelines', () => {
  const turns = [10, 20, 30].map((line) => ({ line, prompt: `${line}`, response: '' }))
  expect(selectedTimelineTurn(turns, null)?.line).toBe(30)
  expect(selectedTimelineTurn(turns, 20)?.line).toBe(20)
  expect(selectedTimelineTurn([...turns, { line: 40, prompt: '', response: '' }], 20)?.line).toBe(
    20,
  )
  expect(selectedTimelineTurn(turns.slice(1), 10)?.line).toBe(30)
  expect(selectedTimelineTurn([], 20)).toBeUndefined()
})
