import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  disabledFile,
  isDisabled,
  listDisabled,
  listDisabledDetail,
  setAllDisabled,
  setDisabled,
} from './agents-disabled'

// Path resolves per call through configPath() — the real
// ~/.config/TerMinal/agents/disabled.json is never read or written here.
let dir = ''
const realDir = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-disabled-'))
  process.env.TERMINAL_CONFIG_DIR = dir
  mkdirSync(join(dir, 'agents'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
})

const file = () => join(dir, 'agents', 'disabled.json')
const raw = () => JSON.parse(readFileSync(file(), 'utf8'))

describe('disabledFile', () => {
  test('resolves under the injected dir, not the real config dir', () => {
    expect(disabledFile()).toBe(join(dir, 'agents', 'disabled.json'))
  })
})

describe('setDisabled', () => {
  test('records the reason and disabled-at alongside the id', () => {
    setDisabled('nightly', true, 'auto-disabled after 3 consecutive failures')
    const [entry] = listDisabledDetail()
    expect(entry.id).toBe('nightly')
    expect(entry.reason).toBe('auto-disabled after 3 consecutive failures')
    expect(entry.disabledAt).toBeGreaterThan(0)
  })

  test('keeps the legacy scheduleIds array so bin/terminal-cron still reads it', () => {
    setDisabled('nightly', true, 'because')
    expect(raw().scheduleIds).toEqual(['nightly'])
  })

  test('re-enabling drops both the id and its reason', () => {
    setDisabled('nightly', true, 'because')
    setDisabled('nightly', false)
    expect(listDisabled()).toEqual([])
    expect(listDisabledDetail()).toEqual([])
    expect(raw().reasons).toEqual({})
  })

  test('a reasonless disable still produces an entry', () => {
    setDisabled('manual', true)
    const [entry] = listDisabledDetail()
    expect(entry).toMatchObject({ id: 'manual' })
    expect(entry.reason).toBeUndefined()
  })

  test('re-disabling an already-disabled id does not overwrite the original reason', () => {
    setDisabled('nightly', true, 'circuit broken')
    setDisabled('nightly', true)
    expect(listDisabledDetail()[0].reason).toBe('circuit broken')
  })
})

describe('legacy on-disk shapes', () => {
  test('reads a bare array of ids with no reasons', () => {
    writeFileSync(file(), JSON.stringify(['a', 'b']))
    expect(listDisabled()).toEqual(['a', 'b'])
    expect(listDisabledDetail().map((e) => e.id)).toEqual(['a', 'b'])
    expect(listDisabledDetail()[0].reason).toBeUndefined()
  })

  // This is what is actually on disk today — the shape bin/terminal-cron and
  // every pre-existing install writes. The back-compat guarantee this PR rests
  // on is exactly that this keeps reading, in both directions.
  test('reads the { scheduleIds } object shape that has no reasons key at all', () => {
    writeFileSync(file(), JSON.stringify({ scheduleIds: ['a', 'b'] }, null, 2))
    expect(listDisabled()).toEqual(['a', 'b'])
    expect(listDisabledDetail()).toEqual([
      { id: 'a', reason: undefined, disabledAt: 0 },
      { id: 'b', reason: undefined, disabledAt: 0 },
    ])
    expect(isDisabled('a')).toBe(true)
  })

  test('a reasonless legacy record survives a toggle round-trip', () => {
    writeFileSync(file(), JSON.stringify({ scheduleIds: ['a', 'b'] }))
    setDisabled('c', true, 'newly broken')
    // Pre-existing ids keep their disabled state; only the new one gains a reason.
    expect(listDisabled().sort()).toEqual(['a', 'b', 'c'])
    expect([...raw().scheduleIds].sort()).toEqual(['a', 'b', 'c'])
    const byId = new Map(listDisabledDetail().map((e) => [e.id, e]))
    expect(byId.get('a')?.reason).toBeUndefined()
    expect(byId.get('c')?.reason).toBe('newly broken')
  })

  test('a missing file is empty, not a throw', () => {
    expect(listDisabled()).toEqual([])
    expect(listDisabledDetail()).toEqual([])
  })
})

describe('setAllDisabled', () => {
  test('applies one shared reason across every id and clears them together', () => {
    setAllDisabled(['a', 'b'], true, 'paused from the Schedules tab')
    expect(listDisabledDetail().map((e) => e.reason)).toEqual([
      'paused from the Schedules tab',
      'paused from the Schedules tab',
    ])
    setAllDisabled(['a', 'b'], false)
    expect(listDisabled()).toEqual([])
  })
})
