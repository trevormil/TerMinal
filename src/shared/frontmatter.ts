// YAML/TOML frontmatter, split off so markdown previews render it as metadata
// instead of dumping `---\nid: 44\n---` as body text (Orca renders frontmatter
// by default; every ticket and ADR in this repo has some).
//
// Deliberately NOT a full YAML parser: frontmatter here is flat key/value with
// the occasional list, and pulling in a YAML dependency to pretty-print a
// header would be a poor trade. Anything it can't parse falls back to being
// shown verbatim rather than guessed at.

export type Frontmatter = [key: string, value: string][]

const FENCE = /^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1\r?\n?/

/**
 * Split leading frontmatter from the markdown body.
 *
 * Returns `frontmatter: []` when there is none — including for a document that
 * merely *starts* with a `---` horizontal rule, which must not be swallowed.
 */
export function splitFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const m = FENCE.exec(text)
  if (!m) return { frontmatter: [], body: text }
  const pairs = parseFlat(m[2])
  // A fence with nothing parseable inside is more likely a horizontal rule or
  // a code sample than real frontmatter — leave the document untouched.
  if (!pairs.length) return { frontmatter: [], body: text }
  return { frontmatter: pairs, body: text.slice(m[0].length) }
}

function parseFlat(block: string): Frontmatter {
  const out: Frontmatter = []
  let currentKey = ''
  let listItems: string[] = []

  const flushList = () => {
    if (currentKey && listItems.length) {
      out.push([currentKey, listItems.join(', ')])
      listItems = []
      currentKey = ''
    }
  }

  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue

    // A `  - item` continuation belongs to the key above it.
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && currentKey) {
      listItems.push(clean(item[1]))
      continue
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    flushList()
    const key = kv[1]
    const value = clean(kv[2])
    if (value === '') {
      // `key:` with items beneath it — collect until the next key.
      currentKey = key
      continue
    }
    out.push([key, value])
  }
  flushList()
  return out
}

/** Strip wrapping quotes and inline `[a, b]` brackets for display. */
function clean(v: string): string {
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    s = s.slice(1, -1)
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1).trim()
  return s
}
