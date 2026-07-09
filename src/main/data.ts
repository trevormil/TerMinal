import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { repoForCwd, repoRootOf } from './repo'
import { reviewForPrDir, newestReviewDirForRepo } from './review'
import { readStatusLine } from './statusline'

// ---------------------------------------------------------------------------
// Claude Code transcript reader
//
// Claude Code writes one JSONL transcript per session at
//   ~/.claude/projects/<cwd-hash>/<session-id>.jsonl
// The filename is the session id; message lines carry usage, cwd, gitBranch.
//
// TerMinal attaches to ONE session for the life of the window — every
// reader here is keyed by session id, so context %, cost, etc. all describe
// that single session, never an aggregate.
// ---------------------------------------------------------------------------

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const TASKS_DIR = join(homedir(), '.claude', 'tasks')
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const CURSOR_PROJECTS_DIR = join(homedir(), '.cursor', 'projects')
const SESSION_PICKER_LIMIT = 600
const PICKER_HEAD_BYTES = 256 * 1024
const PICKER_TAIL_BYTES = 128 * 1024

/** The agent's live todo list for a session (~/.claude/tasks/<id>/<n>.json). */
export function readSessionTasks(sessionId: string): TaskItem[] {
  if (!sessionId) return []
  const dir = join(TASKS_DIR, sessionId)
  if (!existsSync(dir)) return []
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const out: TaskItem[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      out.push({
        id: String(t.id ?? f.replace(/\.json$/, '')),
        subject: t.subject || '',
        status: t.status || 'pending',
        activeForm: t.activeForm || '',
      })
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

export type TranscriptStats = {
  ok: boolean
  sessionId: string
  model: string
  cwd: string
  gitBranch: string
  contextTokens: number
  contextLimit: number
  contextPct: number
  totalInputTokens: number
  totalOutputTokens: number
  estCostUsd: number
  turns: number
  lastAction: { tool: string; detail: string } | null
  firstUserText: string
  aiTitle: string
  permissionMode: string
  lastPrompt: string
  toolCounts: Record<string, number>
  mtime: number
  ts: number
}

export type TaskItem = { id: string; subject: string; status: string; activeForm: string }

export type SessionMeta = {
  id: string
  engine: 'claude' | 'codex' | 'cursor' | 'openrouter' | 'hermes'
  cwd: string
  gitBranch: string
  model: string
  turns: number
  firstUserText: string
  mtime: number
}

export type ObservabilitySession = {
  id: string
  engine: 'claude' | 'codex' | 'cursor' | 'openrouter' | 'hermes'
  title: string
  cwd: string
  repo: string
  gitBranch: string
  model: string
  turns: number
  mtime: number
  telemetry: 'ready' | 'metadata-only'
  contextTokens: number
  contextLimit: number
  contextPct: number
  totalInputTokens: number
  totalOutputTokens: number
  estCostUsd: number
  toolCounts: Record<string, number>
  toolTotal: number
  lastAction: { tool: string; detail: string } | null
  firstUserText: string
}

export type ObservabilityEventKind =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'token_snapshot'
  | 'agent_launch'
  | 'skill_invoke'
  | 'warning'
  | 'parse_error'

export type ObservabilityTokenSnapshot = {
  timestamp: number
  input: number
  output: number
  cachedInput: number
  total: number
  contextTokens: number
  cumulativeInput: number
  cumulativeOutput: number
  cumulativeTotal: number
}

export type ObservabilityTimelineEvent = {
  id: string
  sessionId: string
  timestamp: number
  line: number
  kind: ObservabilityEventKind
  severity: 'info' | 'warning' | 'error'
  turnId?: string
  callId?: string
  toolName?: string
  previewText: string
  argumentsPreview?: string
  argumentsBytes?: number
  commandPreview?: string
  outputPreview?: string
  outputBytes?: number
  durationMs?: number
  resultEventId?: string
  joinedOutputPreview?: string
  tokenSnapshot?: ObservabilityTokenSnapshot
  agentRole?: string
  agentTaskPreview?: string
  skillName?: string
}

export type ObservabilityToolCall = {
  callId: string
  toolName: string
  startedAt: number
  completedAt?: number
  line: number
  completedLine?: number
  turnId?: string
  status: 'open' | 'ok' | 'error'
  argumentsPreview?: string
  argumentsBytes?: number
  commandPreview?: string
  outputPreview?: string
  outputBytes?: number
  durationMs?: number
  resultEventId?: string
  agentRole?: string
  skillName?: string
}

export type ObservabilityToolCallPayload = {
  sessionId: string
  callId: string
  toolName: string
  status: 'open' | 'ok' | 'error'
  inputText: string
  outputText: string
  inputBytes: number
  outputBytes: number
  sourceFile: string
  startedLine: number
  completedLine?: number
  commandText?: string
  skillName?: string
  agentRole?: string
  error?: string
}

export type ObservabilityTranscriptLine = {
  line: number
  text: string
  timestamp?: number
  role?: string
  kind?: string
  callId?: string
  toolName?: string
}

// Full (untruncated) records used by the SQLite indexer so the index becomes the
// complete record of a session — every tool call's exact request/response JSON and
// every transcript event, not just the previews the live detail views carry.
export type ObservabilityFullToolPayload = {
  callId: string
  turnId: string
  toolName: string
  status: 'open' | 'ok' | 'error'
  inputText: string
  outputText: string
  errorText: string
  commandText: string
  skillName: string
  agentRole: string
  inputBytes: number
  outputBytes: number
  startedLine: number
  completedLine: number | null
  truncated: boolean
}

export type ObservabilityIndexEvent = {
  seq: number
  line: number
  timestamp: number
  kind: ObservabilityEventKind
  severity: 'info' | 'warning' | 'error'
  turnId: string
  callId: string
  toolName: string
  role: string
  text: string
  bytes: number
}

export type ObservabilityIndexRecords = {
  toolPayloads: ObservabilityFullToolPayload[]
  events: ObservabilityIndexEvent[]
}

export type ObservabilityTranscriptWindow = {
  sessionId: string
  sourceFile: string
  startLine: number
  endLine: number
  totalLines: number
  lines: ObservabilityTranscriptLine[]
  error?: string
}

export type ObservabilityTurn = {
  id: string
  startedAt: number
  completedAt: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  toolCalls: number
  lastMessage: string
}

export type ObservabilityAgentGraph = {
  nodes: {
    id: string
    label: string
    role: string
    depth: number
    tokens: number
    status: 'root' | 'open' | 'closed' | 'failed'
    taskPreview?: string
  }[]
  edges: {
    id: string
    from: string
    to: string
    status: 'open' | 'closed' | 'failed'
    toolCallId?: string
  }[]
}

export type ObservabilitySessionDetail = {
  session: ObservabilitySession
  events: ObservabilityTimelineEvent[]
  toolCalls: ObservabilityToolCall[]
  tokenSnapshots: ObservabilityTokenSnapshot[]
  turns: ObservabilityTurn[]
  graph: ObservabilityAgentGraph
  warnings: string[]
}

export type ObservabilitySnapshot = {
  ts: number
  sessions: ObservabilitySession[]
  totals: {
    sessions: number
    readySessions: number
    tokens: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    toolCalls: number
  }
  byEngine: Record<string, { sessions: number; readySessions: number; tokens: number; costUsd: number; toolCalls: number }>
  byRepo: Record<string, { sessions: number; tokens: number; costUsd: number; toolCalls: number }>
  topTools: { tool: string; count: number }[]
}

// opus 4.x blended estimate ($/token). Cache reads are ~10% of input price.
const PRICE = { input: 15 / 1e6, output: 75 / 1e6, cacheRead: 1.5 / 1e6 }

// Context window per model. Opus 4.6+ and Sonnet 4.5+ run the 1M window;
// everything else (older Opus, Haiku, Claude 3.x) defaults to 200k.
function modelContextWindow(model: string): number {
  const m = model.toLowerCase()
  if (/\[1m\]|-1m\b/.test(m)) return 1_000_000
  if (/opus-4-[678]/.test(m)) return 1_000_000
  if (/sonnet-4-[567]/.test(m)) return 1_000_000
  return 200_000
}

function contextLimitFor(model: string, latestContext: number): number {
  if (process.env.GT_CONTEXT_LIMIT) return Number(process.env.GT_CONTEXT_LIMIT)
  // start from the model's known window; self-correct upward if a session
  // somehow carries more than mapped (so we never show >100%).
  let limit = modelContextWindow(model)
  while (latestContext > limit) limit = limit < 1_000_000 ? 1_000_000 : limit * 2
  return limit
}

function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  if (!input) return ''
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return pick('description') || pick('command').slice(0, 60)
    case 'Edit':
    case 'Write':
    case 'Read':
      return pick('file_path').split('/').slice(-2).join('/')
    case 'Task':
      return pick('description')
    default:
      return (pick('file_path') || pick('path') || pick('query') || pick('pattern')).slice(0, 60)
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && (b as any).type === 'text')
      .map((b) => (b as any).text)
      .join(' ')
  }
  return ''
}

