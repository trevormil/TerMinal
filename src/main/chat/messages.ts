import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Normalized conversation view of an agent session.
//
// Every engine writes its own transcript in its own shape; the phone's chat UI
// wants one. This module is that seam — the ONLY place engine-specific
// transcript parsing lives. Adding an engine means adding an adapter here, not
// touching the bridge or the client.
//
// Deliberately reads the raw JSONL rather than the observability index: that
// index skips any session whose telemetry isn't 'ready' and covers claude only,
// so building on it would silently produce empty threads for most sessions.

export type ChatMessage =
  | { kind: 'user'; at: number; text: string }
  | { kind: 'assistant'; at: number; text: string }
  | {
      kind: 'tool'
      at: number
      name: string
      summary: string
      status: 'running' | 'ok' | 'error'
    }
  | { kind: 'notice'; at: number; text: string }

export type ChatEngine = 'claude' | 'codex' | 'cursor' | 'openrouter' | 'hermes' | 'openai-compat'

export type ChatTranscript = {
  /** Messages oldest-first. */
  messages: ChatMessage[]
  /** True when this engine has no transcript adapter — the UI offers the terminal instead. */
  unsupported: boolean
  /** Total messages available, before `after`/`limit` were applied. */
  total: number
}

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects')
const CODEX_SESSIONS = join(homedir(), '.codex', 'sessions')

/** Reject path traversal; real ids are UUIDs. */
function safeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && !/[\\/]|\.\./.test(id)
}

function parseLines(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>)
    } catch {
      // A transcript being appended to can end mid-line; never throw on it.
    }
  }
  return out
}

const ts = (v: unknown, fallback: number): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

/** One line, for a collapsed tool row. Never leaks a whole file's contents. */
function preview(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// ---- claude ----------------------------------------------------------------

function claudeFile(sessionId: string): string | null {
  if (!safeId(sessionId) || !existsSync(CLAUDE_PROJECTS)) return null
  for (const project of readdirSync(CLAUDE_PROJECTS)) {
    const p = join(CLAUDE_PROJECTS, project, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

function claudeText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = block as Record<string, unknown>
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n').trim()
}

export function claudeMessages(raw: string): ChatMessage[] {
  const out: ChatMessage[] = []
  let seq = 0
  for (const o of parseLines(raw)) {
    seq++
    // Sub-agent chatter belongs to its own conversation, not this thread.
    if (o.isSidechain === true) continue
    const at = ts(o.timestamp, seq)
    const message = (o.message || {}) as Record<string, unknown>

    if (o.type === 'user') {
      // A "user" line is also how tool RESULTS come back; those are noise here
      // because the tool row already reports its own status.
      const text = claudeText(message.content)
      if (text) out.push({ kind: 'user', at, text })
      continue
    }

    if (o.type === 'assistant') {
      const text = claudeText(message.content)
      if (text) out.push({ kind: 'assistant', at, text })
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as Record<string, unknown>
          if (b?.type !== 'tool_use') continue
          const input = (b.input || {}) as Record<string, unknown>
          out.push({
            kind: 'tool',
            at,
            name: String(b.name || 'tool'),
            summary: preview(
              String(
                input.command ?? input.file_path ?? input.pattern ?? input.description ?? '',
              ) || JSON.stringify(input),
            ),
            status: 'ok',
          })
        }
      }
    }
  }
  return out
}

// ---- codex -----------------------------------------------------------------

/** Codex files are `<root>/YYYY/MM/DD/rollout-*-<sessionId>.jsonl`. */
function codexFile(sessionId: string): string | null {
  if (!safeId(sessionId) || !existsSync(CODEX_SESSIONS)) return null
  const walk = (dir: string, depth: number): string | null => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return null
    }
    for (const name of entries) {
      const p = join(dir, name)
      if (depth > 0) {
        let isDir = false
        try {
          isDir = statSync(p).isDirectory()
        } catch {
          continue
        }
        if (isDir) {
          const hit = walk(p, depth - 1)
          if (hit) return hit
        }
        continue
      }
      if (name.endsWith(`${sessionId}.jsonl`)) return p
    }
    return null
  }
  return walk(CODEX_SESSIONS, 3) // year / month / day
}

