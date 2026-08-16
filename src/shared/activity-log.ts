// Reading the activity feed without reading the whole activity feed.
//
// The log is append-only JSONL — the right WRITE shape, and every writer (the
// app, terminal-cli, the MCP server, bin/gt-notify) keeps appending exactly as
// before. The READ side was the problem: every consumer did
// `readFileSync(log).split('\n')`, so the cost of showing 50 rows, or of
// counting three kinds for a badge polled once a second, grew with the entire
// history.
//
// This module is the one implementation all of them share. It reads the log
// BACKWARDS in fixed blocks from the end, so a page costs the size of the page
// rather than the size of the file, and hands back a byte-offset cursor for the
// next (older) page. Polling uses the forward delta reader instead: the file
// only ever grows, so the new events are exactly the new bytes.
//
// Rotation is part of the read contract, not a separate concern: once the live
// log passes a size threshold it is renamed to `activity-1.jsonl` and a fresh
// one starts, and the reverse reader walks the generations in order — so
// history survives (the old behaviour silently truncated the log to its last
// 2000 lines on read) while no single file grows without bound.
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ActivityEvent } from './types/activity'

/** Bytes read per backward step. Big enough that a page of ~50 events is one
 *  read, small enough that the badge's early-exit count touches almost nothing. */
const BLOCK = 64 * 1024

/** Rename the live log once it passes this size. */
export const ACTIVITY_ROTATE_BYTES = 5 * 1024 * 1024
/** How many rotated generations to keep behind the live log. */
export const ACTIVITY_GENERATIONS = 2

/** Where a page stopped: the generation, and the byte offset of the oldest event
 *  it returned. The next page reads backwards from exactly that offset, so pages
 *  never overlap and never skip. */
export type ActivityCursor = { gen: number; offset: number }

export type ActivityPage = { events: ActivityEvent[]; cursor: ActivityCursor | null }

export type ActivityPageOptions = {
  limit?: number
  /** Where to resume. Omit (or null) for the newest page. */
  cursor?: ActivityCursor | null
  /** Applied before `limit`, so a filtered page still comes back full. */
  filter?: (ev: ActivityEvent) => boolean
  /** Hard ceiling on lines examined, so a filter that matches nothing cannot
   *  turn one page request into a full-history scan. */
  maxScan?: number
}

/** The live log plus its rotated generations, newest first. */
export function activityGenerationPaths(base: string): string[] {
  const dir = dirname(base)
  const name = basename(base)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const out = [base]
  for (let i = 1; i <= ACTIVITY_GENERATIONS; i++) out.push(join(dir, `${stem}-${i}${ext}`))
  return out
}

function parse(line: string): ActivityEvent | null {
  if (!line.trim()) return null
  try {
    const ev = JSON.parse(line) as ActivityEvent
    return ev && typeof ev === 'object' ? ev : null
  } catch {
    // One torn or garbled line is one event lost, never a failed read.
    return null
  }
}

function readRange(fd: number, start: number, len: number): Buffer {
  if (len <= 0) return Buffer.alloc(0)
  const buf = Buffer.alloc(len)
  let got = 0
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, start + got)
    if (n <= 0) break
    got += n
  }
  return got === len ? buf : buf.subarray(0, got)
}

/** Offset just past the last newline at or before `end` — i.e. the end of the
 *  last COMPLETE line. Everything after it is a half-written append. */
function lastLineEnd(fd: number, end: number): number {
  let pos = end
  while (pos > 0) {
    const start = Math.max(0, pos - BLOCK)
    const buf = readRange(fd, start, pos - start)
    const idx = buf.lastIndexOf(0x0a)
    if (idx >= 0) return start + idx + 1
    pos = start
  }
  return 0
}

/** Complete lines of one file, newest first, with the byte offset each starts at. */
function* reverseLinesInFile(
  file: string,
  end: number,
): Generator<{ line: string; start: number }> {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return
  }
  try {
    let pos = lastLineEnd(fd, end)
    // The tail of a line whose start lies before the block we have read.
    let carry = Buffer.alloc(0)
    while (pos > 0) {
      const start = Math.max(0, pos - BLOCK)
      const buf = Buffer.concat([readRange(fd, start, pos - start), carry])
      pos = start
      carry = Buffer.alloc(0)
      // `cut` is the exclusive end of the bytes still to emit; buf[cut - 1] is
      // always the newline terminating the next line to yield.
      let cut = buf.length
      while (cut > 0) {
        const nl = cut >= 2 ? buf.lastIndexOf(0x0a, cut - 2) : -1
        if (nl >= 0) {
          yield { line: buf.subarray(nl + 1, cut - 1).toString('utf8'), start: start + nl + 1 }
          cut = nl + 1
        } else if (start === 0) {
          yield { line: buf.subarray(0, cut - 1).toString('utf8'), start: 0 }
          cut = 0
        } else {
          // Line continues into the previous block — carry it and read on.
          carry = buf.subarray(0, cut)
          break
        }
      }
    }
  } finally {
    closeSync(fd)
  }
}

