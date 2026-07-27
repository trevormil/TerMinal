// Minimal single-span diff between two versions of a document. Used to apply
// a formatter's output as one surgical CodeMirror change instead of a
// whole-document replace, so the cursor and scroll position survive.

export type SpanChange = { from: number; to: number; insert: string }

/**
 * What a ⌘S should actually write when formatting raced the user's typing.
 * The live buffer always wins when it moved past the captured snapshot —
 * stale captured (or formatter) text must never overwrite newer edits.
 */
export function contentToWrite(
  captured: string,
  formatted: string | null,
  live: string | null,
): string {
  if (live !== null && live !== captured) return live
  return formatted ?? captured
}

/** The smallest {from, to, insert} turning `prev` into `next`; null if equal. */
export function minimalChange(prev: string, next: string): SpanChange | null {
  if (prev === next) return null
  let start = 0
  const maxStart = Math.min(prev.length, next.length)
  while (start < maxStart && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) }
}
