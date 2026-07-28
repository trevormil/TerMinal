import { describe, expect, test } from 'bun:test'
import { TranscriptStatsLruCache } from './transcript-stats-cache'

describe('TranscriptStatsLruCache', () => {
  test('keeps round-robin session reads cached by session id and mtime', () => {
    const cache = new TranscriptStatsLruCache<number>(8)
    const parses = new Map<string, number>()
    const read = (id: string) =>
      cache.get(id, 1, () => {
        parses.set(id, (parses.get(id) || 0) + 1)
        return parses.get(id) || 0
      })

    for (let i = 0; i < 4; i++) {
      expect(read('a')).toBe(1)
      expect(read('b')).toBe(1)
      expect(read('c')).toBe(1)
    }

    expect(Object.fromEntries(parses)).toEqual({ a: 1, b: 1, c: 1 })
  })

  test('evicts least-recently-used entries past capacity', () => {
    const cache = new TranscriptStatsLruCache<string>(2)
    cache.get('a', 1, () => 'a1')
    cache.get('b', 1, () => 'b1')
    cache.get('a', 1, () => 'a2')
    cache.get('c', 1, () => 'c1')

    let reparsed = false
    expect(
      cache.get('b', 1, () => {
        reparsed = true
        return 'b2'
      }),
    ).toBe('b2')
    expect(reparsed).toBe(true)
  })

  test('invalidates a session entry when mtime changes', () => {
    const cache = new TranscriptStatsLruCache<number>(8)
    let parses = 0
    const load = () => ++parses

    expect(cache.get('a', 1, load)).toBe(1)
    expect(cache.get('a', 1, load)).toBe(1)
    expect(cache.get('a', 2, load)).toBe(2)
    expect(parses).toBe(2)
  })

  test('promotes refreshed stale-mtime entries before eviction', () => {
    const cache = new TranscriptStatsLruCache<string>(2)

    cache.get('a', 1, () => 'a1')
    cache.get('b', 1, () => 'b1')
    cache.get('a', 2, () => 'a2')
    cache.get('c', 1, () => 'c1')

    expect(cache.get('a', 2, () => 'a3')).toBe('a2')
    expect(cache.get('b', 1, () => 'b2')).toBe('b2')
  })
})
