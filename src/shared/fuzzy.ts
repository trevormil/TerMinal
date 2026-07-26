// Fuzzy matching with RANKING, for quick-open and the command palette.
//
// The palette previously used a boolean subsequence test, so "index" matched
// hundreds of paths in no useful order. Ranking is the whole game in a
// quick-open: the right file has to be first, not merely present.
//
// Pure and dependency-free — unit tested, shared by every picker.

export type FuzzyMatch = {
  score: number
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[]
}

const BOUNDARY = /[\/\\._\- ]/

/**
 * Score `needle` against `haystack`. Higher is better; null = no match.
 *
 * Scoring favours, in order: consecutive runs, matches at word boundaries or
 * camelCase humps, and matches late in the path (the basename usually is what
 * you typed). A greedy left-to-right scan is enough at our list sizes and keeps
 * this allocation-free per candidate.
 */
export function fuzzyScore(needle: string, haystack: string): FuzzyMatch | null {
  if (!needle) return { score: 0, positions: [] }
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()

  // Try every occurrence of the first character as a starting point and keep the
  // best alignment. A single greedy left-to-right pass is the classic fuzzy bug:
  // matching "engines" against "src/shared/engines.ts" would seize the 'e' in
  // "shared", shattering the consecutive run and losing the basename bonus — so
  // the directory hit "src/engines/other.ts" would outrank the real file.
  let best: FuzzyMatch | null = null
  for (let start = h.indexOf(n[0]); start !== -1; start = h.indexOf(n[0], start + 1)) {
    const m = scoreFrom(n, haystack, h, start)
    if (m && (!best || m.score > best.score)) best = m
  }
  return best
}

/** Greedy alignment anchored at `start`; null when the needle doesn't fit. */
function scoreFrom(n: string, haystack: string, h: string, start: number): FuzzyMatch | null {
  const positions: number[] = []
  let score = 0
  let hi = start
  let prevMatch = -2

  for (let ni = 0; ni < n.length; ni++) {
    const found = ni === 0 ? start : h.indexOf(n[ni], hi)
    if (found === -1) return null

    let bonus = 1
    // Consecutive characters are the strongest signal of a real match.
    if (found === prevMatch + 1) bonus += 8
    // Start of a path/word segment, or a camelCase hump.
    const prevCh = found > 0 ? haystack[found - 1] : ''
    if (found === 0 || BOUNDARY.test(prevCh)) bonus += 6
    else if (
      prevCh &&
      prevCh === prevCh.toLowerCase() &&
      haystack[found] !== haystack[found].toLowerCase()
    )
      bonus += 4
    // A gap between matches costs, so tightly-clustered matches win.
    if (prevMatch >= 0) bonus -= Math.min(4, found - prevMatch - 1)

    score += bonus
    positions.push(found)
    prevMatch = found
    hi = found + 1
  }

  // Prefer matches concentrated in the basename over ones smeared up the path.
  const slash = haystack.lastIndexOf('/')
  if (slash >= 0 && positions[0] > slash) score += 12
  // Mild preference for shorter candidates when scores are otherwise close.
  score -= Math.min(10, haystack.length / 12)
  return { score, positions }
}

export type Ranked<T> = { item: T; score: number; positions: number[] }

/**
 * Rank `items` by how well `needle` matches `key(item)`.
 *
 * `deprioritize` pushes a whole class of results into a second tier without
 * hiding them — used for git-ignored files so build output stays reachable
 * (an Orca behaviour) instead of either polluting or vanishing from results.
 */
export function fuzzyRank<T>(
  needle: string,
  items: readonly T[],
  key: (item: T) => string,
  opts: { limit?: number; deprioritize?: (item: T) => boolean } = {},
): Ranked<T>[] {
  const { limit = 50, deprioritize } = opts
  const out: Ranked<T>[] = []
  for (const item of items) {
    const m = fuzzyScore(needle, key(item))
    if (!m) continue
    const penalty = deprioritize?.(item) ? 1000 : 0
    out.push({ item, score: m.score - penalty, positions: m.positions })
  }
  // Stable-ish: equal scores keep input order, which is usually recency.
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

// ---- quick-open mode prefixes ----------------------------------------------

export type QuickOpenMode = 'files' | 'commands' | 'symbols' | 'line' | 'search'

export type ParsedQuery = { mode: QuickOpenMode; term: string; line?: number }

/**
 * One input, five modes — the VS Code convention:
 *   `>foo` commands · `@foo` symbols in file · `:42` line · `#foo` project
 *   search · anything else = files.
 */
export function parseQuickOpen(raw: string): ParsedQuery {
  const s = raw.trimStart()
  if (s.startsWith('>')) return { mode: 'commands', term: s.slice(1).trim() }
  if (s.startsWith('@')) return { mode: 'symbols', term: s.slice(1).trim() }
  if (s.startsWith('#')) return { mode: 'search', term: s.slice(1).trim() }
  if (s.startsWith(':')) {
    const n = parseInt(s.slice(1).trim(), 10)
    return { mode: 'line', term: s.slice(1).trim(), line: Number.isFinite(n) ? n : undefined }
  }
  return { mode: 'files', term: s.trim() }
}

// ---- file:line references ---------------------------------------------------

export type FileRef = { path: string; line?: number; column?: number }

// A path with at least one slash or a dotted filename, optionally :line[:col].
// Deliberately conservative so ordinary prose and "3:1" timestamps don't match.
const REF_RE = /(?:^|[\s(['"`])((?:[\w.@~-]+\/)+[\w.@-]+|[\w@-]+\.[\w]{1,8})(?::(\d+))?(?::(\d+))?/g

/**
 * Extract `path:line:col` references from agent output, so they can be turned
 * into links that open the file at that position. The cheapest big win from the
 * IDE audit.
 */
export function extractFileRefs(text: string): FileRef[] {
  const out: FileRef[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(REF_RE)) {
    const path = m[1]
    // Skip bare URLs and version-looking tokens.
    if (path.includes('://') || /^\d+\.\d+$/.test(path)) continue
    const key = `${path}:${m[2] ?? ''}:${m[3] ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      path,
      line: m[2] ? Number(m[2]) : undefined,
      column: m[3] ? Number(m[3]) : undefined,
    })
  }
  return out
}
