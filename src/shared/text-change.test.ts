import { describe, expect, test } from 'bun:test'
import { contentToWrite, minimalChange } from './text-change'

describe('contentToWrite', () => {
  test('formatter output wins when the buffer stayed put', () => {
    // dispatching the format made live == formatted
    expect(contentToWrite('a=1', 'a = 1', 'a = 1')).toBe('a = 1')
    // no live view: formatted still applies
    expect(contentToWrite('a=1', 'a = 1', null)).toBe('a = 1')
  })

  test('typing during the format wins over both snapshots', () => {
    expect(contentToWrite('a=1', 'a = 1', 'a=1 // newer')).toBe('a=1 // newer')
  })

  test('no formatter, unchanged buffer → the captured content', () => {
    expect(contentToWrite('a=1', null, 'a=1')).toBe('a=1')
    expect(contentToWrite('a=1', null, null)).toBe('a=1')
  })
})

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
