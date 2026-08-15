import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listActivityTool } from './writes'

// list_activity is the agents' window on the feed. It read the whole log to
// hand back 50 rows; these pin the behaviour the tail reader has to preserve.
const realDir = process.env.TERMINAL_CONFIG_DIR
let dir = ''
let log = ''

type Ev = { id: string; ts: number; kind: string; title: string; detail?: string; repo?: string }
const ev = (n: number, over: Partial<Ev> = {}): Ev => ({
  id: `e${n}`,
  ts: 1_000 + n,
  kind: 'info',
  title: `event ${n}`,
  ...over,
})
const write = (file: string, events: Ev[]): void =>
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-activity-'))
  process.env.TERMINAL_CONFIG_DIR = dir
  log = join(dir, 'activity.jsonl')
})
afterEach(() => {
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
  rmSync(dir, { recursive: true, force: true })
})

describe('listActivityTool', () => {
  test('returns the newest events first, capped at limit', () => {
    write(
      log,
      Array.from({ length: 100 }, (_, i) => ev(i)),
    )
    expect(listActivityTool({ limit: 3 }).map((e) => e.id)).toEqual(['e99', 'e98', 'e97'])
  })

  test('an empty or missing log lists nothing', () => {
    expect(listActivityTool({})).toEqual([])
  })

  test('filters by kind, repo substring and sinceMs', () => {
    write(log, [
      ev(0, { kind: 'error', repo: 'me/Alpha' }),
      ev(1, { kind: 'info', repo: 'me/Alpha' }),
      ev(2, { kind: 'error', repo: 'me/Beta' }),
      ev(3, { kind: 'error', repo: 'me/Alpha' }),
    ])
    expect(listActivityTool({ kind: 'error' }).map((e) => e.id)).toEqual(['e3', 'e2', 'e0'])
    expect(listActivityTool({ repo: 'alpha' }).map((e) => e.id)).toEqual(['e3', 'e1', 'e0'])
    expect(listActivityTool({ kind: 'error', sinceMs: 1_002 }).map((e) => e.id)).toEqual([
      'e3',
      'e2',
    ])
  })

  test('a filtered page is filled with matches, not thinned by the limit', () => {
    write(
      log,
      Array.from({ length: 200 }, (_, i) => ev(i, { kind: i % 20 === 0 ? 'error' : 'info' })),
    )
    expect(listActivityTool({ kind: 'error', limit: 4 }).map((e) => e.id)).toEqual([
      'e180',
      'e160',
      'e140',
      'e120',
    ])
  })

  test('drops internal fields and truncates long details', () => {
    write(log, [ev(0, { detail: 'x'.repeat(500), repo: 'me/Alpha' })])
    const [out] = listActivityTool({})
    expect(out.detail).toBe('x'.repeat(200))
    expect(out.repoRoot).toBeUndefined()
    expect(Object.keys(out).sort()).toEqual(['detail', 'id', 'kind', 'repo', 'title', 'ts'])
  })

  test('reads across rotated generations', () => {
    write(join(dir, 'activity-1.jsonl'), [ev(0)])
    write(log, [ev(1)])
    expect(listActivityTool({ limit: 10 }).map((e) => e.id)).toEqual(['e1', 'e0'])
  })
})
