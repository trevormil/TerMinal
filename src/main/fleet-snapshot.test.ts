import { describe, expect, test } from 'bun:test'
import { orderFleetSnapshotEntries, restoreFleetSnapshotEntryOrder } from './fleet-snapshot'

describe('orderFleetSnapshotEntries', () => {
  test('keeps the active session last so transcript LRU remains hot', () => {
    const entries: [string, number][] = [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]
    expect(orderFleetSnapshotEntries(entries, 'a').map(([key]) => key)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ])
  })

  test('restores snapshot output to the original session order', () => {
    const entries: [string, number][] = [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]
    const warmedOrder = orderFleetSnapshotEntries(entries, 'a').map(([key]) => ({ key }))

    expect(restoreFleetSnapshotEntryOrder(warmedOrder, entries).map(({ key }) => key)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
