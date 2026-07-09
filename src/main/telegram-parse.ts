import { PIPELINE_IDS } from './pipelines'
import type { Engine } from './agents' // type-only — erased, no electron pulled in

// Pure parsing for the two-way Telegram control surface. Kept free of electron
// and disk so it's unit-testable; telegram.ts wires these to the real actions.

export type Command = { cmd: string; args: string[] }

/** Split a message into a lowercased command + its raw args. */
export function parseCommand(text: string): Command {
  const parts = text.trim().split(/\s+/)
  return { cmd: (parts[0] || '').toLowerCase(), args: parts.slice(1) }
}

export type RunArgs = {
  agentId: string
  engine: Engine
  pipeline: string
  repoToken?: string
  personaCandidates: string[]
}

/** Classify `/run` args positionally-by-keyword: engine (codex|claude|cursor),
 *  @repo, a pipeline id, else a persona candidate. agentId is the first arg. */
export function classifyRunArgs(args: string[]): RunArgs {
  let engine: Engine = 'codex'
  let pipeline = 'single'
  let repoToken: string | undefined
  const personaCandidates: string[] = []
  for (const tok of args.slice(1)) {
    const t = tok.toLowerCase()
    if (t === 'codex' || t === 'claude' || t === 'cursor' || t === 'openrouter' || t === 'hermes') engine = t
    else if (t.startsWith('@')) repoToken = tok
    else if (PIPELINE_IDS.has(t)) pipeline = t
    else personaCandidates.push(tok)
  }
  return { agentId: args[0] || '', engine, pipeline, repoToken, personaCandidates }
}

/** Split a leading or trailing `@repo` token off a free-text command.
 *
 *  Only those two positions count. An `@` mid-sentence is prose — `/feature add
 *  an @media query` must not read "@media" as a repo and silently drop the word.
 *  Callers decide what to do when the token matches no known repo; this is
 *  purely positional. */
export function splitRepoToken(args: string[]): { repoToken?: string; rest: string[] } {
  const isToken = (s?: string) => !!s && /^@[\w.-]+$/.test(s)
  if (args.length > 1 && isToken(args[0])) return { repoToken: args[0], rest: args.slice(1) }
  if (args.length > 1 && isToken(args[args.length - 1]))
    return { repoToken: args[args.length - 1], rest: args.slice(0, -1) }
  return { rest: args }
}

export type FeatureDraft = {
  title: string
  type: string
  priority: string
  body: string
  acceptance: string[]
}

const DRAFT_TYPES = new Set(['feature', 'bug', 'chore', 'refactor', 'docs'])
const DRAFT_PRIORITIES = new Set(['low', 'medium', 'high'])

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** Coerce an LLM's ticket-draft JSON into a `FeatureDraft`. The model is asked
 *  for bare JSON but routinely wraps it in prose or a ```json fence, so we take
 *  the outermost brace pair. Every field is clamped: a bad draft becomes a
 *  conservative ticket, never a malformed one. Returns null when there's no
 *  usable title — the one field we can't invent a default for. */
export function parseFeatureDraft(raw: string): FeatureDraft | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null

  const title = typeof obj.title === 'string' ? oneLine(obj.title, 120) : ''
  if (!title) return null

  const type = typeof obj.type === 'string' ? obj.type.toLowerCase().trim() : ''
  const priority = typeof obj.priority === 'string' ? obj.priority.toLowerCase().trim() : ''
  const acceptance = Array.isArray(obj.acceptance)
    ? obj.acceptance
        .filter((c): c is string => typeof c === 'string')
        .map((c) => oneLine(c, 200))
        .filter(Boolean)
        .slice(0, 6)
    : []

  return {
    title,
    type: DRAFT_TYPES.has(type) ? type : 'feature',
    priority: DRAFT_PRIORITIES.has(priority) ? priority : 'medium',
    body: typeof obj.body === 'string' ? obj.body.trim().slice(0, 4000) : '',
    acceptance,
  }
}

/** Parse one `telegram-poll.sh` output line (`<iso>\t<text>`). Returns the
 *  command text iff it's a command newer than `enabledAt` (skip pre-enable
 *  backlog and multi-line continuation lines), else null. */
export function parsePollLine(line: string, enabledAt: number): string | null {
  const tab = line.indexOf('\t')
  if (tab < 0) return null // continuation of a multi-line message — commands are single-line
  const ts = Date.parse(line.slice(0, tab))
  if (!Number.isNaN(ts) && ts < enabledAt - 5_000) return null // pre-enable backlog
  const text = line.slice(tab + 1).trim()
  return text.startsWith('/') ? text : null
}