function compactPreview(value: unknown, max = 900): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > max ? `${compacted.slice(0, max)}...` : compacted
}

function resultText(content: unknown, toolUseResult?: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    let nonText = 0
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text' && typeof (block as any).text === 'string') {
        parts.push((block as any).text)
      } else if (block && typeof block === 'object') {
        nonText++
      }
    }
    if (nonText > 0) parts.push(`[${nonText} non-text block${nonText === 1 ? '' : 's'}]`)
    return parts.join('\n')
  }
  if (toolUseResult && typeof toolUseResult === 'object' && (toolUseResult as any).success === false) return 'command failed'
  return ''
}

function timestampMs(obj: any, line: number): number {
  if (typeof obj?.timestamp === 'string') {
    const parsed = Date.parse(obj.timestamp)
    if (Number.isFinite(parsed)) return parsed
  }
  return line
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

function stableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringProp(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function toolCallKind(toolName: string): ObservabilityEventKind {
  if (toolName === 'Task' || toolName === 'Agent') return 'agent_launch'
  if (toolName === 'Skill') return 'skill_invoke'
  return 'tool_call'
}

function statMtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function newestFiles(files: string[], limit = SESSION_PICKER_LIMIT): string[] {
  return files
    .map((file) => ({ file, mtime: statMtimeMs(file) }))
    .filter((f) => f.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.file)
}

function readPickerWindow(file: string): { raw: string; mtime: number } | null {
  try {
    const st = statSync(file)
    const mtime = st.mtimeMs
    if (st.size <= PICKER_HEAD_BYTES + PICKER_TAIL_BYTES) {
      return { raw: readFileSync(file, 'utf8'), mtime }
    }

    const fd = openSync(file, 'r')
    try {
      const head = Buffer.alloc(PICKER_HEAD_BYTES)
      const tailLen = Math.min(PICKER_TAIL_BYTES, st.size)
      const tail = Buffer.alloc(tailLen)
      readSync(fd, head, 0, PICKER_HEAD_BYTES, 0)
      readSync(fd, tail, 0, tailLen, st.size - tailLen)
      return { raw: `${head.toString('utf8')}\n${tail.toString('utf8')}`, mtime }
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

/** Locate a session's transcript file by id, across all project dirs. */
export function findSessionFile(sessionId: string): string | null {
  if (!sessionId || !existsSync(PROJECTS_DIR)) return null
  for (const project of readdirSync(PROJECTS_DIR)) {
    const p = join(PROJECTS_DIR, project, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * The most recent assistant turn in a transcript, by reading just the tail.
 * `endTurn` is true when that turn finished (stop_reason 'end_turn') vs. is
 * mid-work ('tool_use'); `id` dedupes so a completion fires once. Tail-only so
 * it's cheap to poll across many sessions.
 */
export function lastAssistantTurn(file: string): { id: string; endTurn: boolean } | null {
  try {
    const size = statSync(file).size
    if (!size) return null
    const len = Math.min(size, 65536)
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      let o: any
      try {
        o = JSON.parse(lines[i])
      } catch {
        continue // first line in the window may be truncated — skip
      }
      if (o?.type === 'assistant') {
        const m = o.message || {}
        return { id: String(m.id || o.uuid || o.timestamp || i), endTurn: m.stop_reason === 'end_turn' }
      }
    }
  } catch {
    /* unreadable */
  }
  return null
}

/** The text of the most recent assistant turn (concatenated text blocks), tail-
 *  only. Used by the paired-loop listener's Claude fallback to forward a turn to
 *  the peer when the agent didn't write an events.jsonl handoff. '' if none. */
export function lastAssistantText(file: string): string {
  try {
    const size = statSync(file).size
    if (!size) return ''
    const len = Math.min(size, 65536)
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      let o: any
      try {
        o = JSON.parse(lines[i])
      } catch {
        continue
      }
      if (o?.type === 'assistant') {
        const c = o.message?.content
        if (Array.isArray(c))
          return c
            .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('\n')
            .trim()
        if (typeof c === 'string') return c.trim()
        return ''
      }
    }
  } catch {
    /* unreadable */
  }
  return ''
}

function emptyStats(sessionId = ''): TranscriptStats {
  return {
    ok: false,
    sessionId,
    model: 'unknown',
    cwd: '',
    gitBranch: '',
    contextTokens: 0,
    contextLimit: 200_000,
    contextPct: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estCostUsd: 0,
    turns: 0,
    lastAction: null,
    firstUserText: '',
    aiTitle: '',
    permissionMode: '',
    lastPrompt: '',
    toolCounts: {},
    mtime: 0,
    ts: Date.now(),
  }
}

/** Parse one transcript file into full stats. */
export function parseTranscriptFile(file: string, sessionId: string): TranscriptStats {
  let raw: string
  let mtime = 0
  try {
    raw = readFileSync(file, 'utf8')
    mtime = statSync(file).mtimeMs
  } catch {
    return emptyStats(sessionId)
  }

  let model = 'unknown'
  let cwd = ''
  let gitBranch = ''
  let firstUserText = ''
  let contextTokens = 0
  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let turns = 0
  let lastAction: { tool: string; detail: string } | null = null
  let aiTitle = ''
  let permissionMode = ''
  let lastPrompt = ''
  const toolCounts: Record<string, number> = {}
  const seenUsage = new Set<string>()
  const seenToolUses = new Set<string>()

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
    if (!gitBranch && typeof obj.gitBranch === 'string') gitBranch = obj.gitBranch
    // Claude writes these as standalone lines (no message); keep the latest.
    if (obj.type === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle
    else if (obj.type === 'permission-mode' && obj.permissionMode) permissionMode = obj.permissionMode
    else if (obj.type === 'last-prompt' && typeof obj.lastPrompt === 'string') lastPrompt = obj.lastPrompt

    const msg = obj.message
    if (!msg) continue

    if (msg.role === 'user' && !firstUserText) {
      const t = textOf(msg.content).trim()
      // skip tool_result-only / command-noise lines
      if (t && !t.startsWith('<') && !Array.isArray(msg.content)) firstUserText = t.slice(0, 140)
      else if (t && Array.isArray(msg.content) && !t.startsWith('<'))
        firstUserText = t.slice(0, 140)
    }

    if (msg.role !== 'assistant') continue
    const u = msg.usage
    const usageKey = String(msg.id || obj.requestId || obj.uuid || `${obj.timestamp || ''}:${JSON.stringify(u || {})}`)
    if (u && !seenUsage.has(usageKey)) {
      seenUsage.add(usageKey)
      turns++
      if (msg.model) model = msg.model
      const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      const cacheRead = u.cache_read_input_tokens || 0
      const output = u.output_tokens || 0
      totalInput += input
      totalCacheRead += cacheRead
      totalOutput += output
      contextTokens = input + cacheRead + output
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'tool_use') {
          const toolKey = typeof block.id === 'string' ? block.id : `${obj.uuid || ''}:${block.name}:${JSON.stringify(block.input || {})}`
          if (seenToolUses.has(toolKey)) continue
          seenToolUses.add(toolKey)
          lastAction = { tool: block.name, detail: summarizeToolInput(block.name, block.input) }
          toolCounts[block.name] = (toolCounts[block.name] || 0) + 1
        }
      }
    }
  }

  const contextLimit = contextLimitFor(model, contextTokens)
  return {
    ok: turns > 0,
    sessionId,
    model,
    cwd,
    gitBranch,
    contextTokens,
    contextLimit,
    contextPct: Math.min(100, (contextTokens / contextLimit) * 100),
    totalInputTokens: totalInput + totalCacheRead,
    totalOutputTokens: totalOutput,
    estCostUsd:
      totalInput * PRICE.input + totalCacheRead * PRICE.cacheRead + totalOutput * PRICE.output,
    turns,
    lastAction,
    firstUserText,
    aiTitle,
    permissionMode,
    lastPrompt,
    toolCounts,
    mtime,
    ts: Date.now(),
  }
}

export function parseTranscriptDetailFile(
  file: string,
  sessionId: string,
  stats = parseTranscriptFile(file, sessionId),
): Omit<ObservabilitySessionDetail, 'session'> {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { events: [], toolCalls: [], tokenSnapshots: [], turns: [], graph: { nodes: [], edges: [] }, warnings: ['Transcript unreadable'] }
  }

  const events: ObservabilityTimelineEvent[] = []
  const warnings: string[] = []
  const tokenSnapshots: ObservabilityTokenSnapshot[] = []
  let currentTurn = ''
  let turnIndex = 0
  let cumulativeInput = 0
  let cumulativeOutput = 0
  let cumulativeTotal = 0
  const seenUsage = new Set<string>()
  const seenToolUses = new Set<string>()

  const pushEvent = (event: Omit<ObservabilityTimelineEvent, 'id' | 'sessionId'>) => {
    events.push({
      ...event,
      id: `${sessionId}:${event.line}:${events.length}`,
      sessionId,
    })
  }

  raw.split('\n').forEach((line, index) => {
    const lineNo = index + 1
    if (!line.trim()) return
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch (e) {
      warnings.push(`line ${lineNo}: malformed JSON`)
      pushEvent({
        timestamp: lineNo,
        line: lineNo,
        kind: 'parse_error',
        severity: 'error',
        previewText: (e as Error).message || 'Malformed JSON',
      })
      return
    }

    const timestamp = timestampMs(obj, lineNo)
    const msg = obj.message
    const role = msg?.role || obj.role
    const content = msg?.content ?? obj.content

    if (role === 'user') {
      const blocks = Array.isArray(content) ? content : []
      const results = blocks.filter((block) => block && typeof block === 'object' && (block as any).type === 'tool_result')
      if (results.length > 0) {
        for (const block of results) {
          const full = resultText((block as any).content, obj.toolUseResult)
          const isError = !!((block as any).is_error || obj.toolUseResult?.success === false)
          pushEvent({
            timestamp,
            line: lineNo,
            kind: 'tool_result',
            severity: isError ? 'error' : 'info',
            turnId: currentTurn || undefined,
            callId: typeof (block as any).tool_use_id === 'string' ? (block as any).tool_use_id : undefined,
            previewText: compactPreview(full, 1200) || 'tool completed',
            outputPreview: compactPreview(full, 4000),
            outputBytes: Buffer.byteLength(full || '', 'utf8'),
          })
        }
        return
      }

      const text = textOf(content).trim()
      if (!text || text.startsWith('<')) return
      turnIndex++
      currentTurn = `turn-${turnIndex}`
      pushEvent({
        timestamp,
        line: lineNo,
        kind: 'user_message',
        severity: 'info',
        turnId: currentTurn,
        previewText: compactPreview(text, 2000),
      })
      return
    }

    if (role !== 'assistant') return

    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b: any = block
        if (b.type === 'thinking') {
          pushEvent({
            timestamp,
            line: lineNo,
            kind: 'reasoning',
            severity: 'info',
            turnId: currentTurn || undefined,
            previewText: compactPreview(b.thinking || '(reasoning withheld)', 1600),
          })
        } else if (b.type === 'text') {
          pushEvent({
            timestamp,
            line: lineNo,
            kind: 'assistant_message',
            severity: 'info',
            turnId: currentTurn || undefined,
            previewText: compactPreview(b.text || '', 2400),
          })
        } else if (b.type === 'tool_use') {
          const toolName = String(b.name || 'tool')
          const callId = typeof b.id === 'string' ? b.id : `${sessionId}:${lineNo}:${toolName}:${events.length}`
          const toolKey = typeof b.id === 'string' ? b.id : `${obj.uuid || ''}:${toolName}:${JSON.stringify(b.input || {})}`
          if (seenToolUses.has(toolKey)) continue
          seenToolUses.add(toolKey)
          const input = inputRecord(b.input)
          const kind = toolCallKind(toolName)
          const commandPreview = toolName === 'Bash' ? stringProp(input, 'command') : undefined
          const agentRole = kind === 'agent_launch' ? stringProp(input, 'subagent_type', 'agent_type', 'role') || 'agent' : undefined
          const agentTaskPreview = kind === 'agent_launch' ? compactPreview(stringProp(input, 'description', 'prompt', 'task'), 1200) : undefined
          const skillName = kind === 'skill_invoke' ? stringProp(input, 'skill', 'name', 'command') : undefined
          pushEvent({
            timestamp,
            line: lineNo,
            kind,
            severity: 'info',
            turnId: currentTurn || undefined,
            callId,
            toolName,
            previewText: `${toolName} ${commandPreview || agentTaskPreview || skillName || summarizeToolInput(toolName, input)}`.trim(),
            argumentsPreview: compactPreview(input, 1400),
            argumentsBytes: Buffer.byteLength(stableJson(input), 'utf8'),
            commandPreview,
            agentRole,
            agentTaskPreview,
            skillName,
          })
        }
      }
    }

    const u = msg?.usage
    const usageKey = String(msg?.id || obj.requestId || obj.uuid || `${obj.timestamp || ''}:${JSON.stringify(u || {})}`)
    if (u && !seenUsage.has(usageKey)) {
      seenUsage.add(usageKey)
      const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      const cachedInput = u.cache_read_input_tokens || 0
      const output = u.output_tokens || 0
      const total = input + cachedInput + output
      if (total > 0) {
        cumulativeInput += input + cachedInput
        cumulativeOutput += output
        cumulativeTotal += total
        const snapshot: ObservabilityTokenSnapshot = {
          timestamp,
          input,
          output,
          cachedInput,
          total,
          contextTokens: total,
          cumulativeInput,
          cumulativeOutput,
          cumulativeTotal,
        }
        tokenSnapshots.push(snapshot)
        pushEvent({
          timestamp,
          line: lineNo,
          kind: 'token_snapshot',
          severity: 'info',
          turnId: currentTurn || undefined,
          previewText: `in ${input + cachedInput} / out ${output} / total ${total}`,
          tokenSnapshot: snapshot,
        })
      }
    }
  })

  const resultByCall = new Map(events.filter((event) => event.kind === 'tool_result' && event.callId).map((event) => [event.callId as string, event]))
  const callEvents = events.filter((event) => (event.kind === 'tool_call' || event.kind === 'agent_launch' || event.kind === 'skill_invoke') && event.callId)
  const toolCalls: ObservabilityToolCall[] = callEvents.map((call) => {
    const result = resultByCall.get(call.callId as string)
    const durationMs = result ? Math.max(0, result.timestamp - call.timestamp) : undefined
    if (result) {
      call.joinedOutputPreview = result.outputPreview
      call.resultEventId = result.id
      call.durationMs = durationMs
      result.toolName = call.toolName
    }
    return {
      callId: call.callId as string,
      toolName: call.toolName || 'tool',
      startedAt: call.timestamp,
      completedAt: result?.timestamp,
      line: call.line,
      completedLine: result?.line,
      turnId: call.turnId,
      status: !result ? 'open' : result.severity === 'error' ? 'error' : 'ok',
      argumentsPreview: call.argumentsPreview,
      argumentsBytes: call.argumentsBytes,
      commandPreview: call.commandPreview,
      outputPreview: result?.outputPreview,
      outputBytes: result?.outputBytes,
      durationMs,
      resultEventId: result?.id,
      agentRole: call.agentRole,
      skillName: call.skillName,
    }
  })

  const turns = [...new Set(events.map((event) => event.turnId).filter((turnId): turnId is string => !!turnId))].map((turnId) => {
    const rows = events.filter((event) => event.turnId === turnId)
    const lastToken = [...rows].reverse().find((event) => event.tokenSnapshot)?.tokenSnapshot
    const startedAt = rows[0]?.timestamp || 0
    const completedAt = rows.at(-1)?.timestamp || startedAt
    return {
      id: turnId,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      inputTokens: lastToken ? lastToken.input + lastToken.cachedInput : 0,
      outputTokens: lastToken?.output || 0,
      totalTokens: lastToken?.total || 0,
      toolCalls: rows.filter((event) => event.kind === 'tool_call' || event.kind === 'agent_launch' || event.kind === 'skill_invoke').length,
      lastMessage: [...rows].reverse().find((event) => event.kind === 'assistant_message')?.previewText || '',
    }
  })

  const graph: ObservabilityAgentGraph = {
    nodes: [
      {
        id: sessionId,
        label: stats.aiTitle || stats.firstUserText || sessionId.slice(0, 8),
        role: 'root',
        depth: 0,
        tokens: stats.totalInputTokens + stats.totalOutputTokens,
        status: 'root',
      },
    ],
    edges: [],
  }
  for (const call of callEvents.filter((event) => event.kind === 'agent_launch')) {
    const result = call.callId ? resultByCall.get(call.callId) : undefined
    const nodeId = `${sessionId}:${call.callId || call.id}`
    const status = !result ? 'open' : result.severity === 'error' ? 'failed' : 'closed'
    graph.nodes.push({
      id: nodeId,
      label: call.agentRole || call.toolName || 'agent',
      role: call.agentRole || 'agent',
      depth: 1,
      tokens: 0,
      status,
      taskPreview: call.agentTaskPreview,
    })
    graph.edges.push({
      id: `${sessionId}->${nodeId}`,
      from: sessionId,
      to: nodeId,
      status,
      toolCallId: call.callId,
    })
  }

  return { events, toolCalls, tokenSnapshots, turns, graph, warnings }
}

/**
 * Stats for the attached session (by id). Cached by file mtime so the several
 * widgets that poll the transcript share one parse and fast polling stays cheap
 * — we only re-parse when the transcript actually grows.
 */
let tCache: { id: string; mtime: number; stats: TranscriptStats } | null = null
export function readTranscriptStats(sessionId: string): TranscriptStats {
  const file = sessionId ? findSessionFile(sessionId) : null
  if (!file) return emptyStats(sessionId)
  let mtime = 0
  try {
    mtime = statSync(file).mtimeMs
  } catch {
    return emptyStats(sessionId)
  }
  if (tCache && tCache.id === sessionId && tCache.mtime === mtime) return tCache.stats
  const stats = withStatusLineContext(parseTranscriptFile(file, sessionId), sessionId)
  tCache = { id: sessionId, mtime, stats }
  return stats
}

// Claude's statusLine reports the authoritative context_window_size, which
// fixes the model-table guess in contextLimitFor (e.g. 200k vs 1M). When the
// cache has it, recompute the limit/pct from that.
function withStatusLineContext(stats: TranscriptStats, sessionId: string): TranscriptStats {
  if (process.env.GT_CONTEXT_LIMIT) return stats
  const sl = readStatusLine(sessionId)
  if (!sl?.contextWindowSize) return stats
  const contextLimit = sl.contextWindowSize
  return {
    ...stats,
    contextLimit,
    contextPct: Math.min(100, (stats.contextTokens / contextLimit) * 100),
  }
}

/** All sessions across all projects, newest first — for the entry picker. */
function parseClaudeSessionMeta(file: string, id: string): SessionMeta | null {
  const win = readPickerWindow(file)
  if (!win) return null

  let model = 'unknown'
  let cwd = ''
  let gitBranch = ''
  let firstUserText = ''
  let turns = 0

  for (const line of win.raw.split('\n')) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
    if (!gitBranch && typeof obj.gitBranch === 'string') gitBranch = obj.gitBranch

    const msg = obj.message
    if (!msg) continue
    if (msg.role === 'user' && !firstUserText) {
      const t = textOf(msg.content).trim()
      if (t && !t.startsWith('<')) firstUserText = t.slice(0, 140)
    }
    if (msg.role === 'assistant' && msg.usage) {
      turns++
      if (msg.model) model = msg.model
    }
  }

  if (!id || (!cwd && !firstUserText)) return null
  return {
    id,
    engine: 'claude',
    cwd,
    gitBranch,
    model,
    turns,
    firstUserText,
    mtime: win.mtime,
  }
}

