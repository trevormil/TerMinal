import { describe, expect, test } from 'bun:test'
import { moveTargetFor } from './tree-dnd'

describe('moveTargetFor', () => {
  test('moves a file into a folder', () => {
    expect(moveTargetFor('a.txt', 'sub')).toBe('sub/a.txt')
    expect(moveTargetFor('sub/a.txt', 'other/deep')).toBe('other/deep/a.txt')
  })

  test('moves into the repo root', () => {
    expect(moveTargetFor('sub/a.txt', '')).toBe('a.txt')
  })

  test('same-parent drop is a no-op', () => {
    expect(moveTargetFor('sub/a.txt', 'sub')).toBeNull()
    expect(moveTargetFor('a.txt', '')).toBeNull()
  })

  test('refuses dropping a folder into itself or its own subtree', () => {
    expect(moveTargetFor('sub', 'sub')).toBeNull()
    expect(moveTargetFor('sub', 'sub/nested')).toBeNull()
  })

  test('a sibling folder with a shared name prefix is fine', () => {
    expect(moveTargetFor('sub', 'sub2')).toBe('sub2/sub')
  })

  test('empty source is illegal', () => {
    expect(moveTargetFor('', 'sub')).toBeNull()
  })
})
