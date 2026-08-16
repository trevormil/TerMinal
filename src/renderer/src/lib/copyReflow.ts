// Undo the hard-wrap a TUI baked into copied text.
//
// Claude Code (and codex) word-wrap their transcripts by printing REAL
// newlines plus a hanging indent, so a native copy of one paragraph pastes as
// several lines, each carrying leading spaces — every paste needed the indent
// backspaced out. xterm already re-joins its OWN soft wraps on copy; these are
// the wraps the hosted app printed, which only the copier can undo.
//
// A break is joined only when the wrap invariant holds: the next line is
// indented, does not open a bullet/list item of its own, and its first word
// would NOT have fit on the previous physical row — i.e. the newline can only
// be there because the renderer ran out of columns. Code blocks survive: their
// lines end early, so the first word of the next line would have fit and the
// break is kept. Afterwards the common indent is stripped, so a copied code
// block pastes flush.

/** A continuation that actually STARTS something new — never glued upward. */
const MARKER = /^(?:[-*•▸⏺○●]|\d+[.)])$/

/** Slack for the gutter the renderer reserves inside the terminal width. */
const WRAP_SLACK = 4

export function reflowTerminalCopy(text: string, cols: number): string {
  if (!text || cols <= 0) return text
  const lines = text.split('\n')
  const out: string[] = []
  // The wrap invariant is judged against the previous PHYSICAL row, not the
  // logical line it was joined into — a paragraph is many rows, each full.
  let prev: string | null = null
  for (const line of lines) {
    const firstWord = line.trimStart().split(/\s+/, 1)[0] ?? ''
    const softWrap =
      prev !== null &&
      prev.trim() !== '' &&
      /^ {2,}\S/.test(line) &&
      !MARKER.test(firstWord) &&
      prev.trimEnd().length + 1 + firstWord.length > cols - WRAP_SLACK
    if (softWrap) out[out.length - 1] = out[out.length - 1].trimEnd() + ' ' + line.trim()
    else out.push(line)
    prev = line
  }
  return dedent(out).join('\n')
}

/** Strip the indent every non-empty line shares, keeping relative nesting. */
function dedent(lines: string[]): string[] {
  let indent = Infinity
  for (const l of lines) {
    if (!l.trim()) continue
    indent = Math.min(indent, l.length - l.trimStart().length)
    if (indent === 0) return lines
  }
  return indent === Infinity ? lines : lines.map((l) => l.slice(indent))
}