function listClaudeSessions(): SessionMeta[] {
  const files: { file: string; id: string }[] = []
  if (!existsSync(PROJECTS_DIR)) return []
  for (const project of readdirSync(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, project)
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue
      files.push({ file: join(dir, f), id: f.replace(/\.jsonl$/, '') })
    }
  }
  const idsByFile = new Map(files.map((f) => [f.file, f.id]))
  return newestFiles(
    files.map((f) => f.file),
  )
    .map((file) => parseClaudeSessionMeta(file, idsByFile.get(file) || ''))
    .filter((s): s is SessionMeta => !!s)
}

function walkJsonlFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return out
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const p = join(dir, entry)
    try {
      const st = statSync(p)
      if (st.isDirectory()) walkJsonlFiles(p, out, depth + 1)
      else if (entry.endsWith('.jsonl')) out.push(p)
    } catch {
      /* skip */
    }
  }
  return out
}

export function parseCodexSessionFile(file: string): SessionMeta | null {
  const win = readPickerWindow(file)
  if (!win) return null

  let id = file.replace(/\.jsonl$/, '').split('/').pop() || ''
  id = id.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '')
  let cwd = ''
  let model = ''
  let firstUserText = ''
  let turns = 0

  for (const line of win.raw.split('\n')) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const payload = obj.payload || {}
    if (obj.type === 'session_meta') {
      if (typeof payload.id === 'string') id = payload.id
      if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
    } else if (obj.type === 'turn_context') {
      if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
      if (typeof payload.model === 'string') model = payload.model
    } else if (obj.type === 'event_msg' && payload.type === 'user_message') {
      turns++
      if (!firstUserText && typeof payload.message === 'string') firstUserText = payload.message
    } else if (obj.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      turns++
      if (!firstUserText) firstUserText = textOf(payload.content)
    }
  }

  if (!id || (!cwd && !firstUserText)) return null
  return {
    id,
    engine: 'codex',
    cwd,
    gitBranch: '',
    model: model || 'codex',
    turns,
    firstUserText,
    mtime: win.mtime,
  }
}

