// Minimal single-span diff between two versions of a document. Used to apply
// a formatter's output as one surgical CodeMirror change instead of a
// whole-document replace, so the cursor and scroll position survive.

export type SpanChange = { from: number; to: number; insert: string }

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
