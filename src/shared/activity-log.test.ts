import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActivityEvent } from './types/activity'
import {
  activityGenerationPaths,
  readActivityPage,
  readActivityDelta,
  countActivityEvents,
  countActivitySince,
  rotateActivityLog,
  type ActivityCursor,
} from './activity-log'

let dir = ''
let base = ''

const ev = (n: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `e${n}`,
  ts: 1_000 + n,
  kind: 'info',
  title: `event ${n}`,
  ...over,
})

const write = (file: string, events: ActivityEvent[]): void =>
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'activity-log-'))
  base = join(dir, 'activity.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('activityGenerationPaths', () => {
  test('names rotated generations next to the live log', () => {
    expect(activityGenerationPaths(base)).toEqual([
      base,
      join(dir, 'activity-1.jsonl'),
      join(dir, 'activity-2.jsonl'),
    ])
  })
})

describe('readActivityPage', () => {
  test('returns nothing for a missing log', () => {
    expect(readActivityPage(base, { limit: 10 })).toEqual({ events: [], cursor: null })
  })

  test('returns the newest events first, capped at limit', () => {
    write(
      base,
      Array.from({ length: 50 }, (_, i) => ev(i)),
    )
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual([
      'e49',
      'e48',
      'e47',
      'e46',
      'e45',
      'e44',
      'e43',
      'e42',
      'e41',
      'e40',
    ])
    expect(page.cursor).not.toBeNull()
  })

  test('a cursor walks strictly older pages with no gap and no repeat', () => {
    write(
      base,
      Array.from({ length: 1000 }, (_, i) => ev(i)),
    )
    const seen: string[] = []
    let cursor: ActivityCursor | null | undefined = undefined
    for (let guard = 0; guard < 100; guard++) {
      const page: { events: ActivityEvent[]; cursor: ActivityCursor | null } = readActivityPage(
        base,
        { limit: 37, cursor },
      )
      seen.push(...page.events.map((e) => e.id))
      cursor = page.cursor
      if (!cursor) break
    }
    expect(cursor).toBeNull()
    expect(seen.length).toBe(1000)
    expect(new Set(seen).size).toBe(1000)
    expect(seen[0]).toBe('e999')
    expect(seen[999]).toBe('e0')
  })

  test('a cursor landing exactly on a page boundary still yields the next event', () => {
    write(
      base,
      Array.from({ length: 4 }, (_, i) => ev(i)),
    )
    const first = readActivityPage(base, { limit: 2 })
    expect(first.events.map((e) => e.id)).toEqual(['e3', 'e2'])
    const second = readActivityPage(base, { limit: 2, cursor: first.cursor })
    expect(second.events.map((e) => e.id)).toEqual(['e1', 'e0'])
    expect(second.cursor).toBeNull()
  })

  test('ignores a partially written trailing line and reads the rest', () => {
    write(
      base,
      Array.from({ length: 5 }, (_, i) => ev(i)),
    )
    appendFileSync(base, '{"id":"torn","ts":9999,"kind":"info","tit')
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual(['e4', 'e3', 'e2', 'e1', 'e0'])
  })

  test('skips a garbled line in the middle without losing its neighbours', () => {
    writeFileSync(
      base,
      [JSON.stringify(ev(0)), 'not json at all', JSON.stringify(ev(2))].join('\n') + '\n',
    )
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual(['e2', 'e0'])
  })

  test('reads across rotated generations, newest generation first', () => {
    write(join(dir, 'activity-2.jsonl'), [ev(0), ev(1)])
    write(join(dir, 'activity-1.jsonl'), [ev(2), ev(3)])
    write(base, [ev(4), ev(5)])
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1', 'e0'])
    expect(page.cursor).toBeNull()
  })

  test('paginating spans a generation boundary', () => {
    write(join(dir, 'activity-1.jsonl'), [ev(0), ev(1), ev(2)])
    write(base, [ev(3), ev(4)])
    const first = readActivityPage(base, { limit: 3 })
    expect(first.events.map((e) => e.id)).toEqual(['e4', 'e3', 'e2'])
    const second = readActivityPage(base, { limit: 3, cursor: first.cursor })
    expect(second.events.map((e) => e.id)).toEqual(['e1', 'e0'])
    expect(second.cursor).toBeNull()
  })

  test('a filter applies before the limit so a page is full of matches', () => {
    write(
      base,
      Array.from({ length: 100 }, (_, i) => ev(i, { kind: i % 10 === 0 ? 'error' : 'info' })),
    )
    const page = readActivityPage(base, { limit: 5, filter: (e) => e.kind === 'error' })
    expect(page.events.map((e) => e.id)).toEqual(['e90', 'e80', 'e70', 'e60', 'e50'])
  })

  test('reads a large log without loading it whole (lines longer than one block)', () => {
    const fat = 'x'.repeat(200_000)
    write(base, [ev(0, { detail: fat }), ev(1, { detail: fat }), ev(2)])
    const page = readActivityPage(base, { limit: 2 })
    expect(page.events.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(page.events[1].detail).toBe(fat)
  })
})

describe('readActivityDelta', () => {
  test('reads only the bytes appended since the last size', () => {
    write(base, [ev(0), ev(1)])
    const first = readActivityDelta(base, 0)
    expect(first.events.map((e) => e.id)).toEqual(['e0', 'e1'])
    expect(first.size).toBe(statSync(base).size)

    appendFileSync(base, JSON.stringify(ev(2)) + '\n')
    const second = readActivityDelta(base, first.size)
    expect(second.events.map((e) => e.id)).toEqual(['e2'])
    expect(second.size).toBe(statSync(base).size)
  })

  test('stops at the last complete line and resumes from there', () => {
    write(base, [ev(0)])
    const partial = JSON.stringify(ev(1))
    appendFileSync(base, partial.slice(0, 10))
    const first = readActivityDelta(base, 0)
    expect(first.events.map((e) => e.id)).toEqual(['e0'])
    // the torn bytes are NOT consumed — size stops at the last newline
    expect(first.size).toBeLessThan(statSync(base).size)

    appendFileSync(base, partial.slice(10) + '\n')
    const second = readActivityDelta(base, first.size)
    expect(second.events.map((e) => e.id)).toEqual(['e1'])
  })

  test('restarts from zero when the file shrank (cleared or rotated)', () => {
    write(base, [ev(0), ev(1), ev(2)])
    const big = statSync(base).size
    write(base, [ev(9)])
    const delta = readActivityDelta(base, big)
    expect(delta.events.map((e) => e.id)).toEqual(['e9'])
  })

  test('a missing file yields nothing and size 0', () => {
    expect(readActivityDelta(base, 120)).toEqual({ events: [], size: 0 })
  })
})

describe('countActivitySince', () => {
  test('counts only matching kinds newer than the timestamp', () => {
    write(base, [
      ev(0, { kind: 'error' }),
      ev(1, { kind: 'info' }),
      ev(2, { kind: 'blocked' }),
      ev(3, { kind: 'error' }),
    ])
    expect(countActivitySince(base, 1_001, ['error', 'blocked'])).toBe(2)
    expect(countActivitySince(base, 0, ['error', 'blocked'])).toBe(3)
    expect(countActivitySince(base, 9_999, ['error'])).toBe(0)
  })

  test('stops scanning as soon as it reaches events at or before `since`', () => {
    write(
      base,
      Array.from({ length: 20_000 }, (_, i) => ev(i, { kind: i > 19_996 ? 'error' : 'info' })),
    )
    // maxScan is deliberately tiny: a correct implementation early-exits long
    // before it, because everything older than `since` ends the reverse walk.
    expect(countActivitySince(base, 1_000 + 19_990, ['error'], 50)).toBe(3)
  })

  test('counts across rotated generations', () => {
    write(join(dir, 'activity-1.jsonl'), [ev(0, { kind: 'error' })])
    write(base, [ev(1, { kind: 'error' })])
    expect(countActivitySince(base, 0, ['error'])).toBe(2)
  })
})

describe('countActivityEvents', () => {
  test('a missing log counts zero', () => {
    expect(countActivityEvents(base)).toBe(0)
  })

  test('counts every complete event, ignoring a torn trailing append', () => {
    write(base, [ev(0), ev(1), ev(2)])
    appendFileSync(base, '{"id":"torn","ts":9')
    expect(countActivityEvents(base)).toBe(3)
  })

  test('spans rotated generations', () => {
    write(join(dir, 'activity-1.jsonl'), [ev(0), ev(1)])
    write(base, [ev(2)])
    expect(countActivityEvents(base)).toBe(3)
  })

  test('agrees with what pagination actually returns', () => {
    const events = Array.from({ length: 137 }, (_, i) => ev(i))
    write(base, events)
    let got = 0
    let cursor: ActivityCursor | null = null
    for (;;) {
      const page = readActivityPage(base, { limit: 50, cursor })
      got += page.events.length
      if (!page.cursor) break
      cursor = page.cursor
    }
    expect(countActivityEvents(base)).toBe(got)
  })
})

describe('rotateActivityLog', () => {
  test('does nothing below the threshold', () => {
    write(base, [ev(0)])
    expect(rotateActivityLog(base, 10_000)).toBe(false)
    expect(existsSync(join(dir, 'activity-1.jsonl'))).toBe(false)
  })

  test('renames the live log to generation 1 and starts a fresh one', () => {
    write(base, [ev(0), ev(1)])
    expect(rotateActivityLog(base, 10)).toBe(true)
    expect(existsSync(base)).toBe(false)
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual(['e1', 'e0'])
  })

  test('keeps two generations and drops the oldest', () => {
    write(base, [ev(0)])
    rotateActivityLog(base, 1)
    write(base, [ev(1)])
    rotateActivityLog(base, 1)
    write(base, [ev(2)])
    rotateActivityLog(base, 1)
    write(base, [ev(3)])
    // e0 has aged out; e1..e3 survive across the generations
    const page = readActivityPage(base, { limit: 10 })
    expect(page.events.map((e) => e.id)).toEqual(['e3', 'e2', 'e1'])
  })

  test('is a no-op when the log does not exist', () => {
    expect(rotateActivityLog(base, 1)).toBe(false)
  })
})