function listCodexSessions(): SessionMeta[] {
  if (!existsSync(CODEX_SESSIONS_DIR)) return []
  return newestFiles(walkJsonlFiles(CODEX_SESSIONS_DIR))
    .map(parseCodexSessionFile)
    .filter((s): s is SessionMeta => !!s)
}

function slugToPath(slug: string): string {
  if (!slug || /^\d+$/.test(slug) || slug === 'empty-window' || slug.startsWith('var-folders-')) return ''
  return '/' + slug.replace(/-/g, '/')
}

export function parseCursorSessionFile(file: string): SessionMeta | null {
  const win = readPickerWindow(file)
  if (!win) return null
  let id = file.split('/').pop()?.replace(/\.jsonl$/, '') || ''
  const parts = file.split('/')
  const projectsIdx = parts.lastIndexOf('projects')
  const slug = projectsIdx >= 0 ? parts[projectsIdx + 1] || '' : ''
  const cwd = slugToPath(slug)
  let firstUserText = ''
  let model = 'cursor'
  let turns = 0
  for (const line of win.raw.split('\n')) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof obj.session_id === 'string') id = obj.session_id
    if (typeof obj.model === 'string') model = obj.model
    if (obj.role === 'user' || obj.message?.role === 'user') {
      turns++
      if (!firstUserText) {
        firstUserText = textOf(obj.message?.content ?? obj.content)
          .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
          .replace(/<\/?user_query>/g, '')
          .trim()
          .slice(0, 140)
      }
    }
  }
  if (!id || (!cwd && !firstUserText)) return null
  return {
    id,
    engine: 'cursor',
    cwd,
    gitBranch: '',
    model,
    turns,
    firstUserText,
    mtime: win.mtime,
  }
}

