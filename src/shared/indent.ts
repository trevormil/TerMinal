// Infer a file's indentation style from its content, so the editor matches the
// file instead of imposing a global default (VS Code's "detect indentation").
//
// Pure and dependency-free — unit tested, and shared so a formatter or writer
// can reuse it later.

export type IndentStyle = { useTabs: boolean; width: number }

export const DEFAULT_INDENT: IndentStyle = { useTabs: false, width: 2 }

/**
 * Look at leading whitespace across the file and pick the dominant style.
 *
 * Tabs win when more lines start with a tab than with spaces. For spaces we
 * take the most common *difference* between consecutive indentation levels,
 * which is far more reliable than the most common absolute indent (a deeply
 * nested 2-space file is mostly 4s, 6s and 8s).
 */
export function detectIndent(text: string, fallback: IndentStyle = DEFAULT_INDENT): IndentStyle {
  const lines = text.split('\n')
  let tabLines = 0
  const spaceIndents: number[] = []

  for (const line of lines) {
    if (!line.trim()) continue // blank lines say nothing
    if (line[0] === '\t') {
      tabLines++
      continue
    }
    const n = line.length - line.trimStart().length
    // A single leading space is usually a continuation/aligned comment, not an
    // indentation level.
    if (n > 1) spaceIndents.push(n)
  }

  if (tabLines > spaceIndents.length && tabLines > 0)
    return { useTabs: true, width: fallback.width }
  if (!spaceIndents.length) return fallback

  // Count the gaps between successive indent widths, plus each first-level
  // indent, and take the most frequent.
  //
  // Each gap is WEIGHTED by how many lines actually sit at that width. Counting
  // each distinct width once instead let a single wrapped-argument line (one
  // line at 6 in an otherwise 4-space file) carry as much weight as the entire
  // rest of the file, and the smaller-width tie-break below then picked 2.
  const lineCount = new Map<number, number>()
  for (const n of spaceIndents) lineCount.set(n, (lineCount.get(n) || 0) + 1)

  const votes = new Map<number, number>()
  const sorted = [...lineCount.keys()].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) {
    const diff = i === 0 ? sorted[0] : sorted[i] - sorted[i - 1]
    if (diff >= 2 && diff <= 8)
      votes.set(diff, (votes.get(diff) || 0) + (lineCount.get(sorted[i]) || 1))
  }
  if (!votes.size) return fallback

  let best = fallback.width
  let bestCount = -1
  for (const [width, count] of votes) {
    // Ties break toward the smaller width — 2 is far more common than 4 or 6,
    // and over-indenting is the more annoying failure.
    if (count > bestCount || (count === bestCount && width < best)) {
      best = width
      bestCount = count
    }
  }
  return { useTabs: false, width: best }
}

/** The literal string one indent level inserts. */
export const indentUnitFor = (s: IndentStyle): string => (s.useTabs ? '\t' : ' '.repeat(s.width))

export const describeIndent = (s: IndentStyle): string =>
  s.useTabs ? 'Tabs' : `Spaces: ${s.width}`
