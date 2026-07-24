// Formats a raw GitHub Actions / GitLab CI job log into a structured, readable
// tree instead of a wall of text: leading ISO timestamps peeled into a dim
// gutter, `##[group]`/`##[endgroup]` folded into collapsible sections,
// `##[error]`/`##[warning]`/`##[command]` lines classified, and ANSI SGR colour
// codes parsed into styled spans. Pure + unit-tested; the tab just renders it.

export type CiSpan = { text: string; fg?: string; bold?: boolean; dim?: boolean }
export type CiLineKind = 'normal' | 'error' | 'warning' | 'command'
export type CiLogLine = { ts?: string; kind: CiLineKind; spans: CiSpan[] }
export type CiLogSection = { name: string; lines: CiLogLine[] }
export type ParsedCiLog = { sections: CiLogSection[]; errorCount: number; warningCount: number }

// SGR (colour) code → our palette name. Only the codes CI actually emits.
const FG: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'gray',
  91: 'red',
  92: 'green',
  93: 'yellow',
  94: 'blue',
  95: 'magenta',
  96: 'cyan',
  97: 'white',
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[([0-9;]*)m/g
// eslint-disable-next-line no-control-regex
const ISO_TS = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s(.*)$/

/** Parse one line's ANSI SGR codes into styled spans. */
export function parseAnsi(line: string): CiSpan[] {
  const spans: CiSpan[] = []
  let last = 0
  let cur: Omit<CiSpan, 'text'> = {}
  let m: RegExpExecArray | null
  ANSI.lastIndex = 0
  const push = (end: number) => {
    if (end > last) spans.push({ text: line.slice(last, end), ...cur })
  }
  while ((m = ANSI.exec(line))) {
    push(m.index)
    last = ANSI.lastIndex
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (const c of codes) {
      if (c === 0) cur = {}
      else if (c === 1) cur = { ...cur, bold: true }
      else if (c === 2) cur = { ...cur, dim: true }
      else if (c === 22) cur = { ...cur, bold: false, dim: false }
      else if (c === 39) cur = { ...cur, fg: undefined }
      else if (FG[c]) cur = { ...cur, fg: FG[c] }
    }
  }
  push(line.length)
  return spans.length ? spans : [{ text: line }]
}

/** Strip a leading ISO-8601 timestamp GitHub prefixes every log line with. */
function splitTimestamp(line: string): { ts?: string; rest: string } {
  const m = line.match(ISO_TS)
  return m ? { ts: m[1].slice(11, 19), rest: m[2] } : { rest: line }
}

export function parseCiLog(raw: string): ParsedCiLog {
  const sections: CiLogSection[] = []
  let current: CiLogSection = { name: '', lines: [] }
  const flush = () => {
    if (current.lines.length || current.name) sections.push(current)
  }
  let errorCount = 0
  let warningCount = 0

  for (const rawLine of raw.replace(/\r$/gm, '').split('\n')) {
    const { ts, rest } = splitTimestamp(rawLine)

    // Workflow-command markers (##[group] etc.).
    const cmd = rest.match(/^##\[([a-z]+)\](.*)$/)
    if (cmd) {
      const [, kind, arg] = cmd
      if (kind === 'group') {
        flush()
        current = { name: arg.trim() || 'group', lines: [] }
        continue
      }
      if (kind === 'endgroup') {
        flush()
        current = { name: '', lines: [] }
        continue
      }
      if (kind === 'error' || kind === 'warning' || kind === 'command') {
        if (kind === 'error') errorCount++
        if (kind === 'warning') warningCount++
        current.lines.push({ ts, kind, spans: parseAnsi(arg) })
        continue
      }
      // section/notice/debug/… — render as normal, marker stripped.
      current.lines.push({ ts, kind: 'normal', spans: parseAnsi(arg) })
      continue
    }

    current.lines.push({ ts, kind: 'normal', spans: parseAnsi(rest) })
  }
  flush()
  return { sections, errorCount, warningCount }
}
