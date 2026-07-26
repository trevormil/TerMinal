// Literal, case-insensitive replacement — the exact semantics of the Files
// tab's search (git grep -F -i), so the preview a match shows is precisely
// what replaceInFiles will write. Shared between renderer (preview) and main
// (apply) for that reason.

/** Escape a string for use inside a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type LineReplace = { text: string; count: number }

/** Replace every case-insensitive literal occurrence of `query` in one line. */
export function replaceInLine(line: string, query: string, replacement: string): LineReplace {
  if (!query) return { text: line, count: 0 }
  let count = 0
  const text = line.replace(new RegExp(esc(query), 'gi'), () => {
    count++
    return replacement
  })
  return { text, count }
}

/** Split a line into [before, match, after, …] segments for highlighting. */
export function matchSegments(line: string, query: string): { text: string; hit: boolean }[] {
  if (!query) return [{ text: line, hit: false }]
  const re = new RegExp(esc(query), 'gi')
  const out: { text: string; hit: boolean }[] = []
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
    if (m[0].length === 0) break
  }
  if (last < line.length) out.push({ text: line.slice(last), hit: false })
  return out
}
