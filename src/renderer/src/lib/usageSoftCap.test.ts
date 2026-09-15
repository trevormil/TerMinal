import { expect, test } from 'bun:test'
import { normalizeSoftCap, exceedsSoftCap } from './usageSoftCap'

test('soft caps are optional finite percentages', () => {
  for (const value of [undefined, null, '', 'broken', -1, 101, NaN, Infinity])
    expect(normalizeSoftCap(value)).toBe(0)
  expect(normalizeSoftCap('80')).toBe(80)
  expect(normalizeSoftCap(100)).toBe(100)
  expect(normalizeSoftCap(0.5)).toBe(0.5)
})

test('warnings start at the threshold and clear below it or when disabled', () => {
  expect(exceedsSoftCap(79, 80)).toBe(false)
  expect(exceedsSoftCap(80, 80)).toBe(true)
  expect(exceedsSoftCap(120, 80)).toBe(true)
  expect(exceedsSoftCap(100, 0)).toBe(false)
  expect(exceedsSoftCap(NaN, 80)).toBe(false)
  expect(exceedsSoftCap(undefined, 80)).toBe(false)
})
