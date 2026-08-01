// Full-text search across past engine transcripts.
//
// Deliberately a SEPARATE read path from the transcript stats/detail parsers:
// it streams each .jsonl line through readline, extracts only that line's
// textual payload, and keeps nothing beyond the hits. It never touches the
// incremental stats cache (#72), so a search can neither evict nor invalidate
// the cache the live UI depends on.
//
// Streaming is load-bearing, not a nicety. Reading a whole transcript with
// readFileSync + split('\n') would put up to 32MB per file on the main process
// synchronously, and the handler walks up to 60 files — hundreds of megabytes
// of blocking work behind a 250ms-debounced text input.
//
// Every scan is bounded: max sessions, max hits per session, max bytes per file.

import { createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { EngineId } from '../shared/engines'

export type SessionRef = {
  id: string
  engine: EngineId | string
  cwd: string
  mtime: number
  file: string
  firstUserText?: string
  gitBranch?: string
}

export type SearchHitRole = 'user' | 'assistant' | 'tool' | 'other'

export type TranscriptHit = {
  /** 1-based line number in the .jsonl — the jump-to-context anchor. */
  line: number
  role: SearchHitRole
  timestamp?: number
  preview: string
}

export type SessionSearchResult = {
  sessionId: string
  engine: string
  cwd: string
  mtime: number
  firstUserText?: string
  hits: TranscriptHit[]
}

export type SearchOptions = {
  cwd?: string
  engine?: string
  maxSessions?: number
  maxHits?: number
  /** Skip transcripts larger than this (default 32MB). */
  maxBytes?: number
}

const DEFAULT_MAX_HITS = 20
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const PREVIEW_RADIUS = 90

/** `/…/` is a regex; anything else is a case-insensitive literal. An invalid
 *  regex falls back to a literal search — a typo mid-type should narrow your
 *  results, not throw. Empty query is null so callers can't "match all". */
export function compileQuery(q: string): ((text: string) => boolean) | null {
  const trimmed = (q || '').trim()
  if (!trimmed) return null
  const asRegex = trimmed.match(/^\/(.+)\/([gimsu]*)$/)
  if (asRegex) {
    try {
      const re = new RegExp(asRegex[1], asRegex[2].replace(/g/g, '') + 'i')
      return (text) => re.test(text)
    } catch {
      // Half-typed regex — search for the pattern body literally so results
      // narrow as you type instead of the box going dead.
      const partial = asRegex[1].toLowerCase()
      return (text) => text.toLowerCase().includes(partial)
    }
  }
  const needle = trimmed.toLowerCase()
  return (text) => text.toLowerCase().includes(needle)
}

function blockText(block: unknown): string {
  const b = block as Record<string, unknown>
  if (!b || typeof b !== 'object') return typeof block === 'string' ? block : ''
  if (typeof b.text === 'string') return b.text
  // Tool calls: the command/args are usually what you're actually looking for.
  if (b.type === 'tool_use' && b.input && typeof b.input === 'object') {
    try {
      return `${typeof b.name === 'string' ? b.name : ''} ${JSON.stringify(b.input)}`
    } catch {
      return typeof b.name === 'string' ? b.name : ''
    }
  }
  if (b.type === 'tool_result') {
    const c = b.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map(blockText).join(' ')
  }
  return ''
}

/** The searchable text of one transcript line. Returns '' when the line has no
 *  textual payload — never a stringified object. */
export function extractSearchableText(obj: unknown): string {
  const o = obj as Record<string, any>
  if (!o || typeof o !== 'object') return ''
  const content = o.message?.content ?? o.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map(blockText).filter(Boolean).join(' ').trim()
  return ''
}

function roleOf(obj: Record<string, any>): SearchHitRole {
  const r = obj?.message?.role ?? obj?.role ?? obj?.type
  if (r === 'user') return 'user'
  if (r === 'assistant') return 'assistant'
  if (r === 'tool' || r === 'tool_result') return 'tool'
  return 'other'
}

function previewAround(text: string, match: (t: string) => boolean): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= PREVIEW_RADIUS * 2) return flat
  // Binary-free approach: walk windows until one matches, so the preview shows
  // the hit rather than the first 180 chars of a 4000-char turn.
  for (let start = 0; start < flat.length; start += PREVIEW_RADIUS) {
    const win = flat.slice(start, start + PREVIEW_RADIUS * 2)
    if (match(win))
      return `${start > 0 ? '…' : ''}${win}${start + PREVIEW_RADIUS * 2 < flat.length ? '…' : ''}`
  }
  return `${flat.slice(0, PREVIEW_RADIUS * 2)}…`
}

