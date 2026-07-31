import { describe, expect, test } from 'bun:test'
import {
  COLUMN_COLLAPSED_KEY,
  COLUMN_WIDTH,
  COLUMN_WIDTH_KEY,
  mergedColumnCollapsed,
  mergedColumnWidth,
  migrateColumnLayout,
} from './columnLayout'

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('mergedColumnWidth', () => {
  test('keeps the wider of the two panels — nobody gets a narrower column', () => {
    // The exact regression the merge risks: a 480px cockpit silently becoming
    // the Files column's 260.
    expect(mergedColumnWidth('480', '260')).toBe(480)
    expect(mergedColumnWidth('300', '460')).toBe(460)
  })

  test('one panel set and one unset uses the one that is set', () => {
    expect(mergedColumnWidth('480', null)).toBe(480)
    expect(mergedColumnWidth(null, '500')).toBe(500)
  })

  test('neither set means no opinion — the caller leaves the default alone', () => {
    expect(mergedColumnWidth(null, null)).toBeNull()
  })

  test('clamps into the merged range instead of trusting the old bounds', () => {
    // Old cockpit floor was 240 and old Files ceiling 520; the merged column
    // is 260–720.
    expect(mergedColumnWidth('240', null)).toBe(COLUMN_WIDTH.min)
    expect(mergedColumnWidth('9000', null)).toBe(COLUMN_WIDTH.max)
  })

  test('garbage is ignored rather than read as a width', () => {
    expect(mergedColumnWidth('wide', 'null')).toBeNull()
    expect(mergedColumnWidth('-40', '0')).toBeNull()
    expect(mergedColumnWidth('abc', '400')).toBe(400)
  })
})

describe('mergedColumnCollapsed', () => {
  test('collapsed only when BOTH panels were collapsed', () => {
    expect(mergedColumnCollapsed('1', '1')).toBe(true)
    expect(mergedColumnCollapsed('1', '0')).toBe(false)
    expect(mergedColumnCollapsed('0', '1')).toBe(false)
    expect(mergedColumnCollapsed('0', '0')).toBe(false)
  })

  test('an unset panel falls back to ITS OWN old default', () => {
    // Files defaulted closed, so a hidden cockpit + untouched Files is hidden.
    expect(mergedColumnCollapsed('1', null)).toBe(true)
    expect(mergedColumnCollapsed('0', null)).toBe(false)
    // The cockpit defaulted open, so an open Files column can't be the only
    // thing keeping it open — but a collapsed one can't close it either.
    expect(mergedColumnCollapsed(null, '0')).toBe(false)
    expect(mergedColumnCollapsed(null, '1')).toBe(false)
  })

  test('neither set means no opinion — nothing is written', () => {
    expect(mergedColumnCollapsed(null, null)).toBeNull()
  })
})

describe('migrateColumnLayout', () => {
  test('folds a Files-only layout into the canonical keys and drops the old ones', () => {
    const s = fakeStorage({ 'gt.filesWidth': '500', 'gt.filesCollapsed': '0' })
    migrateColumnLayout(s)

    expect(s.map.get(COLUMN_WIDTH_KEY)).toBe('500')
    expect(s.map.get(COLUMN_COLLAPSED_KEY)).toBe('0')
    expect(s.map.has('gt.filesWidth')).toBe(false)
    expect(s.map.has('gt.filesCollapsed')).toBe(false)
  })

  test('a wide cockpit survives a narrow Files column', () => {
    const s = fakeStorage({
      'gt.cockpitWidth': '480',
      'gt.cockpitCollapsed': '0',
      'gt.filesWidth': '260',
      'gt.filesCollapsed': '1',
    })
    migrateColumnLayout(s)

    expect(s.map.get(COLUMN_WIDTH_KEY)).toBe('480')
    expect(s.map.get(COLUMN_COLLAPSED_KEY)).toBe('0')
  })

  test('both panels hidden stays hidden', () => {
    const s = fakeStorage({ 'gt.cockpitCollapsed': '1', 'gt.filesCollapsed': '1' })
    migrateColumnLayout(s)
    expect(s.map.get(COLUMN_COLLAPSED_KEY)).toBe('1')
  })

  test('a fresh install is left completely untouched', () => {
    const s = fakeStorage()
    migrateColumnLayout(s)
    expect([...s.map.keys()]).toEqual([])
  })

  test('re-running cannot undo a later collapse — the point of deleting the old keys', () => {
    const s = fakeStorage({ 'gt.cockpitCollapsed': '0', 'gt.filesCollapsed': '0' })
    migrateColumnLayout(s)
    // User then hides the column; the app writes the canonical key.
    s.setItem(COLUMN_COLLAPSED_KEY, '1')
    migrateColumnLayout(s)
    expect(s.map.get(COLUMN_COLLAPSED_KEY)).toBe('1')
  })

  test('a hostile storage is survivable', () => {
    const hostile = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(() => migrateColumnLayout(hostile)).not.toThrow()
    expect(() => migrateColumnLayout(null)).not.toThrow()
  })
})
