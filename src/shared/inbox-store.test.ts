import { describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HitlItem } from './types/activity'
import type { InboxArchivePage } from './inbox-store'
import {
  findInboxItem,
  inboxCounts,
  inboxPaths,
  inboxPathsFor,
  isInboxLive,
  readInboxArchive,
  readInboxCounts,
  readInboxLive,
  readLinesBackward,
  updateInbox,
} from './inbox-store'

// Every path here is a fresh temp dir — nothing touches ~/.config/TerMinal.
const fresh = (): ReturnType<typeof inboxPaths> =>
  inboxPaths(mkdtempSync(join(tmpdir(), 'tm-inbox-')))

let seq = 0
function item(over: Partial<HitlItem> = {}): HitlItem {
  seq++
  return {
    id: over.id ?? `i${seq}`,
    title: over.title ?? `item ${seq}`,
    source: 'skill',
    status: 'open',
    createdAt: seq,
    ...over,
  } as HitlItem
}

const archiveLines = (p: { archive: string }): unknown[] =>
  existsSync(p.archive)
    ? readFileSync(p.archive, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : []

describe('the live predicate', () => {
  test('unread and unresolved is live; read or resolved is not', () => {
    expect(isInboxLive({ status: 'open' })).toBe(true)
    expect(isInboxLive({ status: 'open', readAt: 5 })).toBe(false)
    expect(isInboxLive({ status: 'resolved' })).toBe(false)
    // Both spellings of "dealt with" retire an item — the app resolves by
    // stamping readAt, the MCP server by stamping status.
    expect(isInboxLive({ status: 'resolved', readAt: undefined })).toBe(false)
  })
})

describe('hot file holds only live items', () => {
  test('filing appends to the hot file and never touches the archive', () => {
    const p = fresh()
    expect(updateInbox(p, (live) => [item({ id: 'a' }), ...live])).toBe(true)
    expect(readInboxLive(p).map((h) => h.id)).toEqual(['a'])
    expect(archiveLines(p)).toEqual([])
  })

  test('retiring an item moves it out of the hot file into the archive', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' }), item({ id: 'b' })])

    updateInbox(p, (live) => live.map((h) => (h.id === 'a' ? { ...h, readAt: 99 } : h)))

    expect(readInboxLive(p).map((h) => h.id)).toEqual(['b'])
    expect(archiveLines(p).map((h) => (h as HitlItem).id)).toEqual(['a'])
    expect(readInboxArchive(p).items.map((h) => h.id)).toEqual(['a'])
  })

  test('resolving 500 of 501 items rewrites only the one-item hot file', () => {
    const p = fresh()
    const many = Array.from({ length: 501 }, (_, i) => item({ id: `x${i}` }))
    updateInbox(p, () => many)

    updateInbox(p, (live) => live.map((h) => (h.id === 'x500' ? h : { ...h, readAt: 1 })))

    expect(readInboxLive(p).map((h) => h.id)).toEqual(['x500'])
    expect(statSync(p.hot).size).toBeLessThan(1000)
    expect(readInboxArchive(p, { limit: 500 }).items.length).toBe(500)
  })
})

