import { describe, expect, test } from 'bun:test'
import { matchSegments, replaceInLine } from './replace'

describe('replaceInLine', () => {
  test('replaces every occurrence and counts them', () => {
    expect(replaceInLine('foo bar foo', 'foo', 'baz')).toEqual({ text: 'baz bar baz', count: 2 })
  })

  test('is case-insensitive, matching the search semantics (git grep -i)', () => {
    expect(replaceInLine('Foo FOO foo', 'foo', 'x')).toEqual({ text: 'x x x', count: 3 })
  })

  test('is literal — regex metacharacters in the query do not explode', () => {
    expect(replaceInLine('a.*b and a.*b', 'a.*b', 'ok')).toEqual({ text: 'ok and ok', count: 2 })
    expect(replaceInLine('axxb', 'a.*b', 'ok')).toEqual({ text: 'axxb', count: 0 })
  })

  test('replacement with $ is inserted verbatim, not as a regex group ref', () => {
    expect(replaceInLine('price', 'price', '$1.00').text).toBe('$1.00')
  })

  test('empty query replaces nothing', () => {
    expect(replaceInLine('anything', '', 'x')).toEqual({ text: 'anything', count: 0 })
  })
})

describe('matchSegments', () => {
  test('splits a line into plain and hit segments in order', () => {
    expect(matchSegments('a foo b foo', 'foo')).toEqual([
      { text: 'a ', hit: false },
      { text: 'foo', hit: true },
      { text: ' b ', hit: false },
      { text: 'foo', hit: true },
    ])
  })

  test('case-insensitive segments keep the original casing', () => {
    expect(matchSegments('xFOOx', 'foo')).toEqual([
      { text: 'x', hit: false },
      { text: 'FOO', hit: true },
      { text: 'x', hit: false },
    ])
  })

  test('no match yields one plain segment', () => {
    expect(matchSegments('abc', 'zzz')).toEqual([{ text: 'abc', hit: false }])
  })
})
