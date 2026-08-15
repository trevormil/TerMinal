// The Inbox on disk — hot/archive split (ticket: inbox storage scalability).
//
// THE PROBLEM. `hitl.json` was one JSON array holding every item ever filed.
// A real inbox reached 6057 items / 4.6 MB, and EVERY surface — the drawer
// badge, the Inbox tab, the Telegram digest, the iOS bridge, four separate
// processes filing items — parsed all of it on every read, and rewrote all of
// it to resolve one item. The live set in that same file was three items.
//
// THE SHAPE.
//   hitl.json                  live items only (unread + unresolved). Still a
//                              plain JSON array, so every existing reader that
//                              only cares about live work keeps working.
//   hitl-archive.jsonl         one JSON object per line, APPEND-ONLY. Archiving
//                              an item is an append, never a rewrite.
//   hitl-counts.json           tiny; the badge fast path. Never grows.
//   hitl-archive-hidden.json   ids removed from the append-only archive. Its own
//                              file so the badge path never pays for it.
//
// Append-only means byte offsets are stable forever, which is what makes the
// history cursor a plain offset. Nothing ever rewrites the archive.
//
// LOCKING + CRASH ORDER. Every write below happens inside the SAME advisory
// lock as hitl.json (the one four processes already cooperate on), in this
// order: append archive → write hidden → write hot → write counts. At every
// prefix of that sequence an item is present in the hot file, the archive, or
// both — never neither. Duplicates are the tolerated failure mode and readers
// dedup by id, keeping the newest occurrence.
//
// MIGRATION is not a step, it is the steady state: a hot file containing
// non-live items is split on the first locked touch, so an oversized legacy
// hitl.json converts itself the first time anything reads or writes it.

import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type { HitlItem } from './types/activity'
import { withFileLockShared, writeJsonAtomicShared } from '../runner/state-io'

export type InboxPaths = {
  /** hitl.json — live items only. */
  hot: string
  /** hitl-archive.jsonl — append-only history. */
  archive: string
  /** hitl-counts.json — badge fast path. */
  counts: string
  /** hitl-archive-hidden.json — ids removed from the archive. */
  hidden: string
}

/** Every inbox path derived from one config dir. The hot file keeps its legacy
 *  name (ADR-0020): only the concept was renamed, never the file. */
export function inboxPaths(cfgDir: string): InboxPaths {
  return {
    hot: join(cfgDir, 'hitl.json'),
    archive: join(cfgDir, 'hitl-archive.jsonl'),
    counts: join(cfgDir, 'hitl-counts.json'),
    hidden: join(cfgDir, 'hitl-archive-hidden.json'),
  }
}

/** Paths for an existing hot-file path — for the callers that already resolve
 *  `hitl.json` through their own path seam. */
export function inboxPathsFor(hotFile: string): InboxPaths {
  return inboxPaths(hotFile.replace(/\/?hitl\.json$/, ''))
}

export type InboxCounts = {
  /** Live items (unread and unresolved). */
  live: number
  /** Live items that have never been seen. Today live implies unread, but the
   *  two are stored separately so a future "live but read" state cannot make
   *  the badge silently wrong. */
  unread: number
  /** Distinct items in the archive. */
  archived: number
  byCategory: Record<string, { live: number; unread: number }>
  updatedAt: number
}

const EMPTY_COUNTS: InboxCounts = {
  live: 0,
  unread: 0,
  archived: 0,
  byCategory: {},
  updatedAt: 0,
}

/** An item is live while it still wants your attention: not read, not resolved.
 *  This is the same predicate the app calls `isHitlRead`, inverted — resolve is
 *  a synonym for read in the one-axis inbox, so both retire an item. */
export function isInboxLive(h: { readAt?: number; status?: string }): boolean {
  return !h.readAt && h.status !== 'resolved'
}

const CATEGORY_FALLBACK = 'Uncategorized'

export function inboxCountsOf(live: HitlItem[], archived: number): InboxCounts {
  const byCategory: Record<string, { live: number; unread: number }> = {}
  let unread = 0
  for (const h of live) {
    const cat = h.category || CATEGORY_FALLBACK
    const slot = (byCategory[cat] ??= { live: 0, unread: 0 })
    slot.live++
    if (!h.readAt) {
      slot.unread++
      unread++
    }
  }
  return { live: live.length, unread, archived, byCategory, updatedAt: Date.now() }
}

