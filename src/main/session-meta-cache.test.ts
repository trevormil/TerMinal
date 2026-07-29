import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMetaCache } from './session-meta-cache'

const roots: string[] = []
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'tm-metacache-'))
  roots.push(d)
  return join(d, 'cache.json')
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('createMetaCache', () => {
  test('parses once per (size, mtime); re-parses only when they change', () => {
    const cache = createMetaCache<{ v: number }>(tmpFile())
    let parses = 0
    const parse = () => ({ v: ++parses })

    expect(cache.get('/a.jsonl', 10, 100, parse)).toEqual({ v: 1 })
    expect(cache.get('/a.jsonl', 10, 100, parse)).toEqual({ v: 1 }) // hit
    expect(parses).toBe(1)

    expect(cache.get('/a.jsonl', 12, 101, parse)).toEqual({ v: 2 }) // grew → re-parse
    expect(parses).toBe(2)
  })

  test('caches null results too (an unparseable file is not re-read every call)', () => {
    const cache = createMetaCache<{ v: number }>(tmpFile())
    let parses = 0
    const parse = () => {
      parses++
      return null
    }
    expect(cache.get('/bad.jsonl', 5, 50, parse)).toBeNull()
    expect(cache.get('/bad.jsonl', 5, 50, parse)).toBeNull()
    expect(parses).toBe(1)
  })

  test('persists across instances via flush (survives app restart)', () => {
    const file = tmpFile()
    const first = createMetaCache<{ v: number }>(file)
    first.get('/a.jsonl', 10, 100, () => ({ v: 42 }))
    first.flush()

    const second = createMetaCache<{ v: number }>(file)
    let parsed = false
    const meta = second.get('/a.jsonl', 10, 100, () => {
      parsed = true
      return { v: 0 }
    })
    expect(meta).toEqual({ v: 42 })
    expect(parsed).toBe(false)
  })

  test('flush evicts beyond maxEntries, keeping the newest by mtime', () => {
    const file = tmpFile()
    const cache = createMetaCache<{ v: number }>(file, 2)
    cache.get('/old.jsonl', 1, 1, () => ({ v: 1 }))
    cache.get('/mid.jsonl', 1, 2, () => ({ v: 2 }))
    cache.get('/new.jsonl', 1, 3, () => ({ v: 3 }))
    cache.flush()

    const reloaded = createMetaCache<{ v: number }>(file, 2)
    let reparsed = 0
    reloaded.get('/new.jsonl', 1, 3, () => (reparsed++, { v: 0 }))
    reloaded.get('/mid.jsonl', 1, 2, () => (reparsed++, { v: 0 }))
    expect(reparsed).toBe(0)
    reloaded.get('/old.jsonl', 1, 1, () => (reparsed++, { v: 0 }))
    expect(reparsed).toBe(1) // evicted
  })
})
