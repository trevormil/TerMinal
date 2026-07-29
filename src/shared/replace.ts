// Search/replace semantics shared between the Files tab (search preview,
// replace preview) and main (search via git grep, replace via fs writes) —
// so what a match preview shows is exactly what a replace applies.

export type SearchOptions = {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
}

/** Escape a string for use inside a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function buildRegex(query: string, opts?: SearchOptions): RegExp | null {
  if (!query) return null
  let src = opts?.regex ? query : esc(query)
  if (opts?.wholeWord) src = `\\b(?:${src})\\b`
  const flags = 'g' + (opts?.caseSensitive ? '' : 'i')
  try {
    return new RegExp(src, flags)
  } catch {
    return null // invalid regex mid-typing — treat as no match rather than throw
  }
}

export type LineReplace = { text: string; count: number }

/**
 * Replace every occurrence of `query` in one line per `opts` (literal or
 * regex, case-sensitive or not, whole-word or not). In regex mode,
 * `replacement` may reference capture groups ($1, $2, …) and the whole match
 * ($&), same as VS Code's search-and-replace.
 */
export function replaceInLine(
  line: string,
  query: string,
  replacement: string,
  opts?: SearchOptions,
): LineReplace {
  const re = buildRegex(query, opts)
  if (!re) return { text: line, count: 0 }
  let count = 0
  const text = line.replace(re, (...args) => {
    count++
    if (!opts?.regex) return replacement
    return replacement.replace(/\$(\d+|&)/g, (_, d) => (d === '&' ? args[0] : (args[Number(d)] ?? '')))
  })
  return { text, count }
}

/** Split a line into [before, match, after, …] segments for highlighting. */
export function matchSegments(
  line: string,
  query: string,
  opts?: SearchOptions,
): { text: string; hit: boolean }[] {
  const re = buildRegex(query, opts)
  if (!re) return [{ text: line, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
    if (m[0].length === 0) break // zero-length match (e.g. empty regex group) — avoid looping forever
  }
  if (last < line.length) out.push({ text: line.slice(last), hit: false })
  return out
}