/** Complete lines across the live log and its rotated generations, newest first. */
function* reverseLines(
  base: string,
  cursor?: ActivityCursor | null,
): Generator<{ gen: number; start: number; line: string }> {
  const paths = activityGenerationPaths(base)
  const from = cursor ? cursor.gen : 0
  for (let gen = from; gen < paths.length; gen++) {
    const file = paths[gen]
    if (!existsSync(file)) continue
    let end = 0
    if (gen === from && cursor) end = cursor.offset
    else {
      try {
        end = statSync(file).size
      } catch {
        continue
      }
    }
    for (const l of reverseLinesInFile(file, end)) yield { gen, start: l.start, line: l.line }
  }
}

/** One page of the feed, newest first. `cursor` is null once the oldest kept
 *  event has been returned. */
export function readActivityPage(base: string, opts: ActivityPageOptions = {}): ActivityPage {
  const limit = Math.max(1, opts.limit ?? 200)
  const maxScan = opts.maxScan ?? Math.max(limit * 50, 5_000)
  const events: ActivityEvent[] = []
  let cursor: ActivityCursor | null = null
  // Position of the last line CONSUMED (matching or not), so the next page
  // resumes strictly below it — nothing re-examined, nothing skipped.
  let consumed: ActivityCursor | null = null
  let scanned = 0
  for (const { gen, start, line } of reverseLines(base, opts.cursor)) {
    // A page is only "there is more" once another line actually exists. Setting
    // the cursor the moment `limit` is hit reported a next page that turned out
    // to be empty whenever the limit landed on the last event.
    if (events.length >= limit || scanned >= maxScan) {
      cursor = consumed
      break
    }
    scanned++
    consumed = { gen, offset: start }
    const ev = parse(line)
    if (ev && (!opts.filter || opts.filter(ev))) events.push(ev)
  }
  return { events, cursor }
}

/** Convenience wrapper for callers that only ever want the newest N. */
export function readActivityTail(base: string, limit = 200): ActivityEvent[] {
  return readActivityPage(base, { limit }).events
}

/** Events appended since the reader last stopped at `fromSize`, oldest first,
 *  plus the new stopping point. Stops at the last COMPLETE line, so a torn
 *  trailing append is picked up on the next call instead of being lost. */
export function readActivityDelta(
  base: string,
  fromSize: number,
): { events: ActivityEvent[]; size: number } {
  let fd: number
  try {
    fd = openSync(base, 'r')
  } catch {
    return { events: [], size: 0 }
  }
  try {
    const size = statSync(base).size
    // Shrank ⇒ cleared or rotated out from under us; re-read from the top.
    const start = fromSize > size ? 0 : fromSize
    const end = lastLineEnd(fd, size)
    if (end <= start) return { events: [], size: Math.min(start, end) }
    const buf = readRange(fd, start, end - start)
    const events: ActivityEvent[] = []
    for (const line of buf.toString('utf8').split('\n')) {
      const ev = parse(line)
      if (ev) events.push(ev)
    }
    return { events, size: end }
  } catch {
    return { events: [], size: fromSize }
  } finally {
    closeSync(fd)
  }
}

/** Total complete events across the live log and its rotated generations —
 *  the "of N" in the feed's pager. Counts newline-terminated lines in fixed
 *  blocks (a torn trailing append has no newline yet, so it is excluded), so
 *  the cost is a byte scan with no JSON parsing. Callers memoize per size. */
export function countActivityEvents(base: string): number {
  let count = 0
  for (const file of activityGenerationPaths(base)) {
    let fd: number
    try {
      fd = openSync(file, 'r')
    } catch {
      continue
    }
    try {
      const size = statSync(file).size
      let pos = 0
      while (pos < size) {
        const buf = readRange(fd, pos, Math.min(BLOCK, size - pos))
        if (!buf.length) break
        for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++
        pos += buf.length
      }
    } catch {
      /* a vanished generation counts nothing */
    } finally {
      closeSync(fd)
    }
  }
  return count
}

/** How many events newer than `since` carry one of `kinds` — the tab badge.
 *  The reverse walk ends at the first event at or before `since`, so a badge
 *  poll normally touches one block no matter how long the history is. */
export function countActivitySince(
  base: string,
  since: number,
  kinds?: string[],
  maxScan = 50_000,
): number {
  const want = kinds && kinds.length ? new Set(kinds) : null
  let count = 0
  let scanned = 0
  for (const { line } of reverseLines(base)) {
    if (++scanned > maxScan) break
    const ev = parse(line)
    if (!ev) continue
    if (!(ev.ts > since)) break
    if (!want || want.has(ev.kind)) count++
  }
  return count
}

/** Rename the live log aside once it passes `maxBytes`, keeping
 *  ACTIVITY_GENERATIONS of history behind it. Returns whether it rotated.
 *  Appenders are unaffected: they open the path fresh on every write. */
export function rotateActivityLog(base: string, maxBytes = ACTIVITY_ROTATE_BYTES): boolean {
  let size = 0
  try {
    size = statSync(base).size
  } catch {
    return false
  }
  if (size <= maxBytes) return false
  const paths = activityGenerationPaths(base)
  try {
    rmSync(paths[paths.length - 1], { force: true })
    for (let gen = paths.length - 1; gen > 0; gen--) {
      if (existsSync(paths[gen - 1])) renameSync(paths[gen - 1], paths[gen])
    }
    return true
  } catch {
    return false
  }
}
