import { test, expect, describe } from 'bun:test'
import { ciTone, verdictTone, testTone } from './badges'

describe('ciTone', () => {
  test('success → green, failed → red', () => {
    expect(ciTone('success')).toBe('green')
    expect(ciTone('failed')).toBe('red')
  })

  test('running / pending → yellow', () => {
    expect(ciTone('running')).toBe('yellow')
    expect(ciTone('pending')).toBe('yellow')
  })

  test('manual → blue', () => {
    expect(ciTone('manual')).toBe('blue')
  })

  test('skipped / canceled / unknown / empty → mute', () => {
    expect(ciTone('skipped')).toBe('mute')
    expect(ciTone('canceled')).toBe('mute')
    expect(ciTone('')).toBe('mute')
  })

  test('case-insensitive', () => {
    expect(ciTone('SUCCESS')).toBe('green')
  })
})

describe('verdictTone / testTone', () => {
  test('verdict tones', () => {
    expect(verdictTone('approve')).toBe('green')
    expect(verdictTone('request-changes')).toBe('red')
    expect(verdictTone('blocked')).toBe('red')
    expect(verdictTone('anything-else')).toBe('mute')
  })

  test('test-status tones', () => {
    expect(testTone('pass')).toBe('green')
    expect(testTone('fail')).toBe('red')
    expect(testTone('unknown')).toBe('mute')
  })
})