function listCursorSessions(): SessionMeta[] {
  if (!existsSync(CURSOR_PROJECTS_DIR)) return []
  const files: string[] = []
  for (const project of readdirSync(CURSOR_PROJECTS_DIR)) {
    const dir = join(CURSOR_PROJECTS_DIR, project, 'agent-transcripts')
    if (!existsSync(dir)) continue
    for (const sessionDir of readdirSync(dir)) {
      const f = join(dir, sessionDir, `${sessionDir}.jsonl`)
      if (existsSync(f)) files.push(f)
    }
  }
  return newestFiles(files).map(parseCursorSessionFile).filter((s): s is SessionMeta => !!s)
}

/** Sessions for the entry picker. Engine-scoped calls keep startup cheap. */
export function listSessions(engine?: 'claude' | 'codex' | 'cursor' | 'openrouter' | 'hermes'): SessionMeta[] {
  const out =
    engine === 'claude'
      ? listClaudeSessions()
      : engine === 'codex'
        ? listCodexSessions()
        : engine === 'cursor'
          ? listCursorSessions()
          : [...listClaudeSessions(), ...listCodexSessions(), ...listCursorSessions()]
  return out.sort((a, b) => b.mtime - a.mtime)
}

function repoLabel(cwd: string): string {
  if (!cwd) return 'unknown'
  try {
    const root = repoRootOf(cwd)
    return root.replace(/\/$/, '').split('/').pop() || root || 'unknown'
  } catch {
    return cwd.replace(/\/$/, '').split('/').pop() || cwd || 'unknown'
  }
}

