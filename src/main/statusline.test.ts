import { test, expect, describe, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readStatusLine, statuslineSettingsArg } from './statusline'

const CACHE_DIR = join(homedir(), '.config', 'TerMinal', 'statusline')
const SID = '__statusline_test__'
const file = join(CACHE_DIR, `${SID}.json`)

function writeCache(obj: unknown) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(obj))
}

afterEach(() => {
  try {
    rmSync(file)
  } catch {
    /* not written */
  }
})

describe('readStatusLine', () => {
  test('parses rate_limits and context_window', () => {
    writeCache({
      model: { id: 'claude-opus-4-8', display_name: 'Opus' },
      context_window: { context_window_size: 1_000_000, used_percentage: 12 },
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
        seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
      },
      cost: { total_cost_usd: 0.42 },
    })
    const sl = readStatusLine(SID)
    expect(sl?.contextWindowSize).toBe(1_000_000)
    expect(sl?.contextUsedPct).toBe(12)
    expect(sl?.fiveHour).toEqual({ pct: 23.5, resetsAt: 1738425600 })
    expect(sl?.sevenDay).toEqual({ pct: 41.2, resetsAt: 1738857600 })
    expect(sl?.costUsd).toBe(0.42)
  })

  test('rate_limits absent (pre-first-response) → null windows, still reads context', () => {
    writeCache({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 200_000, used_percentage: 3 },
    })
    const sl = readStatusLine(SID)
    expect(sl?.fiveHour).toBeNull()
    expect(sl?.sevenDay).toBeNull()
    expect(sl?.contextWindowSize).toBe(200_000)
  })

  test('missing file → null', () => {
    expect(readStatusLine('__definitely_absent__')).toBeNull()
  })

  test('empty sessionId → null (no active session)', () => {
    expect(readStatusLine('')).toBeNull()
  })

  test('garbage json → null', () => {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, 'not json{')
    expect(readStatusLine(SID)).toBeNull()
  })
})

describe('statuslineSettingsArg', () => {
  test('points statusLine.command at the installed shim', () => {
    const j = JSON.parse(statuslineSettingsArg())
    expect(j.statusLine.type).toBe('command')
    expect(j.statusLine.command).toContain('statusline-shim.sh')
  })
})
