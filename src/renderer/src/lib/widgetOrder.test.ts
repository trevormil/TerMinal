import { describe, expect, test } from 'bun:test'
import { applyVisibleOrder, mergeWidgetOrder } from './widgetOrder'

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

describe('applyVisibleOrder', () => {
  test('a move never drops ids that are filtered out of the current view', () => {
    // 'todo' is saved but not visible right now (e.g. engine-gated claude-only
    // plugin during a codex session). Moving 'ci' before 'git' must keep
    // 'todo' in the persisted order, anchored where it was: between the
    // visible slots it sat between before the move.
    expect(applyVisibleOrder(['git', 'todo', 'ci', 'cost'], ['ci', 'git', 'cost'])).toEqual([
      'ci',
      'todo',
      'git',
      'cost',
    ])
  })

  test('multiple invisible ids all survive and keep their relative placement', () => {
    expect(applyVisibleOrder(['x1', 'git', 'x2', 'ci', 'x3'], ['ci', 'git'])).toEqual([
      'x1',
      'ci',
      'x2',
      'git',
      'x3',
    ])
  })

  test('empty saved order becomes exactly the visible arrangement', () => {
    expect(applyVisibleOrder([], ['ci', 'git', 'cost'])).toEqual(['ci', 'git', 'cost'])
  })

  test('visible ids missing from the saved order are appended after the spliced sequence', () => {
    // 'cost' was never persisted; after a move it materializes at the end of
    // the visible sequence it already occupied on screen.
    expect(applyVisibleOrder(['git', 'todo'], ['git', 'ci', 'cost'])).toEqual([
      'git',
      'todo',
      'ci',
      'cost',
    ])
  })

  test('duplicate ids in the saved order are deduped', () => {
    expect(applyVisibleOrder(['git', 'git', 'todo', 'ci'], ['ci', 'git'])).toEqual([
      'ci',
      'todo',
      'git',
    ])
  })
})