function sessionTitle(meta: SessionMeta, stats?: TranscriptStats): string {
  return (
    stats?.aiTitle ||
    stats?.firstUserText ||
    meta.firstUserText ||
    meta.id.slice(0, 8) ||
    `${meta.engine} session`
  )
}

function toObservabilitySession(meta: SessionMeta, stats?: TranscriptStats | null): ObservabilitySession {
  const ready = !!stats?.ok
  const toolCounts = ready ? stats.toolCounts : {}
  return {
    id: meta.id,
    engine: meta.engine,
    title: sessionTitle(meta, stats || undefined),
    cwd: stats?.cwd || meta.cwd,
    repo: repoLabel(stats?.cwd || meta.cwd),
    gitBranch: stats?.gitBranch || meta.gitBranch,
    model: stats?.model || meta.model,
    turns: stats?.turns || meta.turns,
    mtime: stats?.mtime || meta.mtime,
    telemetry: ready ? 'ready' : 'metadata-only',
    contextTokens: ready ? stats.contextTokens : 0,
    contextLimit: ready ? stats.contextLimit : 0,
    contextPct: ready ? stats.contextPct : 0,
    totalInputTokens: ready ? stats.totalInputTokens : 0,
    totalOutputTokens: ready ? stats.totalOutputTokens : 0,
    estCostUsd: ready ? stats.estCostUsd : 0,
    toolCounts,
    toolTotal: Object.values(toolCounts).reduce((sum, count) => sum + count, 0),
    lastAction: ready ? stats.lastAction : null,
    firstUserText: stats?.firstUserText || meta.firstUserText,
  }
}

export function readObservabilitySnapshot(limit = 120): ObservabilitySnapshot {
  const sessions = listSessions().slice(0, Math.max(1, Math.min(500, limit))).map((meta): ObservabilitySession => {
    const stats = meta.engine === 'claude' ? readTranscriptStats(meta.id) : null
    return toObservabilitySession(meta, stats)
  })

  const totals: ObservabilitySnapshot['totals'] = {
    sessions: sessions.length,
    readySessions: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    toolCalls: 0,
  }
  const byEngine: ObservabilitySnapshot['byEngine'] = {}
  const byRepo: ObservabilitySnapshot['byRepo'] = {}
  const tools = new Map<string, number>()
  for (const session of sessions) {
    const tokens = session.totalInputTokens + session.totalOutputTokens
    totals.readySessions += session.telemetry === 'ready' ? 1 : 0
    totals.tokens += tokens
    totals.inputTokens += session.totalInputTokens
    totals.outputTokens += session.totalOutputTokens
    totals.costUsd += session.estCostUsd
    totals.toolCalls += session.toolTotal

    const engine = (byEngine[session.engine] ??= { sessions: 0, readySessions: 0, tokens: 0, costUsd: 0, toolCalls: 0 })
    engine.sessions++
    engine.readySessions += session.telemetry === 'ready' ? 1 : 0
    engine.tokens += tokens
    engine.costUsd += session.estCostUsd
    engine.toolCalls += session.toolTotal

    const repo = (byRepo[session.repo] ??= { sessions: 0, tokens: 0, costUsd: 0, toolCalls: 0 })
    repo.sessions++
    repo.tokens += tokens
    repo.costUsd += session.estCostUsd
    repo.toolCalls += session.toolTotal

    for (const [tool, count] of Object.entries(session.toolCounts)) tools.set(tool, (tools.get(tool) || 0) + count)
  }

  return {
    ts: Date.now(),
    sessions,
    totals,
    byEngine,
    byRepo,
    topTools: [...tools.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([tool, count]) => ({ tool, count })),
  }
}

let observabilityDetailCache: { id: string; mtime: number; detail: ObservabilitySessionDetail } | null = null

