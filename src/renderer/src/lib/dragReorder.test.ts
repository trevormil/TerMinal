import { describe, expect, test } from 'bun:test'
import { dropIndex, reorderOnDrop } from './dragReorder'

const ids = ['git', 'ci', 'todo', 'cost', 'notes']

describe('dropIndex', () => {
  test('top half of a row inserts before it', () => {
    expect(dropIndex(2, 'top')).toBe(2)
  })

  test('bottom half of a row inserts after it', () => {
    expect(dropIndex(2, 'bottom')).toBe(3)
  })

  test('bottom half of the last row inserts at the end', () => {
    expect(dropIndex(4, 'bottom')).toBe(5)
  })
})

describe('reorderOnDrop', () => {
  test('drag down past several rows', () => {
    // drop 'git' into the bottom half of 'cost' (index 3) → insert at 4
    expect(reorderOnDrop(ids, 'git', 4)).toEqual(['ci', 'todo', 'cost', 'git', 'notes'])
  })

  test('drag up', () => {
    // drop 'cost' into the top half of 'ci' (index 1) → insert at 1
    expect(reorderOnDrop(ids, 'cost', 1)).toEqual(['git', 'cost', 'ci', 'todo', 'notes'])
  })

  test('drop on own top half is a no-op', () => {
    expect(reorderOnDrop(ids, 'todo', 2)).toBeNull()
  })

  test('drop on own bottom half is a no-op', () => {
    expect(reorderOnDrop(ids, 'todo', 3)).toBeNull()
  })

  test('drop at the very start', () => {
    expect(reorderOnDrop(ids, 'notes', 0)).toEqual(['notes', 'git', 'ci', 'todo', 'cost'])
  })

  test('drop at the very end', () => {
    expect(reorderOnDrop(ids, 'git', 5)).toEqual(['ci', 'todo', 'cost', 'notes', 'git'])
  })

  test('moving the first row down one slot', () => {
    // bottom half of 'ci' (index 1) → insert at 2
    expect(reorderOnDrop(ids, 'git', 2)).toEqual(['ci', 'git', 'todo', 'cost', 'notes'])
  })

  test('unknown dragged id is a no-op', () => {
    expect(reorderOnDrop(ids, 'nope', 2)).toBeNull()
  })

  test('insert index beyond the end clamps to the end', () => {
    expect(reorderOnDrop(ids, 'ci', 99)).toEqual(['git', 'todo', 'cost', 'notes', 'ci'])
  })

  test('does not mutate the input array', () => {
    const input = [...ids]
    reorderOnDrop(input, 'git', 4)
    expect(input).toEqual(ids)
  })
})