// --- raw file helpers --------------------------------------------------------

function readJsonArray(file: string): HitlItem[] | 'absent' | 'corrupt' {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return 'absent'
  }
  if (raw.trim() === '') return 'absent'
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HitlItem[]) : 'corrupt'
  } catch {
    return 'corrupt'
  }
}

function readHidden(file: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { ids?: unknown }
    return new Set(
      Array.isArray(parsed?.ids) ? parsed.ids.filter((i) => typeof i === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/** Counts as stored. A missing file reads as zeroes with updatedAt 0, which is
 *  how callers tell "never computed" from "computed and genuinely empty". */
export function readInboxCounts(p: InboxPaths): InboxCounts {
  try {
    const parsed = JSON.parse(readFileSync(p.counts, 'utf8')) as InboxCounts
    if (typeof parsed?.live !== 'number' || typeof parsed?.archived !== 'number')
      return { ...EMPTY_COUNTS }
    return { ...EMPTY_COUNTS, ...parsed, byCategory: parsed.byCategory ?? {} }
  } catch {
    return { ...EMPTY_COUNTS }
  }
}

// --- backward line reader ----------------------------------------------------

const BLOCK = 64 * 1024

/**
 * Read complete lines from `file` ending at byte offset `end`, newest last,
 * until at least `want` lines are collected or the start of file is reached.
 *
 * Returns the lines in file order plus the byte offset where the OLDEST
 * returned line begins — that offset is the next cursor. Reading backward is
 * what keeps "show me the last 50" O(page) instead of O(history).
 */
export function readLinesBackward(
  file: string,
  end: number,
  want: number,
): { lines: string[]; offset: number } {
  if (end <= 0 || want <= 0) return { lines: [], offset: Math.max(0, end) }
  const fd = openSync(file, 'r')
  try {
    let start = end
    let region = Buffer.alloc(0)
    for (;;) {
      const size = Math.min(BLOCK, start)
      if (size > 0) {
        const block = Buffer.alloc(size)
        readSync(fd, block, 0, size, start - size)
        start -= size
        region = Buffer.concat([block, region])
      }
      // The region always ends on a line boundary — `end` is either the file
      // size or a cursor this function itself produced — so the segment after
      // the final newline is empty and is dropped. The FIRST segment is only
      // trustworthy once we have reached the start of the file.
      const parts = splitLines(region)
      const complete = parts.slice(start > 0 ? 1 : 0, -1)
      if (complete.length >= want || start === 0) {
        const kept = complete.slice(Math.max(0, complete.length - want))
        let bytes = 0
        for (const line of kept) bytes += line.length + 1 // + the newline that ended it
        return { lines: kept.map((b) => b.toString('utf8')), offset: end - bytes }
      }
    }
  } finally {
    closeSync(fd)
  }
}

/** Split on \n, keeping the trailing (usually empty) remainder as the last entry. */
function splitLines(region: Buffer): Buffer[] {
  const out: Buffer[] = []
  let from = 0
  for (;;) {
    const nl = region.indexOf(0x0a, from)
    if (nl < 0) break
    out.push(region.subarray(from, nl))
    from = nl + 1
  }
  out.push(region.subarray(from))
  return out
}

export type InboxArchivePage = {
  items: HitlItem[]
  /** Opaque cursor for the next (older) page. null when the history is exhausted. */
  cursor: string | null
  done: boolean
}

/**
 * One page of archived items, newest first.
 *
 * Hidden ids (removed) and ids currently live in the hot file are skipped: a
 * live id in the archive is the crash-replay duplicate this design tolerates,
 * and the hot copy is always the truth. Within a page an id appears once — the
 * newest occurrence wins. Callers accumulating pages should dedup by id too.
 */
export function readInboxArchive(
  p: InboxPaths,
  opts: { cursor?: string | null; limit?: number } = {},
): InboxArchivePage {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50))
  let size: number
  try {
    size = statSync(p.archive).size
  } catch {
    return { items: [], cursor: null, done: true }
  }
  const parsedCursor = opts.cursor == null ? size : Number(opts.cursor)
  let end = Number.isFinite(parsedCursor) ? Math.min(Math.max(0, parsedCursor), size) : size
  if (end <= 0) return { items: [], cursor: null, done: true }

  const hidden = readHidden(p.hidden)
  const liveIds = new Set(
    readHotRaw(p.hot)
      .filter(isInboxLive)
      .map((h) => h.id),
  )
  const seen = new Set<string>()
  const items: HitlItem[] = []

  while (end > 0 && items.length < limit) {
    const need = limit - items.length
    const { lines, offset } = readLinesBackward(p.archive, end, need)
    if (!lines.length) {
      end = offset
      break
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec: HitlItem
      try {
        rec = JSON.parse(lines[i]) as HitlItem
      } catch {
        continue // a torn append never costs the rest of the history
      }
      if (!rec?.id || seen.has(rec.id)) continue
      seen.add(rec.id)
      if (hidden.has(rec.id) || liveIds.has(rec.id)) continue
      items.push(rec)
    }
    end = offset
  }
  return { items, cursor: end > 0 ? String(end) : null, done: end <= 0 }
}

function readHotRaw(file: string): HitlItem[] {
  const raw = readJsonArray(file)
  return Array.isArray(raw) ? raw : []
}

// --- the locked write path ---------------------------------------------------

export class InboxCorruptError extends Error {
  constructor(readonly file: string) {
    super(`Refusing to write corrupt inbox state ${file}`)
    this.name = 'InboxCorruptError'
  }
}

function findArchived(p: InboxPaths, ids: string[]): Map<string, HitlItem> {
  const out = new Map<string, HitlItem>()
  if (!ids.length) return out
  const wanted = new Set(ids)
  let cursor: string | null | undefined = undefined
  for (let page = 0; page < 400 && wanted.size; page++) {
    const res: InboxArchivePage = readInboxArchive(p, { cursor, limit: 500 })
    for (const item of res.items)
      if (wanted.has(item.id)) {
        out.set(item.id, item)
        wanted.delete(item.id)
      }
    if (res.done) break
    cursor = res.cursor
  }
  return out
}

/**
 * Locked read-modify-write over the inbox.
 *
 * `fn` receives the LIVE items (plus any archived item named in `include`), in
 * newest-first hot order. Whatever it returns becomes the new state: entries
 * that are still live stay in the hot file, entries that are not are appended
 * to the archive, and ids it drops are hidden from the archive.
 *
 * Returning undefined means "no change" and skips every write.
 */
export function updateInbox(
  p: InboxPaths,
  fn: (working: HitlItem[]) => HitlItem[] | undefined,
  opts: { include?: string[] } = {},
): boolean {
  return withFileLockShared(p.hot, () => {
    importLegacyDailyArchives(p)
    const raw = readJsonArray(p.hot)
    if (raw === 'corrupt') throw new InboxCorruptError(p.hot)
    const hot = raw === 'absent' ? [] : raw

    // Migration is just the split every write already does: anything in the hot
    // file that is no longer live leaves on this pass.
    const live = hot.filter(isInboxLive)
    const strays = hot.filter((h) => !isInboxLive(h))

    const includeIds = (opts.include ?? []).filter((id) => !live.some((h) => h.id === id))
    const pulled = findArchived(p, includeIds)
    const working = [...live, ...pulled.values()]
    const before = new Map(working.map((h) => [h.id, h]))

    const next = fn(working)
    if (next === undefined) {
      // Even a no-op mutation must finish a pending migration, or an oversized
      // legacy file survives every read that declines to change anything.
      if (!strays.length) return false
      return commit(p, live, strays, [], readInboxCounts(p))
    }

    const nextLive: HitlItem[] = []
    const retiring: HitlItem[] = []
    for (const h of next) (isInboxLive(h) ? nextLive : retiring).push(h)

    // An included archived item that came back unchanged and still retired is
    // already on disk — re-appending it would only manufacture a duplicate.
    const toArchive = [
      ...strays,
      ...retiring.filter((h) => {
        const prior = pulled.get(h.id)
        return !prior || JSON.stringify(prior) !== JSON.stringify(h)
      }),
    ]

    const nextIds = new Set(next.map((h) => h.id))
    const dropped = [...before.keys()].filter((id) => !nextIds.has(id))

    return commit(p, nextLive, toArchive, dropped, readInboxCounts(p))
  })
}

/**
 * The ordered write. Append first so a crash can only ever DUPLICATE an item,
 * never lose one; hidden before hot so a removal cannot resurrect; counts last
 * because they are derived and rebuildable.
 */
function commit(
  p: InboxPaths,
  live: HitlItem[],
  toArchive: HitlItem[],
  dropped: string[],
  prev: InboxCounts,
): boolean {
  // Seed the archive total BEFORE appending — a full scan taken afterwards
  // already includes the lines we are about to add to it.
  const base = prev.updatedAt ? prev.archived : countArchive(p)

  if (toArchive.length)
    appendFileSync(p.archive, toArchive.map((h) => `${JSON.stringify(h)}\n`).join(''))

  if (dropped.length) {
    const hidden = readHidden(p.hidden)
    for (const id of dropped) hidden.add(id)
    writeJsonAtomicShared(p.hidden, { ids: [...hidden] })
  }

  writeJsonAtomicShared(p.hot, live)

  const archived = Math.max(0, base + toArchive.length - dropped.length)
  writeJsonAtomicShared(p.counts, inboxCountsOf(live, archived))
  return true
}

/**
 * Fold the pre-split daily archive (`hitl-archive/hitl-YYYY-MM-DD.json`, written
 * by the old retention sweep) into the JSONL, once, then rename the directory
 * aside. Losing that history to a storage change would be a data loss the user
 * never asked for. Runs inside the caller's lock.
 */
function importLegacyDailyArchives(p: InboxPaths): void {
  const dir = p.archive.replace(/\.jsonl$/, '')
  let names: string[]
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
  } catch {
    return // no legacy directory — the common case forever after the first run
  }
  const lines: string[] = []
  for (const name of names) {
    const parsed = readJsonArray(join(dir, name))
    if (!Array.isArray(parsed)) continue
    for (const item of parsed) if (item?.id) lines.push(`${JSON.stringify(item)}\n`)
  }
  if (lines.length) appendFileSync(p.archive, lines.join(''))
  try {
    renameSync(dir, `${dir}.imported-${Date.now()}`)
  } catch {
    /* another process got there first */
  }
}