describe('migration of a legacy oversized hitl.json', () => {
  test('a read splits resolved history out and leaves only live items hot', () => {
    const p = fresh()
    const legacy = [
      item({ id: 'live1' }),
      item({ id: 'read1', readAt: 10 }),
      item({ id: 'resolved1', status: 'resolved' }),
      item({ id: 'live2' }),
    ]
    writeFileSync(p.hot, JSON.stringify(legacy))

    expect(readInboxLive(p).map((h) => h.id)).toEqual(['live1', 'live2'])
    expect(JSON.parse(readFileSync(p.hot, 'utf8')).map((h: HitlItem) => h.id)).toEqual([
      'live1',
      'live2',
    ])
    expect(
      readInboxArchive(p)
        .items.map((h) => h.id)
        .sort(),
    ).toEqual(['read1', 'resolved1'])
  })

  test('migration happens once — a second read does not re-append', () => {
    const p = fresh()
    writeFileSync(p.hot, JSON.stringify([item({ id: 'a' }), item({ id: 'b', readAt: 1 })]))
    readInboxLive(p)
    readInboxLive(p)
    expect(archiveLines(p).length).toBe(1)
  })

  test('the pre-split daily archive directory is folded in, not orphaned', () => {
    const p = fresh()
    const dir = p.archive.replace(/\.jsonl$/, '')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'hitl-2026-01-01.json'), JSON.stringify([item({ id: 'old1' })]))
    writeFileSync(join(dir, 'hitl-2026-01-02.json'), JSON.stringify([item({ id: 'old2' })]))
    writeFileSync(p.hot, JSON.stringify([item({ id: 'live' })]))

    updateInbox(p, (live) => [...live])

    expect(
      readInboxArchive(p)
        .items.map((h) => h.id)
        .sort(),
    ).toEqual(['old1', 'old2'])
    expect(existsSync(dir)).toBe(false)
    expect(
      readdirSync(p.hot.replace(/\/hitl\.json$/, '')).some((n) => n.includes('.imported-')),
    ).toBe(true)
  })

  test('a corrupt hot file is refused and quarantined, never silently emptied', () => {
    const p = fresh()
    writeFileSync(p.hot, '[{"id":"real"},{"id"')
    // A READ never moves the user's file — it only refuses to answer.
    expect(() => readInboxLive(p)).toThrow(/corrupt/i)
    expect(readFileSync(p.hot, 'utf8')).toContain('real')

    // A WRITE moves it aside so the next filing is not wedged forever, and the
    // bytes survive for recovery.
    expect(() => updateInbox(p, (l) => [item(), ...l])).toThrow(/corrupt/i)
    const dir = p.hot.replace(/\/hitl\.json$/, '')
    const quarantined = readdirSync(dir).filter((n) => n.includes('.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toContain('real')
    // ...and the inbox is usable again rather than permanently refusing.
    expect(updateInbox(p, (l) => [item({ id: 'after' }), ...l])).toBe(true)
    expect(readInboxLive(p).map((h) => h.id)).toEqual(['after'])
  })
})

