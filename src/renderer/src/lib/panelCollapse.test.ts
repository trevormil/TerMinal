import { describe, expect, test } from 'bun:test'
import { readCollapsed, writeCollapsed } from './panelCollapse'

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('readCollapsed', () => {
  test("'1' is collapsed and '0' is expanded, whatever the default is", () => {
    const s = fakeStorage({
      'gt.workColumn.files.collapsed': '1',
      'gt.cockpitCollapsed': '0',
    })
    expect(readCollapsed('gt.workColumn.files.collapsed', false, s)).toBe(true)
    expect(readCollapsed('gt.cockpitCollapsed', true, s)).toBe(false)
  })

  test('an unset key falls back to the caller default — closed for a hidden section…', () => {
    expect(readCollapsed('gt.workColumn.mr-summary.collapsed', true, fakeStorage())).toBe(true)
  })

  test('…and open for the work column itself', () => {
    expect(readCollapsed('gt.cockpitCollapsed', false, fakeStorage())).toBe(false)
  })

  test('an explicit "expanded" survives a default of closed (the regression risk)', () => {
    const s = fakeStorage({ 'gt.workColumn.mr-summary.collapsed': '0' })
    expect(readCollapsed('gt.workColumn.mr-summary.collapsed', true, s)).toBe(false)
  })

  test('garbage values are treated as no opinion, not as collapsed', () => {
    expect(readCollapsed('k', false, fakeStorage({ k: 'true' }))).toBe(false)
    expect(readCollapsed('k', true, fakeStorage({ k: '' }))).toBe(true)
  })

  test('unavailable storage falls back instead of throwing', () => {
    expect(readCollapsed('k', true, null)).toBe(true)
    const hostile = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {},
    }
    expect(readCollapsed('k', false, hostile)).toBe(false)
  })
})

describe('writeCollapsed', () => {
  test('round-trips through readCollapsed in both directions', () => {
    const s = fakeStorage()
    writeCollapsed('gt.cockpitCollapsed', true, s)
    expect(readCollapsed('gt.cockpitCollapsed', false, s)).toBe(true)
    writeCollapsed('gt.cockpitCollapsed', false, s)
    expect(readCollapsed('gt.cockpitCollapsed', true, s)).toBe(false)
    expect(s.map.get('gt.cockpitCollapsed')).toBe('0')
  })

  test('never throws when storage is unavailable', () => {
    expect(() => writeCollapsed('k', true, null)).not.toThrow()
  })
})