/** Full archive scan — only ever run once, to seed a counts file that has never
 *  been written. Every later count is maintained incrementally under the lock. */
function countArchive(p: InboxPaths): number {
  try {
    const hidden = readHidden(p.hidden)
    const ids = new Set<string>()
    for (const line of readFileSync(p.archive, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const id = (JSON.parse(line) as HitlItem).id
        if (id && !hidden.has(id)) ids.add(id)
      } catch {
        /* torn line */
      }
    }
    return ids.size
  } catch {
    return 0
  }
}

/**
 * The live items, migrating a legacy oversized hot file on the way.
 *
 * The migration is a WRITE, so it takes the lock — but only when there is
 * something to migrate. The steady-state read is a plain parse of a file
 * holding tens of items.
 */
export function readInboxLive(p: InboxPaths): HitlItem[] {
  const raw = readJsonArray(p.hot)
  if (raw === 'corrupt') throw new InboxCorruptError(p.hot)
  const hot = raw === 'absent' ? [] : raw
  if (hot.every(isInboxLive)) return hot
  updateInbox(p, () => undefined)
  const after = readJsonArray(p.hot)
  return Array.isArray(after) ? after : hot.filter(isInboxLive)
}

/** Counts, computed on demand if they have never been written. */
export function inboxCounts(p: InboxPaths): InboxCounts {
  const stored = readInboxCounts(p)
  if (stored.updatedAt) return stored
  const live = readInboxLive(p)
  return inboxCountsOf(live, countArchive(p))
}

/** One item by id, live first then history. Live is the truth when both exist. */
export function findInboxItem(p: InboxPaths, id: string): HitlItem | undefined {
  const live = readInboxLive(p).find((h) => h.id === id)
  return live ?? findArchived(p, [id]).get(id)
}