describe('cursor pagination over the archive', () => {
  const seeded = (n: number): ReturnType<typeof inboxPaths> => {
    const p = fresh()
    updateInbox(p, () => Array.from({ length: n }, (_, i) => item({ id: `a${i}` })))
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 1 })))
    return p
  }

  test('pages walk the whole history newest-first, exactly once each', () => {
    const p = seeded(137)
    const seen: string[] = []
    let cursor: string | null | undefined = undefined
    for (let i = 0; i < 50; i++) {
      const page: InboxArchivePage = readInboxArchive(p, { cursor, limit: 20 })
      seen.push(...page.items.map((h) => h.id))
      if (page.done) break
      cursor = page.cursor
      expect(cursor).not.toBeNull()
    }
    expect(seen.length).toBe(137)
    expect(new Set(seen).size).toBe(137)
    // Newest first: a999… the last archived item leads.
    expect(seen[0]).toBe('a136')
    expect(seen[136]).toBe('a0')
  })

  test('a page is O(page), not O(history) — cursor byte offsets shrink monotonically', () => {
    const p = seeded(300)
    const first = readInboxArchive(p, { limit: 10 })
    const second = readInboxArchive(p, { cursor: first.cursor, limit: 10 })
    expect(first.items.length).toBe(10)
    expect(second.items.length).toBe(10)
    expect(Number(second.cursor)).toBeLessThan(Number(first.cursor))
    expect(first.items.map((h) => h.id)).not.toEqual(second.items.map((h) => h.id))
  })

  test('an exhausted history reports done with a null cursor', () => {
    const p = seeded(3)
    const page = readInboxArchive(p, { limit: 50 })
    expect(page.items.length).toBe(3)
    expect(page.done).toBe(true)
    expect(page.cursor).toBeNull()
  })

  test('an empty or absent archive pages cleanly', () => {
    const p = fresh()
    expect(readInboxArchive(p)).toEqual({ items: [], cursor: null, done: true })
  })

  test('a torn final line costs that line, not the rest of the history', () => {
    const p = seeded(5)
    appendFileSync(p.archive, '{"id":"torn","tit\n')
    const page = readInboxArchive(p, { limit: 50 })
    expect(page.items.map((h) => h.id)).toEqual(['a4', 'a3', 'a2', 'a1', 'a0'])
  })

  test('lines spanning a read block are reassembled', () => {
    const p = fresh()
    const fat = 'x'.repeat(30_000)
    updateInbox(p, () =>
      Array.from({ length: 8 }, (_, i) => item({ id: `big${i}`, detail: fat, readAt: 1 })),
    )
    const page = readInboxArchive(p, { limit: 50 })
    expect(page.items.map((h) => h.id)).toEqual([
      'big7',
      'big6',
      'big5',
      'big4',
      'big3',
      'big2',
      'big1',
      'big0',
    ])
    expect(page.items[0].detail).toBe(fat)
  })

  test('multi-byte characters do not shift the cursor', () => {
    const p = fresh()
    updateInbox(p, () =>
      Array.from({ length: 6 }, (_, i) => item({ id: `u${i}`, title: '⛔ 日本語 🚀', readAt: 1 })),
    )
    const first = readInboxArchive(p, { limit: 2 })
    const rest = readInboxArchive(p, { cursor: first.cursor, limit: 50 })
    expect([...first.items, ...rest.items].map((h) => h.id)).toEqual([
      'u5',
      'u4',
      'u3',
      'u2',
      'u1',
      'u0',
    ])
    expect(rest.items[0].title).toBe('⛔ 日本語 🚀')
  })

  test('readLinesBackward returns the tail and an offset that points at a line start', () => {
    const p = fresh()
    writeFileSync(p.archive, 'one\ntwo\nthree\n')
    const { lines, offset } = readLinesBackward(p.archive, statSync(p.archive).size, 2)
    expect(lines).toEqual(['two', 'three'])
    expect(offset).toBe('one\n'.length)
    expect(readLinesBackward(p.archive, offset, 5).lines).toEqual(['one'])
  })
})

describe('reopening and removing archived items', () => {
  test('an archived item named in include is pulled back into the hot file', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 5 })))
    expect(readInboxLive(p)).toEqual([])

    const moved = updateInbox(
      p,
      (working) => working.map((h) => ({ ...h, readAt: undefined, status: 'open' as const })),
      { include: ['a'] },
    )

    expect(moved).toBe(true)
    expect(readInboxLive(p).map((h) => h.id)).toEqual(['a'])
    // The archive is append-only, so the old line is still on disk — but the
    // live copy is the truth, so history must not show it twice.
    expect(readInboxArchive(p).items).toEqual([])
  })

  test('dropping an included archived item hides it from history for good', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' }), item({ id: 'b' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 5 })))

    updateInbox(p, (working) => working.filter((h) => h.id !== 'a'), { include: ['a'] })

    expect(readInboxArchive(p).items.map((h) => h.id)).toEqual(['b'])
    expect(findInboxItem(p, 'a')).toBeUndefined()
    expect(findInboxItem(p, 'b')?.id).toBe('b')
  })

  test('an unchanged included item is not re-appended', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 5 })))
    const before = archiveLines(p).length

    updateInbox(p, (working) => [...working], { include: ['a'] })

    expect(archiveLines(p).length).toBe(before)
  })
})

