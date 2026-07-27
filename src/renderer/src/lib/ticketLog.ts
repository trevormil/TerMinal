import type { TicketComment } from './types'

// A ticket log reads as a conversation, so it renders like one: consecutive
// entries from the same voice collapse under a single header instead of
// repeating the author on every line.

/** Consecutive entries from one voice, shown under a single header. */
export type LogBlock = {
  author: string
  kind: 'human' | 'agent'
  via?: string
  /** The first entry's timestamp — a block is stamped by when it started. */
  at: string
  entries: TicketComment[]
}

/** Beyond this, two entries are two separate moments rather than one thought,
 *  even from the same author — collapsing them would misdate the later one. */
const GROUP_WINDOW_MS = 30 * 60_000

/** Same person, same engine, and close enough in time to read as one turn. */
function sameVoice(a: TicketComment, b: TicketComment): boolean {
  if (a.author !== b.author || a.kind !== b.kind || a.via !== b.via) return false
  const gap = Date.parse(b.at) - Date.parse(a.at)
  if (!Number.isFinite(gap)) return false
  return Math.abs(gap) < GROUP_WINDOW_MS
}

export function groupLogEntries(comments: TicketComment[]): LogBlock[] {
  const blocks: LogBlock[] = []
  for (const c of comments) {
    const last = blocks[blocks.length - 1]
    const prev = last?.entries[last.entries.length - 1]
    if (last && prev && sameVoice(prev, c)) {
      last.entries.push(c)
      continue
    }
    blocks.push({ author: c.author, kind: c.kind, via: c.via, at: c.at, entries: [c] })
  }
  return blocks
}
