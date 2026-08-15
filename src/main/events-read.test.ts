import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActivityEvent } from '../shared/types/activity'

// events.ts imports Electron's Notification, which doesn't exist here.
void mock.module('electron', () => ({
  Notification: class {
    show(): void {}
    static isSupported(): boolean {
      return true
    }
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

// The feed's READ surface, exercised against a throwaway config dir. Writes are
// not exercised here on purpose: the effect guard blocks feed appends under
// test, so the fixtures are written to the log directly, exactly as an external
// appender (bin/gt-notify, terminal-cli) does.
const realDir = process.env.TERMINAL_CONFIG_DIR
let dir = ''
let log = ''

const ev = (n: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `e${n}`,
  ts: 1_000 + n,
  kind: 'info',
  title: `event ${n}`,
  ...over,
})

const write = (file: string, events: ActivityEvent[]): void =>
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'events-read-'))
  process.env.TERMINAL_CONFIG_DIR = dir
  log = join(dir, 'activity.jsonl')
})
afterEach(() => {
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
  rmSync(dir, { recursive: true, force: true })
})

describe('readActivity', () => {
  test('returns the newest events first, capped at the limit', async () => {
    const { readActivity } = await import('./events')
    write(
      log,
      Array.from({ length: 300 }, (_, i) => ev(i)),
    )
    const out = readActivity(5)
    expect(out.map((e) => e.id)).toEqual(['e299', 'e298', 'e297', 'e296', 'e295'])
  })

  test('does NOT rewrite the log it read — reading is not a compaction', async () => {
    const { readActivity } = await import('./events')
    write(
      log,
      Array.from({ length: 3_000 }, (_, i) => ev(i)),
    )
    const before = Bun.file(log).size
    readActivity(10)
    expect(Bun.file(log).size).toBe(before)
    // and the oldest event is still there to page back to
    const { readActivityPageAt } = await import('./events')
    let cursor = readActivityPageAt(null, 2_000).cursor
    const page = readActivityPageAt(cursor, 2_000)
    expect(page.events.at(-1)?.id).toBe('e0')
  })

  test('spans rotated generations', async () => {
    const { readActivity } = await import('./events')
    write(join(dir, 'activity-1.jsonl'), [ev(0), ev(1)])
    write(log, [ev(2)])
    expect(readActivity(10).map((e) => e.id)).toEqual(['e2', 'e1', 'e0'])
  })
})

describe('readActivityPageAt', () => {
  test('walks the whole feed page by page and then reports no more', async () => {
    const { readActivityPageAt } = await import('./events')
    write(
      log,
      Array.from({ length: 120 }, (_, i) => ev(i)),
    )
    const first = readActivityPageAt(null, 50)
    expect(first.events.length).toBe(50)
    expect(first.events[0].id).toBe('e119')
    const second = readActivityPageAt(first.cursor, 50)
    expect(second.events[0].id).toBe('e69')
    const third = readActivityPageAt(second.cursor, 50)
    expect(third.events.map((e) => e.id).at(-1)).toBe('e0')
    expect(third.cursor).toBeNull()
  })
})

describe('unseenActivityCount', () => {
  test('counts only the named kinds newer than `since`', async () => {
    const { unseenActivityCount } = await import('./events')
    write(log, [
      ev(0, { kind: 'error' }),
      ev(1, { kind: 'info' }),
      ev(2, { kind: 'tests-fail' }),
      ev(3, { kind: 'blocked' }),
    ])
    expect(unseenActivityCount(1_000, ['error', 'blocked', 'tests-fail'])).toBe(2)
    expect(unseenActivityCount(0, ['error', 'blocked', 'tests-fail'])).toBe(3)
  })

  test('a repeat poll on an unchanged file is served without re-reading it', async () => {
    const { unseenActivityCount } = await import('./events')
    write(log, [ev(0, { kind: 'error' })])
    expect(unseenActivityCount(0, ['error'])).toBe(1)
    // Swap the contents for a same-length line that would count 0. The poll
    // still answers 1, which is only possible if it never parsed the file —
    // the steady-state badge may cost a stat() and nothing more.
    const decoy = JSON.stringify(ev(0, { kind: 'error' })).replace('"error"', '"innoc"')
    expect(decoy.length).toBe(JSON.stringify(ev(0, { kind: 'error' })).length)
    writeFileSync(log, decoy + '\n')
    expect(unseenActivityCount(0, ['error'])).toBe(1)
  })

  test('the cached count is invalidated when the log grows', async () => {
    const { unseenActivityCount } = await import('./events')
    write(log, [ev(0, { kind: 'error' })])
    expect(unseenActivityCount(0, ['error'])).toBe(1)
    appendFileSync(log, JSON.stringify(ev(1, { kind: 'error' })) + '\n')
    expect(unseenActivityCount(0, ['error'])).toBe(2)
  })

  test('different badge arguments are not served each other’s cached count', async () => {
    const { unseenActivityCount } = await import('./events')
    write(log, [ev(0, { kind: 'error' }), ev(1, { kind: 'info' })])
    expect(unseenActivityCount(0, ['error'])).toBe(1)
    expect(unseenActivityCount(0, ['error', 'info'])).toBe(2)
    expect(unseenActivityCount(1_000, ['error', 'info'])).toBe(1)
  })
})

describe('maybeRotateActivityLog', () => {
  test('rotates the live log aside once it passes the size threshold', async () => {
    const { maybeRotateActivityLog, readActivity } = await import('./events')
    write(
      log,
      Array.from({ length: 200 }, (_, i) => ev(i, { detail: 'x'.repeat(1_000) })),
    )
    expect(maybeRotateActivityLog(10_000)).toBe(true)
    expect(existsSync(log)).toBe(false)
    expect(existsSync(join(dir, 'activity-1.jsonl'))).toBe(true)
    // history is still readable through the rotated generation
    expect(readActivity(3).map((e) => e.id)).toEqual(['e199', 'e198', 'e197'])
  })

  test('leaves a small log alone', async () => {
    const { maybeRotateActivityLog } = await import('./events')
    write(log, [ev(0)])
    expect(maybeRotateActivityLog(10_000)).toBe(false)
    expect(existsSync(join(dir, 'activity-1.jsonl'))).toBe(false)
  })
})
