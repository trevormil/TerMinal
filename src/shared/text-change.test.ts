import { describe, expect, test } from 'bun:test'
import { minimalChange } from './text-change'

const apply = (s: string, c: { from: number; to: number; insert: string }) =>
  s.slice(0, c.from) + c.insert + s.slice(c.to)

describe('minimalChange', () => {
  test('identical documents need no change', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
  })

  test('a middle edit touches only the middle', () => {
    const c = minimalChange('const a=1\nconst b=2\n', 'const a = 1\nconst b=2\n')!
    expect(c.from).toBeGreaterThanOrEqual(7)
    expect(c.to).toBeLessThanOrEqual(9)
    expect(apply('const a=1\nconst b=2\n', c)).toBe('const a = 1\nconst b=2\n')
  })

  test('append and prepend round-trip', () => {
    for (const [a, b] of [
      ['abc', 'abcd'],
      ['abc', 'xabc'],
      ['', 'abc'],
      ['abc', ''],
      ['aaa', 'aa'],
      ['aa', 'aaa'],
    ] as const) {
      const c = minimalChange(a, b)
      expect(c ? apply(a, c) : a).toBe(b)
    }
  })

  test('overlapping repeats stay correct (classic prefix/suffix trap)', () => {
    // prev=abab next=ab — naive scans can overlap; result must round-trip
    const c = minimalChange('abab', 'ab')!
    expect(apply('abab', c)).toBe('ab')
  })
})