export function readObservabilitySessionDetail(sessionId: string): ObservabilitySessionDetail | null {
  const file = findSessionFile(sessionId)
  if (!file) return null
  const mtime = statMtimeMs(file)
  if (observabilityDetailCache?.id === sessionId && observabilityDetailCache.mtime === mtime) {
    return observabilityDetailCache.detail
  }

  const stats = withStatusLineContext(parseTranscriptFile(file, sessionId), sessionId)
  const meta =
    listSessions('claude').find((session) => session.id === sessionId) ||
    ({
      id: sessionId,
      engine: 'claude',
      cwd: stats.cwd,
      gitBranch: stats.gitBranch,
      model: stats.model,
      turns: stats.turns,
      firstUserText: stats.firstUserText,
      mtime: stats.mtime,
    } satisfies SessionMeta)
  const detail = {
    session: toObservabilitySession(meta, stats),
    ...parseTranscriptDetailFile(file, sessionId, stats),
  }
  observabilityDetailCache = { id: sessionId, mtime, detail }
  return detail
}

export function readObservabilityToolCallPayload(sessionId: string, callId: string): ObservabilityToolCallPayload | null {
  const file = findSessionFile(sessionId)
  if (!file || !callId) return null

  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }

  let toolName = 'tool'
  let inputText = ''
  let outputText = ''
  let inputBytes = 0
  let outputBytes = 0
  let startedLine = 0
  let completedLine: number | undefined
  let commandText: string | undefined
  let skillName: string | undefined
  let agentRole: string | undefined
  let status: ObservabilityToolCallPayload['status'] = 'open'

  raw.split('\n').forEach((line, index) => {
    if (!line.trim()) return
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      return
    }
    const content = obj.message?.content ?? obj.content
    if (obj.message?.role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object' || (block as any).type !== 'tool_use') continue
        if ((block as any).id !== callId) continue
        const input = inputRecord((block as any).input)
        toolName = String((block as any).name || 'tool')
        inputText = stableJson(input)
        inputBytes = Buffer.byteLength(inputText, 'utf8')
        startedLine = index + 1
        commandText = toolName === 'Bash' ? stringProp(input, 'command') : undefined
        skillName = toolCallKind(toolName) === 'skill_invoke' ? stringProp(input, 'skill', 'name', 'command') : undefined
        agentRole = toolCallKind(toolName) === 'agent_launch' ? stringProp(input, 'subagent_type', 'agent_type', 'role') || undefined : undefined
      }
    }
    if (obj.message?.role === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object' || (block as any).type !== 'tool_result') continue
        if ((block as any).tool_use_id !== callId) continue
        outputText = resultText((block as any).content, obj.toolUseResult)
        outputBytes = Buffer.byteLength(outputText || '', 'utf8')
        completedLine = index + 1
        status = (block as any).is_error || obj.toolUseResult?.success === false ? 'error' : 'ok'
      }
    }
  })

  if (!startedLine) return null
  return {
    sessionId,
    callId,
    toolName,
    status,
    inputText,
    outputText,
    inputBytes,
    outputBytes,
    sourceFile: file,
    startedLine,
    completedLine,
    commandText,
    skillName,
    agentRole,
  }
}

// Per-field hard cap so a single pathological tool result (a giant file dump) can't
// bloat the SQLite row. 1 MB of UTF-8 text is far beyond any payload worth reading
// inline; anything larger is marked `truncated` so the UX can say so.
const FULL_PAYLOAD_CAP = 1_000_000

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= FULL_PAYLOAD_CAP) return { text, truncated: false }
  return { text: `${text.slice(0, FULL_PAYLOAD_CAP)}\n…[truncated ${text.length - FULL_PAYLOAD_CAP} chars]`, truncated: true }
}

/**
 * Single-pass extraction of the FULL session record for the SQLite index: every
 * tool call's exact request JSON + response text (untruncated, save the 1 MB cap)
 * and the complete chronological event stream with full message/reasoning text.
 * The live detail parser (`parseTranscriptDetailFile`) keeps only previews to stay
 * cheap for polling widgets; this is the lossless counterpart the indexer persists.
 */
export function readObservabilityIndexRecords(sessionId: string): ObservabilityIndexRecords | null {
  const file = findSessionFile(sessionId)
  if (!file) return null
  return parseObservabilityIndexRecordsFile(file, sessionId)
}

