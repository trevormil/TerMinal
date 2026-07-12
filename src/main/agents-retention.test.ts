import { test, expect, describe } from 'bun:test'
import { inMemoryWorkingSet } from './run-retention'

const r = (id: string, startedAt: number) => ({ id, startedAt })

describe('inMemoryWorkingSet — bounds RAM, never deletes', () => {
  test('keeps the most recent N by startedAt (ascending order)', () => {
    const runs = [r('a', 1), r('b', 3), r('c', 2), r('d', 5), r('e', 4)]
    // most recent two are d(5) and e(4); returned ascending → [e, d]
    expect(inMemoryWorkingSet(runs, 2).map((x) => x.id)).toEqual(['e', 'd'])
  })
  test('keep >= length returns everything (sorted ascending by startedAt)', () => {
    const runs = [r('b', 3), r('a', 1), r('c', 2)]
    expect(inMemoryWorkingSet(runs, 10).map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })
  test('keep <= 0 loads ALL (unbounded retention)', () => {
    const runs = [r('a', 1), r('b', 2), r('c', 3)]
    expect(inMemoryWorkingSet(runs, 0)).toHaveLength(3)
    expect(inMemoryWorkingSet(runs, -1)).toHaveLength(3)
  })
  test('does not mutate the input array (no deletion side effects)', () => {
    const runs = [r('a', 3), r('b', 1)]
    const before = runs.map((x) => x.id)
    inMemoryWorkingSet(runs, 1)
    expect(runs.map((x) => x.id)).toEqual(before)
  })
})
