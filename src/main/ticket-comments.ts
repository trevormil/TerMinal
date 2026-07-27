// A ticket's comment log lives in the ticket markdown itself, under a `## Log`
// heading — not a sidecar store. Agents already read the ticket file, so a
// comment written by one run is context the next run gets for free, and the
// whole history shows up in `git log` without any extra plumbing.

export type TicketComment = {
  /** ISO-8601 UTC, e.g. 2026-07-27T14:02:11.000Z */
  at: string
  /** Human username, or the agent id for `kind: 'agent'`. */
  author: string
  kind: 'human' | 'agent'
  /** engine/model behind an agent comment, e.g. `codex/gpt-5`. */
  via?: string
  body: string
}

const LOG_HEADING = '## Log'
/** `### <iso> · trevor` or `### <iso> · agent:<id> (<engine>/<model>)` */
const HEADER = /^### (\S+) · (.+?)$/

export function commentHeader(c: TicketComment): string {
  const who = c.kind === 'agent' ? `agent:${c.author}${c.via ? ` (${c.via})` : ''}` : c.author
  return `### ${c.at} · ${who}`
}

function parseHeader(line: string): Omit<TicketComment, 'body'> | null {
  const m = line.match(HEADER)
  if (!m) return null
  const [, at, who] = m
  if (!who.startsWith('agent:')) return { at, author: who.trim(), kind: 'human' }
  const withVia = who.slice('agent:'.length).match(/^(.+?)\s+\((.+)\)$/)
  if (withVia) return { at, author: withVia[1].trim(), kind: 'agent', via: withVia[2].trim() }
  return { at, author: who.slice('agent:'.length).trim(), kind: 'agent' }
}

/** Index of the `## Log` line, skipping any that sit inside a fenced block so a
 *  ticket that documents this very format doesn't corrupt its own parse. */
function logHeadingIndex(lines: string[]): number {
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced
    else if (!fenced && lines[i].trimEnd() === LOG_HEADING) return i
  }
  return -1
}

/** Split a ticket's raw markdown body into its prose and its comment log. */
export function splitTicketBody(body: string): { prose: string; comments: TicketComment[] } {
  const lines = body.split('\n')
  const at = logHeadingIndex(lines)
  if (at < 0) return { prose: body.trim(), comments: [] }

  const comments: TicketComment[] = []
  let current: Omit<TicketComment, 'body'> | null = null
  let buf: string[] = []
  const flush = () => {
    if (current) comments.push({ ...current, body: buf.join('\n').trim() })
    buf = []
  }
  for (const line of lines.slice(at + 1)) {
    const header = parseHeader(line)
    if (header) {
      flush()
      current = header
    } else if (current) {
      buf.push(line)
    }
  }
  flush()
  return { prose: lines.slice(0, at).join('\n').trim(), comments }
}

export function renderTicketLog(comments: TicketComment[]): string {
  if (comments.length === 0) return ''
  return comments.map((c) => `${commentHeader(c)}\n${c.body.trim()}`).join('\n\n')
}

/** Append one comment to a ticket's raw markdown body, creating the `## Log`
 *  section if this is the first one. Prose is left byte-identical. */
export function appendComment(body: string, comment: TicketComment): string {
  const { prose, comments } = splitTicketBody(body)
  const log = renderTicketLog([...comments, comment])
  return `${prose ? `${prose}\n\n` : ''}${LOG_HEADING}\n\n${log}\n`
}
