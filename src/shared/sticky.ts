// Enclosing-scope detection for the editor's sticky scroll, in the same
// spirit as symbols.ts: an indentation walk instead of a language server.
// Wrong-but-harmless beats absent — a line that isn't really a scope header
// simply doesn't match the opener test and isn't pinned.

/** Lines that plausibly open a scope: end in an opener, or a Python-style `:`. */
const OPENS_SCOPE = /(\{|\(|\[|=>|:|\bdo|\bthen|\bbegin)\s*(\/\/.*|#.*)?$/

const indentOf = (line: string): number => line.length - line.trimStart().length

/**
 * The enclosing scope-header lines for the first visible line, outermost
 * first. `topLine` is 1-based; returns 1-based line numbers, at most `max`,
 * preferring the innermost scopes when there are more.
 *
 * The walk: starting at the viewport's first non-blank line, scan upward for
 * lines with strictly smaller indentation. Each such line bounds the current
 * scope — it becomes the new threshold — and is pinned when it reads like a
 * scope opener. Stops at column 0.
 */
export function stickyLinesFor(lines: string[], topLine: number, max = 4): number[] {
  if (topLine <= 1 || lines.length === 0) return []
  const top = Math.min(topLine, lines.length)
  // Anchor on the first non-blank line at/after the viewport top — a blank
  // line has no meaningful indentation.
  let anchor = top
  while (anchor <= lines.length && !lines[anchor - 1].trim()) anchor++
  if (anchor > lines.length) return []
  let need = indentOf(lines[anchor - 1])
  if (need === 0) return []

  const out: number[] = []
  for (let n = top - 1; n >= 1 && need > 0; n--) {
    const line = lines[n - 1]
    if (!line.trim()) continue
    const ind = indentOf(line)
    if (ind >= need) continue
    need = ind
    if (OPENS_SCOPE.test(line.trimEnd())) out.push(n)
  }
  return out.reverse().slice(-max)
}