export function parseObservabilityIndexRecordsFile(file: string, sessionId: string): ObservabilityIndexRecords {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { toolPayloads: [], events: [] }
  }

  type CallAccum = {
    callId: string
    turnId: string
    toolName: string
    inputText: string
    inputBytes: number
    commandText: string
    skillName: string
    agentRole: string
    startedLine: number
    outputText: string
    outputBytes: number
    completedLine: number | null
    status: 'open' | 'ok' | 'error'
    isError: boolean
  }
  const calls = new Map<string, CallAccum>()
  const events: ObservabilityIndexEvent[] = []
  let currentTurn = ''
  let turnIndex = 0
  let seq = 0

  const pushEvent = (e: Omit<ObservabilityIndexEvent, 'seq' | 'bytes'> & { bytes?: number }) => {
    events.push({ ...e, seq: seq++, bytes: e.bytes ?? Buffer.byteLength(e.text || '', 'utf8') })
  }

  raw.split('\n').forEach((line, index) => {
    const lineNo = index + 1
    if (!line.trim()) return
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch (e) {
      pushEvent({ line: lineNo, timestamp: lineNo, kind: 'parse_error', severity: 'error', turnId: currentTurn, callId: '', toolName: '', role: '', text: (e as Error).message || 'Malformed JSON' })
      return
    }
    const timestamp = timestampMs(obj, lineNo)
    const msg = obj.message
    const role = msg?.role || obj.role
    const content = msg?.content ?? obj.content

    if (role === 'user') {
      const blocks = Array.isArray(content) ? content : []
      const results = blocks.filter((b) => b && typeof b === 'object' && (b as any).type === 'tool_result')
      if (results.length > 0) {
        for (const block of results) {
          const callId = typeof (block as any).tool_use_id === 'string' ? (block as any).tool_use_id : ''
          const full = resultText((block as any).content, obj.toolUseResult)
          const isError = !!((block as any).is_error || obj.toolUseResult?.success === false)
          pushEvent({ line: lineNo, timestamp, kind: 'tool_result', severity: isError ? 'error' : 'info', turnId: currentTurn, callId, toolName: '', role: 'user', text: full })
          if (callId) {
            const call = calls.get(callId)
            if (call) {
              call.outputText = full
              call.outputBytes = Buffer.byteLength(full || '', 'utf8')
              call.completedLine = lineNo
              call.status = isError ? 'error' : 'ok'
              call.isError = isError
            }
          }
        }
        return
      }
      const text = textOf(content).trim()
      if (!text || text.startsWith('<')) return
      turnIndex++
      currentTurn = `turn-${turnIndex}`
      pushEvent({ line: lineNo, timestamp, kind: 'user_message', severity: 'info', turnId: currentTurn, callId: '', toolName: '', role: 'user', text })
      return
    }

    if (role !== 'assistant' || !Array.isArray(content)) return
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b: any = block
      if (b.type === 'thinking') {
        pushEvent({ line: lineNo, timestamp, kind: 'reasoning', severity: 'info', turnId: currentTurn, callId: '', toolName: '', role: 'assistant', text: String(b.thinking || '') })
      } else if (b.type === 'text') {
        pushEvent({ line: lineNo, timestamp, kind: 'assistant_message', severity: 'info', turnId: currentTurn, callId: '', toolName: '', role: 'assistant', text: String(b.text || '') })
      } else if (b.type === 'tool_use') {
        const toolName = String(b.name || 'tool')
        const callId = typeof b.id === 'string' ? b.id : `${sessionId}:${lineNo}:${toolName}:${seq}`
        if (calls.has(callId)) continue
        const input = inputRecord(b.input)
        const inputText = stableJson(input)
        const kind = toolCallKind(toolName)
        const commandText = toolName === 'Bash' ? stringProp(input, 'command') : ''
        const agentRole = kind === 'agent_launch' ? stringProp(input, 'subagent_type', 'agent_type', 'role') || 'agent' : ''
        const skillName = kind === 'skill_invoke' ? stringProp(input, 'skill', 'name', 'command') : ''
        calls.set(callId, {
          callId,
          turnId: currentTurn,
          toolName,
          inputText,
          inputBytes: Buffer.byteLength(inputText, 'utf8'),
          commandText,
          skillName,
          agentRole,
          startedLine: lineNo,
          outputText: '',
          outputBytes: 0,
          completedLine: null,
          status: 'open',
          isError: false,
        })
        pushEvent({ line: lineNo, timestamp, kind, severity: 'info', turnId: currentTurn, callId, toolName, role: 'assistant', text: inputText })
      }
    }
  })

  const toolPayloads: ObservabilityFullToolPayload[] = [...calls.values()].map((c) => {
    const inp = capText(c.inputText)
    const out = capText(c.outputText)
    return {
      callId: c.callId,
      turnId: c.turnId,
      toolName: c.toolName,
      status: c.status,
      inputText: inp.text,
      outputText: out.text,
      errorText: c.isError ? out.text : '',
      commandText: c.commandText,
      skillName: c.skillName,
      agentRole: c.agentRole,
      inputBytes: c.inputBytes,
      outputBytes: c.outputBytes,
      startedLine: c.startedLine,
      completedLine: c.completedLine,
      truncated: inp.truncated || out.truncated,
    }
  })

  for (const e of events) {
    if (e.text.length > FULL_PAYLOAD_CAP) e.text = capText(e.text).text
  }

  return { toolPayloads, events }
}

export function readObservabilityTranscriptWindow(sessionId: string, centerLine = 0, radius = 24): ObservabilityTranscriptWindow | null {
  const file = findSessionFile(sessionId)
  if (!file) return null

  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const allLines = raw.split('\n')
  const totalLines = allLines.length
  const safeRadius = Math.max(4, Math.min(80, Math.floor(radius || 24)))
  const center = centerLine > 0 ? Math.min(totalLines, Math.floor(centerLine)) : totalLines
  const startLine = Math.max(1, center - safeRadius)
  const endLine = Math.min(totalLines, center + safeRadius)
  const lines: ObservabilityTranscriptLine[] = []

  for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
    const text = allLines[lineNo - 1] || ''
    if (!text.trim()) continue
    const row: ObservabilityTranscriptLine = { line: lineNo, text }
    try {
      const obj: any = JSON.parse(text)
      row.timestamp = timestampMs(obj, lineNo)
      row.kind = String(obj.type || obj.message?.type || '')
      row.role = String(obj.message?.role || obj.role || '')
      const content = obj.message?.content ?? obj.content
      if (Array.isArray(content)) {
        const toolUse = content.find((block) => block && typeof block === 'object' && (block as any).type === 'tool_use')
        const toolResult = content.find((block) => block && typeof block === 'object' && (block as any).type === 'tool_result')
        if (toolUse) {
          row.callId = typeof (toolUse as any).id === 'string' ? (toolUse as any).id : undefined
          row.toolName = typeof (toolUse as any).name === 'string' ? (toolUse as any).name : undefined
        } else if (toolResult) {
          row.callId = typeof (toolResult as any).tool_use_id === 'string' ? (toolResult as any).tool_use_id : undefined
          row.toolName = 'tool_result'
        }
      }
    } catch {
      row.kind = 'parse_error'
    }
    lines.push(row)
  }

  return { sessionId, sourceFile: file, startLine, endLine, totalLines, lines }
}

// ---------------------------------------------------------------------------
// Autopilot-harness TDD reader — scoped to the attached session's repo.
// Derives owner/repo from the cwd's git remote, reads that repo's newest
// tracked PR review artifact (shared logic in review.ts).
// ---------------------------------------------------------------------------

export type TddInfo = {
  ok: boolean
  repo: string
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  ts: number
}

let tddCache: { cwd: string; ts: number; info: TddInfo } | null = null
export function readHarnessTdd(cwd: string): TddInfo {
  if (tddCache && tddCache.cwd === cwd && Date.now() - tddCache.ts < 2000) return tddCache.info
  const info = computeHarnessTdd(cwd)
  tddCache = { cwd, ts: Date.now(), info }
  return info
}

function computeHarnessTdd(cwd: string): TddInfo {
  const repo = repoForCwd(cwd)
  const base: TddInfo = {
    ok: false,
    repo: repo?.path || '',
    number: 0,
    overall: null,
    verdict: 'none',
    testStatus: 'none',
    stale: false,
    commitsBehind: 0,
    ts: Date.now(),
  }
  if (!repo) return base
  const dir = newestReviewDirForRepo(repoRootOf(cwd), repo.host, repo.path)
  if (!dir) return base
  const r = reviewForPrDir(dir)
  if (!r) return base
  return { ...base, ok: true, ...r }
}