function codexText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = block as Record<string, unknown>
    if (typeof b?.text === 'string') parts.push(b.text)
  }
  return parts.join('\n').trim()
}

/** Environment context codex injects as a user turn — not human input. */
function isInjectedContext(text: string): boolean {
  const head = text.slice(0, 400)
  return (
    /^#\s*AGENTS\.md instructions/i.test(head) ||
    /<INSTRUCTIONS>/.test(head) ||
    /<user_instructions>/.test(head) ||
    /<environment_context>/.test(head)
  )
}

export function codexMessages(raw: string): ChatMessage[] {
  const out: ChatMessage[] = []
  // call_id → index of the tool row, so an output line can set its status.
  const pending = new Map<string, number>()
  let seq = 0

  for (const o of parseLines(raw)) {
    seq++
    if (o.type !== 'response_item') continue
    const p = (o.payload || {}) as Record<string, unknown>
    const at = ts(o.timestamp, seq)

    switch (p.type) {
      case 'message': {
        // 'developer' carries the system preamble — never part of the chat.
        const role = String(p.role || '')
        if (role !== 'user' && role !== 'assistant') break
        const text = codexText(p.content)
        if (!text) break
        // Codex injects environment context (AGENTS.md, instruction blocks) as
        // user-role messages. Those are not something a human said, so they
        // must not appear in the chat as if they were.
        if (role === 'user' && isInjectedContext(text)) break
        out.push({ kind: role as 'user' | 'assistant', at, text })
        break
      }
      case 'function_call':
      case 'custom_tool_call': {
        let summary = ''
        const args = p.arguments ?? p.input
        if (typeof args === 'string') {
          try {
            const parsed = JSON.parse(args) as Record<string, unknown>
            summary = String(parsed.cmd ?? parsed.command ?? parsed.path ?? args)
          } catch {
            summary = args
          }
        } else if (args) {
          summary = JSON.stringify(args)
        }
        const callId = String(p.call_id || p.id || '')
        if (callId) pending.set(callId, out.length)
        out.push({
          kind: 'tool',
          at,
          name: String(p.name || 'tool'),
          summary: preview(summary),
          status: 'running',
        })
        break
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const idx = pending.get(String(p.call_id || ''))
        if (idx === undefined) break
        const row = out[idx]
        if (row?.kind !== 'tool') break
        const output = String(p.output || '')
        row.status = /\b(failed|error|exited with code [1-9])/i.test(output) ? 'error' : 'ok'
        break
      }
      default:
        break // reasoning / tool_search_* carry nothing a human reads here
    }
  }
  // A call with no output line never completed.
  for (const idx of pending.values()) {
    const row = out[idx]
    if (row?.kind === 'tool' && row.status === 'running') row.status = 'running'
  }
  return out
}

// ---- public seam -----------------------------------------------------------

const ADAPTERS: Partial<Record<ChatEngine, (raw: string) => ChatMessage[]>> = {
  claude: claudeMessages,
  codex: codexMessages,
}

function transcriptFile(sessionId: string, engine: ChatEngine): string | null {
  if (engine === 'claude') return claudeFile(sessionId)
  if (engine === 'codex') return codexFile(sessionId)
  return null
}

/**
 * The normalized conversation for one session.
 *
 * `after` is an index into the full message list, so a client can poll for new
 * messages without re-reading the whole transcript.
 */
export function sessionMessages(
  sessionId: string,
  engine: ChatEngine,
  opts: { after?: number; limit?: number } = {},
): ChatTranscript {
  const adapter = ADAPTERS[engine]
  if (!adapter) return { messages: [], unsupported: true, total: 0 }

  const file = transcriptFile(sessionId, engine)
  if (!file) return { messages: [], unsupported: false, total: 0 }

  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { messages: [], unsupported: false, total: 0 }
  }

  const all = adapter(raw)
  const after = Math.max(0, opts.after ?? 0)
  const sliced = all.slice(after)
  const limit = opts.limit ?? 0
  return {
    messages: limit > 0 ? sliced.slice(-limit) : sliced,
    unsupported: false,
    total: all.length,
  }
}

export function chatSupportsEngine(engine: ChatEngine): boolean {
  return !!ADAPTERS[engine]
}
