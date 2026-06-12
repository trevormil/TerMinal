// Minimal YAML-frontmatter parser for the flat schemas we read (tickets,
// sessions): scalars, single-line `[a, b]` arrays, and block sequences
//   key:
//     - "item one"
//     - "item two, with comma"
// Block sequences are needed for prose lists (e.g. acceptance criteria) whose
// items can contain commas that the inline-array comma split would mangle.
// No YAML dep.
export function parseFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: md }
  const fm: Record<string, unknown> = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(/^([\w-]+):\s*(.*)$/)
    if (!mm) continue
    const [, key, rawVal] = mm
    const val = rawVal.trim()
    if (val === '') {
      // Empty scalar value — look ahead for an indented `- ` block sequence.
      const items: string[] = []
      let j = i + 1
      for (; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) {
        items.push(lines[j].replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''))
      }
      if (items.length) {
        fm[key] = items
        i = j - 1
      } else {
        fm[key] = ''
      }
    } else if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      fm[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return { fm, body: m[2] }
}
