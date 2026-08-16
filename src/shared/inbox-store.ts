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

/**
 * The minimum an inbox record must carry for this module to file it.
 *
 * Structural, not nominal, and every function here is generic over it: the CLI
 * bundle carries its own looser `HitlItem` (a plain `string` source), and
 * forcing the two declarations together would be a type refactor wearing a
 * storage refactor's clothes. The store only ever reads these four fields.
 */
export type InboxRecord = {
  id: string
  status?: string
  readAt?: number
  category?: string
}
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
  version: number
  /** Live items (unread and unresolved). */
  live: number
  /** Live items that have never been seen. Today live implies unread, but the
   *  two are stored separately so a future "live but read" state cannot make
   *  the badge silently wrong. */
  unread: number
  /** Distinct items in the archive. */
  archived: number
  byCategory: Record<string, { live: number; unread: number; archived: number; total: number }>
  updatedAt: number
}

const INBOX_COUNTS_VERSION = 2

const EMPTY_COUNTS: InboxCounts = {
  version: 0,
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

type ArchiveSummary = { total: number; byCategory: Record<string, number> }

function emptyCategoryCount() {
  return { live: 0, unread: 0, archived: 0, total: 0 }
}

export function inboxCountsOf(live: InboxRecord[], archive: ArchiveSummary): InboxCounts {
  const byCategory: InboxCounts['byCategory'] = Object.create(null)
  let unread = 0
  for (const h of live) {
    const cat = h.category || CATEGORY_FALLBACK
    const slot = (byCategory[cat] ??= emptyCategoryCount())
    slot.live++
    slot.total++
    if (!h.readAt) {
      slot.unread++
      unread++
    }
  }
  for (const [cat, archived] of Object.entries(archive.byCategory)) {
    const slot = (byCategory[cat] ??= emptyCategoryCount())
    slot.archived += archived
    slot.total += archived
  }
  return {
    version: INBOX_COUNTS_VERSION,
    live: live.length,
    unread,
    archived: archive.total,
    byCategory,
    updatedAt: Date.now(),
  }
}

// --- raw file helpers --------------------------------------------------------

function readJsonArray<T>(file: string): T[] | 'absent' | 'corrupt' {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return 'absent'
  }
  if (raw.trim() === '') return 'absent'
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : 'corrupt'
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
    const byCategory: InboxCounts['byCategory'] = Object.create(null)
    for (const [cat, raw] of Object.entries(parsed.byCategory ?? {})) {
      const slot = raw as Partial<InboxCounts['byCategory'][string]>
      const live = typeof slot.live === 'number' ? slot.live : 0
      const unread = typeof slot.unread === 'number' ? slot.unread : 0
      const archived = typeof slot.archived === 'number' ? slot.archived : 0
      byCategory[cat] = { live, unread, archived, total: live + archived }
    }
    return { ...EMPTY_COUNTS, ...parsed, byCategory }
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

export type InboxArchivePage<T = HitlItem> = {
  items: T[]
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
export function readInboxArchive<T extends InboxRecord = HitlItem>(
  p: InboxPaths,
  opts: { cursor?: string | null; limit?: number } = {},
): InboxArchivePage<T> {
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
  const items: T[] = []

  while (end > 0 && items.length < limit) {
    const need = limit - items.length
    const { lines, offset } = readLinesBackward(p.archive, end, need)
    if (!lines.length) {
      end = offset
      break
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec: T
      try {
        rec = JSON.parse(lines[i]) as T
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

function readHotRaw(file: string): InboxRecord[] {
  const raw = readJsonArray<InboxRecord>(file)
  return Array.isArray(raw) ? raw : []
}

// --- the locked write path ---------------------------------------------------

export class InboxCorruptError extends Error {
  constructor(
    readonly file: string,
    readonly quarantinedTo?: string,
  ) {
    super(
      `Refusing to write corrupt inbox state ${file}` +
        (quarantinedTo ? `; moved aside to ${quarantinedTo}` : ''),
    )
    this.name = 'InboxCorruptError'
  }
}

function findArchived<T extends InboxRecord>(p: InboxPaths, ids: string[]): Map<string, T> {
  const out = new Map<string, T>()
  if (!ids.length) return out
  const wanted = new Set(ids)
  let cursor: string | null | undefined = undefined
  for (let page = 0; page < 400 && wanted.size; page++) {
    const res: InboxArchivePage<T> = readInboxArchive<T>(p, { cursor, limit: 500 })
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
export function updateInbox<T extends InboxRecord = HitlItem>(
  p: InboxPaths,
  fn: (working: T[]) => T[] | undefined,
  opts: { include?: string[] } = {},
): boolean {
  return withFileLockShared(p.hot, () => {
    importLegacyDailyArchives(p)
    const raw = readJsonArray<T>(p.hot)
    if (raw === 'corrupt') {
      // Quarantine is a WRITER's decision (reads stay non-destructive). Moving
      // the torn file aside is what lets the next filing start clean instead of
      // every writer wedging forever — and the bytes survive for recovery.
      const dest = `${p.hot}.corrupt-${Date.now()}`
      renameSync(p.hot, dest)
      throw new InboxCorruptError(p.hot, dest)
    }
    const hot = raw === 'absent' ? [] : raw

    // Migration is just the split every write already does: anything in the hot
    // file that is no longer live leaves on this pass.
    const live = hot.filter(isInboxLive)
    const strays = hot.filter((h) => !isInboxLive(h))

    const includeIds = (opts.include ?? []).filter((id) => !live.some((h) => h.id === id))
    const pulled = findArchived<T>(p, includeIds)
    const working = [...live, ...pulled.values()]
    const before = new Map(working.map((h) => [h.id, h]))

    const next = fn(working)
    if (next === undefined) {
      // Even a no-op mutation must finish a pending migration, or an oversized
      // legacy file survives every read that declines to change anything.
      if (!strays.length) return false
      return commit(p, live, strays, [], readInboxCounts(p), new Map())
    }

    const nextLive: T[] = []
    const retiring: T[] = []
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

    return commit(p, nextLive, toArchive, dropped, readInboxCounts(p), pulled)
  })
}

/**
 * The ordered write. Append first so a crash can only ever DUPLICATE an item,
 * never lose one; hidden before hot so a removal cannot resurrect; counts last
 * because they are derived and rebuildable.
 */
function commit(
  p: InboxPaths,
  live: InboxRecord[],
  toArchive: InboxRecord[],
  dropped: string[],
  prev: InboxCounts,
  previouslyArchived: ReadonlyMap<string, InboxRecord>,
): boolean {
  // Seed the per-category archive totals once for an older/missing index. Later
  // writes maintain them incrementally without rescanning growing history.
  const archive =
    prev.version === INBOX_COUNTS_VERSION
      ? {
          total: prev.archived,
          byCategory: Object.fromEntries(
            Object.entries(prev.byCategory)
              .filter(([, slot]) => slot.archived > 0)
              .map(([cat, slot]) => [cat, slot.archived]),
          ),
        }
      : summarizeArchive(p, new Set(live.map((item) => item.id)))

  const adjustArchiveCategory = (item: InboxRecord, delta: number) => {
    const cat = item.category || CATEGORY_FALLBACK
    archive.byCategory[cat] = Math.max(0, (archive.byCategory[cat] ?? 0) + delta)
    if (!archive.byCategory[cat]) delete archive.byCategory[cat]
  }

  for (const item of toArchive) {
    const prior = previouslyArchived.get(item.id)
    if (prior) {
      adjustArchiveCategory(prior, -1)
    } else {
      archive.total++
    }
    adjustArchiveCategory(item, 1)
  }
  const liveIds = new Set(live.map((item) => item.id))
  const rearchivedIds = new Set(toArchive.map((item) => item.id))
  for (const [id, prior] of previouslyArchived) {
    if (!liveIds.has(id) || rearchivedIds.has(id)) continue
    archive.total = Math.max(0, archive.total - 1)
    adjustArchiveCategory(prior, -1)
  }
  for (const id of dropped) {
    const prior = previouslyArchived.get(id)
    if (!prior) continue
    archive.total = Math.max(0, archive.total - 1)
    adjustArchiveCategory(prior, -1)
  }

  if (toArchive.length)
    appendFileSync(p.archive, toArchive.map((h) => `${JSON.stringify(h)}\n`).join(''))

  if (dropped.length) {
    const hidden = readHidden(p.hidden)
    for (const id of dropped) hidden.add(id)
    writeJsonAtomicShared(p.hidden, { ids: [...hidden] })
  }

  writeJsonAtomicShared(p.hot, live)

  writeJsonAtomicShared(p.counts, inboxCountsOf(live, archive))
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
    const parsed = readJsonArray<InboxRecord>(join(dir, name))
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
function summarizeArchive(p: InboxPaths, liveIds: ReadonlySet<string>): ArchiveSummary {
  try {
    const hidden = readHidden(p.hidden)
    const records = new Map<string, InboxRecord>()
    for (const line of readFileSync(p.archive, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as InboxRecord
        if (item.id && !hidden.has(item.id) && !liveIds.has(item.id)) records.set(item.id, item)
      } catch {
        /* torn line */
      }
    }
    const byCategory: Record<string, number> = Object.create(null)
    for (const item of records.values()) {
      const cat = item.category || CATEGORY_FALLBACK
      byCategory[cat] = (byCategory[cat] ?? 0) + 1
    }
    return { total: records.size, byCategory }
  } catch {
    return { total: 0, byCategory: {} }
  }
}

/**
 * The live items, migrating a legacy oversized hot file on the way.
 *
 * The migration is a WRITE, so it takes the lock — but only when there is
 * something to migrate. The steady-state read is a plain parse of a file
 * holding tens of items.
 */
export function readInboxLive<T extends InboxRecord = HitlItem>(p: InboxPaths): T[] {
  const raw = readJsonArray<T>(p.hot)
  if (raw === 'corrupt') throw new InboxCorruptError(p.hot)
  const hot = raw === 'absent' ? [] : raw
  if (hot.every(isInboxLive)) return hot
  updateInbox(p, () => undefined)
  const after = readJsonArray<T>(p.hot)
  return Array.isArray(after) ? after : hot.filter(isInboxLive)
}

/** Counts, computed on demand if they have never been written. */
export function inboxCounts(p: InboxPaths): InboxCounts {
  const stored = readInboxCounts(p)
  if (stored.version === INBOX_COUNTS_VERSION) return stored
  // A no-op mutation writes the new index under the same lock as ordinary
  // writers. This is the one-time migration path for existing installations.
  updateInbox(p, (live) => live)
  return readInboxCounts(p)
}

/** One item by id, live first then history. Live is the truth when both exist. */
export function findInboxItem<T extends InboxRecord = HitlItem>(
  p: InboxPaths,
  id: string,
): T | undefined {
  const live = readInboxLive<T>(p).find((h) => h.id === id)
  return live ?? findArchived<T>(p, [id]).get(id)
}