function timestampOf(obj: Record<string, any>): number | undefined {
  const t = obj?.timestamp
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const n = Date.parse(t)
    if (!isNaN(n)) return n
  }
  return undefined
}

export async function searchTranscriptFile(
  file: string,
  match: (text: string) => boolean,
  opts: { maxHits?: number; maxBytes?: number },
): Promise<TranscriptHit[]> {
  try {
    if (statSync(file).size > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) return []
  } catch {
    return []
  }
  const limit = opts.maxHits ?? DEFAULT_MAX_HITS
  const hits: TranscriptHit[] = []
  let stream: ReturnType<typeof createReadStream>
  try {
    stream = createReadStream(file, { encoding: 'utf8' })
  } catch {
    return []
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNo = 0
  try {
    for await (const line of rl) {
      lineNo++
      if (hits.length >= limit) break
      if (!line.trim()) continue
      // NOTE: there is deliberately NO raw-line pre-filter here. Matching the
      // undecoded JSON before parsing is faster but silently wrong: JSON
      // escapes quotes and newlines, `^`-anchored patterns hit `{` instead of
      // the text, and \uXXXX escapes hide plain characters. A search tool that
      // confidently answers "no matches" is worse than a slower correct one.
      let obj: Record<string, any>
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const text = extractSearchableText(obj)
      if (!text || !match(text)) continue
      hits.push({
        line: lineNo,
        role: roleOf(obj),
        timestamp: timestampOf(obj),
        preview: previewAround(text, match),
      })
    }
  } catch {
    // A truncated/unreadable transcript yields whatever we found before it
    // broke, never a thrown search.
  } finally {
    rl.close()
    stream.destroy()
  }
  return hits
}

/** Scan sessions in small concurrent batches: enough to keep the disk busy,
 *  bounded so we never hold 60 open read streams at once. */
const SCAN_CONCURRENCY = 4

export async function searchTranscripts(
  query: string,
  sessions: SessionRef[],
  opts: SearchOptions,
): Promise<{
  results: SessionSearchResult[]
  totalHits: number
  scanned: number
  truncated: boolean
}> {
  const match = compileQuery(query)
  if (!match) return { results: [], totalHits: 0, scanned: 0, truncated: false }

  const candidates = (sessions || [])
    .filter((s) => (!opts.cwd || s.cwd === opts.cwd) && (!opts.engine || s.engine === opts.engine))
    .sort((a, b) => b.mtime - a.mtime)

  const cap = opts.maxSessions ?? candidates.length
  const scanning = candidates.slice(0, cap)

  const results: SessionSearchResult[] = []
  let totalHits = 0
  for (let i = 0; i < scanning.length; i += SCAN_CONCURRENCY) {
    const batch = scanning.slice(i, i + SCAN_CONCURRENCY)
    const found = await Promise.all(
      batch.map(async (s) => ({
        s,
        hits: await searchTranscriptFile(s.file, match, {
          maxHits: opts.maxHits,
          maxBytes: opts.maxBytes,
        }),
      })),
    )
    for (const { s, hits } of found) {
      if (!hits.length) continue
      totalHits += hits.length
      results.push({
        sessionId: s.id,
        engine: String(s.engine),
        cwd: s.cwd,
        mtime: s.mtime,
        firstUserText: s.firstUserText,
        hits,
      })
    }
  }
  return {
    results,
    totalHits,
    scanned: scanning.length,
    truncated: candidates.length > scanning.length,
  }
}
