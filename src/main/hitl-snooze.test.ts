import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearSnooze,
  isSnoozedAt,
  pruneSnoozes,
  readSnoozes,
  setSnooze,
  snoozePresets,
} from './hitl-snooze'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hitl-snooze-'))
  dirs.push(dir)
  return join(dir, 'nested', 'hitl-snooze.json')
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const NOW = 1_000_000

describe('snooze persistence', () => {
  test('an unwritten store reads as empty', () => {
    expect(readSnoozes(tempFile())).toEqual({})
  })

  test('a snooze survives a reload — this is the restart guarantee', () => {
    const file = tempFile()
    setSnooze(file, 'h1', NOW + 5000, NOW)
    // Fresh read, no in-memory state carried over.
    expect(readSnoozes(file)).toEqual({ h1: NOW + 5000 })
    expect(isSnoozedAt(readSnoozes(file), 'h1', NOW)).toBe(true)
  })

  test('a snooze in the past un-snoozes rather than persisting a dead entry', () => {
    const file = tempFile()
    setSnooze(file, 'h1', NOW + 5000, NOW)
    setSnooze(file, 'h1', NOW - 1, NOW)
    expect(readSnoozes(file)).toEqual({})
  })

  test('clearSnooze removes only the named item', () => {
    const file = tempFile()
    setSnooze(file, 'h1', NOW + 5000, NOW)
    setSnooze(file, 'h2', NOW + 5000, NOW)
    clearSnooze(file, 'h1', NOW)
    expect(Object.keys(readSnoozes(file))).toEqual(['h2'])
  })

  test('writing prunes entries that came due while the app was closed', () => {
    const file = tempFile()
    setSnooze(file, 'old', NOW + 10, NOW)
    setSnooze(file, 'new', NOW + 10_000, NOW)
    setSnooze(file, 'other', NOW + 20_000, NOW + 100) // now past `old`'s expiry
    expect(Object.keys(readSnoozes(file)).sort()).toEqual(['new', 'other'])
  })

  test('a corrupt or non-object store degrades to empty, never throws', () => {
    const file = tempFile()
    setSnooze(file, 'h1', NOW + 1000, NOW)
    writeFileSync(file, '[1,2,3]')
    expect(readSnoozes(file)).toEqual({})
    writeFileSync(file, 'not json')
    expect(readSnoozes(file)).toEqual({})
  })

  test('non-numeric values are dropped rather than trusted', () => {
    const file = tempFile()
    setSnooze(file, 'h1', NOW + 1000, NOW)
    writeFileSync(file, JSON.stringify({ h1: 'soon', h2: NOW + 1000 }))
    expect(readSnoozes(file)).toEqual({ h2: NOW + 1000 })
  })
})

describe('isSnoozedAt / pruneSnoozes', () => {
  test('the boundary instant is due, not snoozed', () => {
    expect(isSnoozedAt({ a: NOW }, 'a', NOW)).toBe(false)
    expect(isSnoozedAt({ a: NOW + 1 }, 'a', NOW)).toBe(true)
  })

  test('an unknown id is never snoozed', () => {
    expect(isSnoozedAt({}, 'nope', NOW)).toBe(false)
  })

  test('pruning keeps only future entries', () => {
    expect(pruneSnoozes({ a: NOW - 1, b: NOW, c: NOW + 1 }, NOW)).toEqual({ c: NOW + 1 })
  })
})

describe('snoozePresets', () => {
  test('"tomorrow 9am" is a real calendar instant, not now + 24h', () => {
    const lateNight = new Date('2026-07-31T23:55:00').getTime()
    const tomorrow = snoozePresets(lateNight).find((p) => p.id === 'tomorrow')!
    const d = new Date(tomorrow.until)
    expect(d.getHours()).toBe(9)
    expect(d.getDate()).toBe(1) // August 1st
  })

  test('every preset is strictly in the future', () => {
    for (const p of snoozePresets(NOW)) expect(p.until).toBeGreaterThan(NOW)
  })
})