describe('the counts index', () => {
  test('counts track the live set and the archive total across mutations', () => {
    const p = fresh()
    updateInbox(p, () => [
      item({ id: 'a', category: 'reviews' }),
      item({ id: 'b', category: 'reviews' }),
      item({ id: 'c' }),
    ])
    expect(readInboxCounts(p)).toMatchObject({
      live: 3,
      unread: 3,
      archived: 0,
      byCategory: { reviews: { live: 2, unread: 2 }, Uncategorized: { live: 1, unread: 1 } },
    })

    updateInbox(p, (live) => live.map((h) => (h.id === 'a' ? { ...h, readAt: 1 } : h)))
    expect(readInboxCounts(p)).toMatchObject({
      live: 2,
      unread: 2,
      archived: 1,
      byCategory: {
        reviews: { live: 1, unread: 1, archived: 1, total: 2 },
        Uncategorized: { live: 1, unread: 1, archived: 0, total: 1 },
      },
    })

    updateInbox(p, (w) => w.filter((h) => h.id !== 'a'), { include: ['a'] })
    expect(readInboxCounts(p).archived).toBe(0)
  })

  test('category totals include the entire archive, not only a loaded page', () => {
    const p = fresh()
    updateInbox(p, () => [
      ...Array.from({ length: 75 }, (_, i) => item({ id: `review-${i}`, category: 'Reviews' })),
      ...Array.from({ length: 25 }, (_, i) => item({ id: `build-${i}`, category: 'Builds' })),
    ])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 1 })))

    expect(readInboxArchive(p, { limit: 50 }).items).toHaveLength(50)
    expect(readInboxCounts(p).byCategory).toMatchObject({
      Reviews: { live: 0, archived: 75, total: 75 },
      Builds: { live: 0, archived: 25, total: 25 },
    })
  })

  test('an older counts index is upgraded from the full archive on demand', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a', category: 'Reviews' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 1 })))
    writeFileSync(
      p.counts,
      JSON.stringify({ live: 0, unread: 0, archived: 1, byCategory: {}, updatedAt: 1 }),
    )

    expect(inboxCounts(p).byCategory.Reviews).toMatchObject({ archived: 1, total: 1 })
  })

  test('reopening an archived item does not count the same message twice', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a', category: 'Reviews' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 1 })))

    updateInbox(
      p,
      (items) => items.map((h) => ({ ...h, readAt: undefined, status: 'open' as const })),
      { include: ['a'] },
    )
    expect(readInboxCounts(p)).toMatchObject({ live: 1, archived: 0 })
    expect(readInboxCounts(p).byCategory.Reviews.total).toBe(1)

    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 2 })))
    expect(readInboxCounts(p)).toMatchObject({ live: 0, archived: 1 })
    expect(readInboxCounts(p).byCategory.Reviews.total).toBe(1)
  })

  test('counts agree with a full recount after a long random walk', () => {
    const p = fresh()
    let n = 0
    for (let step = 0; step < 60; step++) {
      updateInbox(p, (live) => {
        const next = [...live]
        for (let i = 0; i < 3; i++) next.unshift(item({ id: `w${n++}`, category: `c${n % 4}` }))
        // Retire roughly half of what is live.
        return next.map((h, i) => (i % 2 ? { ...h, readAt: step + 1 } : h))
      })
    }
    const counts = readInboxCounts(p)
    const live = readInboxLive(p)
    expect(counts.live).toBe(live.length)

    let archived = 0
    let cursor: string | null | undefined = undefined
    for (let i = 0; i < 200; i++) {
      const page: InboxArchivePage = readInboxArchive(p, { cursor, limit: 100 })
      archived += page.items.length
      if (page.done) break
      cursor = page.cursor
    }
    expect(counts.archived).toBe(archived)
  })

  test('counts are recomputed when the index file was never written', () => {
    const p = fresh()
    writeFileSync(p.hot, JSON.stringify([item({ id: 'a' }), item({ id: 'b' })]))
    expect(readInboxCounts(p).updatedAt).toBe(0)
    expect(inboxCounts(p)).toMatchObject({ live: 2, unread: 2, archived: 0 })
  })

  test('a stale counts file never masks the hot file', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' })])
    writeFileSync(p.counts, JSON.stringify({ live: 99, unread: 99, archived: 99, updatedAt: 1 }))
    updateInbox(p, (live) => [item({ id: 'b' }), ...live])
    expect(readInboxCounts(p).live).toBe(2)
  })
})

