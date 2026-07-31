import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  disabledFile,
  listDisabled,
  listDisabledDetail,
  setAllDisabled,
  setDisabled,
} from './agents-disabled'

// Path resolves per call from TERMINAL_AGENTS_DIR — the real
// ~/.config/TerMinal/agents/disabled.json is never read or written here.
let dir = ''
const realDir = process.env.TERMINAL_AGENTS_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-disabled-'))
  process.env.TERMINAL_AGENTS_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_AGENTS_DIR
  else process.env.TERMINAL_AGENTS_DIR = realDir
})

const raw = () => JSON.parse(readFileSync(join(dir, 'disabled.json'), 'utf8'))

describe('disabledFile', () => {
  test('resolves under the injected dir, not the real config dir', () => {
    expect(disabledFile()).toBe(join(dir, 'disabled.json'))
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
    writeFileSync(join(dir, 'disabled.json'), JSON.stringify(['a', 'b']))
    expect(listDisabled()).toEqual(['a', 'b'])
    expect(listDisabledDetail().map((e) => e.id)).toEqual(['a', 'b'])
    expect(listDisabledDetail()[0].reason).toBeUndefined()
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
