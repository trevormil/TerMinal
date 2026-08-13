import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PREFS, getPref, setPref, subscribePref, __notifyStorageEvent } from './prefs'

class FakeStorage {
  map = new Map<string, string>()
  throwOnWrite = false
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  setItem(k: string, v: string): void {
    if (this.throwOnWrite) throw new Error('quota')
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

let store: FakeStorage
const g = globalThis as { localStorage?: unknown }
let original: unknown

beforeEach(() => {
  original = g.localStorage
  store = new FakeStorage()
  g.localStorage = store
})
afterEach(() => {
  g.localStorage = original
})

describe('prefs registry', () => {
  test('every registered pref uses a distinct storage key', () => {
    const keys = Object.values(PREFS).map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('keys keep the gt.* namespace already on disk', () => {
    for (const def of Object.values(PREFS)) expect(def.key).toStartWith('gt.')
  })

  test('returns the declared default when nothing is stored', () => {
    expect(getPref('schedulesRepoFilter')).toBe('__auto__')
    expect(getPref('runsRepoFilter')).toBe('__auto__')
    expect(getPref('activityLastSeen')).toBe(0)
    expect(getPref('inboxCollapsed')).toEqual([])
  })

  test('round-trips a value through storage', () => {
    setPref('schedulesRepoFilter', 'TerMinal')
    expect(getPref('schedulesRepoFilter')).toBe('TerMinal')
  })

  test('reads values written by the pre-registry code verbatim', () => {
    // The migration must not orphan anyone's existing settings, so the key
    // strings and the on-disk encodings are exactly what the tabs wrote before.
    store.map.set('gt.schedules.repoFilter', 'TerMinal')
    store.map.set('gt.runs.repoFilter', '')
    store.map.set('gt.activity.lastSeen', '1712345678901')
    store.map.set('gt.inbox.category', 'reviews')
    store.map.set('gt.inbox.collapsed', JSON.stringify(['a', 'b']))

    expect(getPref('schedulesRepoFilter')).toBe('TerMinal')
    expect(getPref('runsRepoFilter')).toBe('') // '' means "all repos" — not the default
    expect(getPref('activityLastSeen')).toBe(1712345678901)
    expect(getPref('inboxCategory')).toBe('reviews')
    expect(getPref('inboxCollapsed')).toEqual(['a', 'b'])
  })

  test('writes the same encoding the old code wrote', () => {
    setPref('activityLastSeen', 1712345678901)
    setPref('inboxCollapsed', ['a', 'b'])
    expect(store.map.get('gt.activity.lastSeen')).toBe('1712345678901')
    expect(store.map.get('gt.inbox.collapsed')).toBe('["a","b"]')
  })

  test('falls back when a stored value is corrupt', () => {
    store.map.set('gt.inbox.collapsed', 'not json')
    expect(getPref('inboxCollapsed')).toEqual([])
    store.map.set('gt.inbox.collapsed', '{"nope":1}') // valid JSON, wrong shape
    expect(getPref('inboxCollapsed')).toEqual([])
    store.map.set('gt.activity.lastSeen', 'abc')
    expect(getPref('activityLastSeen')).toBe(0)
  })

  test('survives storage being unavailable', () => {
    g.localStorage = undefined
    expect(getPref('inboxCategory')).toBe('all')
    expect(() => setPref('inboxCategory', 'x')).not.toThrow()
  })

  test('survives a write that throws', () => {
    store.throwOnWrite = true
    expect(() => setPref('inboxCategory', 'x')).not.toThrow()
  })

  test('notifies subscribers on write in this window', () => {
    const seen: string[] = []
    const off = subscribePref('inboxCategory', (v) => seen.push(v))
    setPref('inboxCategory', 'reviews')
    setPref('inboxCategory', 'blocked')
    off()
    setPref('inboxCategory', 'ignored')
    expect(seen).toEqual(['reviews', 'blocked'])
  })

  test('a subscriber only hears about its own pref', () => {
    const seen: string[] = []
    const off = subscribePref('inboxCategory', (v) => seen.push(v))
    setPref('runsRepoFilter', 'other')
    off()
    expect(seen).toEqual([])
  })

  test('notifies subscribers when another window writes the key', () => {
    const seen: string[] = []
    const off = subscribePref('runsRepoFilter', (v) => seen.push(v))
    store.map.set('gt.runs.repoFilter', 'FromOtherWindow')
    __notifyStorageEvent('gt.runs.repoFilter')
    __notifyStorageEvent('gt.unrelated.key')
    off()
    expect(seen).toEqual(['FromOtherWindow'])
  })
})