describe('crash order — an item is never absent from both files', () => {
  // The write sequence is: append archive → write hidden → write hot → counts.
  // Simulated by inspecting the on-disk state after each real step, since the
  // steps are ordinary fs calls inside one lock.
  test('a crash between the archive append and the hot rewrite duplicates, never loses', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' }), item({ id: 'b' })])
    const hotBefore = readFileSync(p.hot, 'utf8')

    updateInbox(p, (live) => live.map((h) => (h.id === 'a' ? { ...h, readAt: 7 } : h)))

    // Rewind the hot file to its pre-write contents: exactly the state a crash
    // after the append but before the rename would leave behind.
    writeFileSync(p.hot, hotBefore)

    const live = readInboxLive(p).map((h) => h.id)
    const history = readInboxArchive(p).items.map((h) => h.id)
    expect([...live, ...history].sort()).toEqual(['a', 'b'])
    expect(live).toContain('b')
  })

  test('replayed duplicate archive lines collapse to one item', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a', title: 'first' })])
    updateInbox(p, (live) => live.map((h) => ({ ...h, readAt: 1 })))
    // Same item appended twice — what a retried write leaves behind.
    appendFileSync(p.archive, `${JSON.stringify({ ...item({ id: 'a' }), title: 'second' })}\n`)

    const page = readInboxArchive(p)
    expect(page.items.map((h) => h.id)).toEqual(['a'])
    expect(page.items[0].title).toBe('second') // newest occurrence wins
  })

  test('an item that is live and also in the archive shows once, as live', () => {
    const p = fresh()
    updateInbox(p, () => [item({ id: 'a' })])
    appendFileSync(p.archive, `${JSON.stringify({ ...item({ id: 'a' }), readAt: 1 })}\n`)
    expect(readInboxLive(p).map((h) => h.id)).toEqual(['a'])
    expect(readInboxArchive(p).items).toEqual([])
  })
})

describe('concurrent processes', () => {
  test('four processes filing through the store lose nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-inbox-conc-'))
    const p = inboxPaths(dir)
    const script = join(dir, 'file.ts')
    writeFileSync(
      script,
      `import { inboxPaths, updateInbox } from ${JSON.stringify(join(import.meta.dir, 'inbox-store.ts'))}
const p = inboxPaths(${JSON.stringify(dir)})
const tag = process.argv[2]
for (let i = 0; i < 12; i++) {
  updateInbox(p, (live) => {
    Bun.sleepSync(1) // a deliberate read/write gap
    return [{ id: tag + '-' + i, title: 't', source: 'skill', status: 'open', createdAt: i }, ...live]
  })
}
`,
    )
    const procs = ['a', 'b', 'c', 'd'].map((tag) =>
      Bun.spawn(['bun', script, tag], { stderr: 'inherit' }),
    )
    for (const proc of procs) expect(await proc.exited).toBe(0)

    const live = readInboxLive(p)
    expect(live.length).toBe(48)
    expect(new Set(live.map((h) => h.id)).size).toBe(48)
    expect(readInboxCounts(p).live).toBe(48)
  }, 30_000)
})

describe('path derivation', () => {
  test('every inbox file sits beside the hot file, which keeps its legacy name', () => {
    const p = inboxPaths('/cfg')
    expect(p).toEqual({
      hot: '/cfg/hitl.json',
      archive: '/cfg/hitl-archive.jsonl',
      counts: '/cfg/hitl-counts.json',
      hidden: '/cfg/hitl-archive-hidden.json',
    })
    expect(inboxPathsFor('/cfg/hitl.json')).toEqual(p)
  })
})
