import { describe, expect, test } from 'bun:test'
import { mergeWidgetOrder } from './widgetOrder'

const defaults = [
  { id: 'git', order: 10 },
  { id: 'ci', order: 20 },
  { id: 'todo', order: 30 },
  { id: 'cost', order: 40 },
]

describe('mergeWidgetOrder', () => {
  test('empty saved order falls back to default order', () => {
    expect(mergeWidgetOrder([], defaults)).toEqual(['git', 'ci', 'todo', 'cost'])
  })

  test('sorts defaults by order with missing order treated as 99, ties stable by input position', () => {
    expect(
      mergeWidgetOrder(
        [],
        [{ id: 'b' }, { id: 'a', order: 5 }, { id: 'c', order: 5 }, { id: 'd', order: 50 }],
      ),
    ).toEqual(['a', 'c', 'd', 'b'])
  })

  test('a full saved order wins over default order', () => {
    expect(mergeWidgetOrder(['cost', 'git', 'todo', 'ci'], defaults)).toEqual([
      'cost',
      'git',
      'todo',
      'ci',
    ])
  })

  test('a widget missing from the saved order slots in at its default position', () => {
    // 'ci' (order 20) is new: inserted before the first widget whose default
    // order is greater (todo, 30) — mid-list, not dumped at the end.
    expect(mergeWidgetOrder(['git', 'todo', 'cost'], defaults)).toEqual([
      'git',
      'ci',
      'todo',
      'cost',
    ])
  })

  test('a new widget ordered after everything appends at the end', () => {
    expect(mergeWidgetOrder(['git', 'ci', 'todo'], defaults)).toEqual(['git', 'ci', 'todo', 'cost'])
  })

  test('multiple new widgets keep their default relative order', () => {
    expect(mergeWidgetOrder(['git', 'cost'], defaults)).toEqual(['git', 'ci', 'todo', 'cost'])
  })

  test('stale ids in the saved order are dropped', () => {
    expect(mergeWidgetOrder(['removed', 'todo', 'git', 'gone'], defaults)).toEqual([
      'ci',
      'todo',
      'git',
      'cost',
    ])
  })

  test('user reordering is respected even when insertion scans a non-monotonic list', () => {
    // User moved 'todo' (30) before 'git' (10); new 'ci' (20) inserts before
    // the first entry with a greater default order — 'todo' — deterministically.
    expect(mergeWidgetOrder(['todo', 'git', 'cost'], defaults)).toEqual([
      'ci',
      'todo',
      'git',
      'cost',
    ])
  })

  test('duplicate ids in the saved order are deduped to the first occurrence', () => {
    expect(mergeWidgetOrder(['git', 'git', 'ci', 'todo', 'cost'], defaults)).toEqual([
      'git',
      'ci',
      'todo',
      'cost',
    ])
  })
})
