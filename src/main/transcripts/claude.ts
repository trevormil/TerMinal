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
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  isRecord,
  messageOf,
  sidecarOf,
  parseLine,
  isTextBlock,
  isToolResultBlock,
  toolFailed,
  usageTotals,
  userPromptOf,
  type UserPrompt,
} from '../transcript-schema'
import { readStatusLine } from '../statusline'
import {
  compactPreview,
  inputRecord,
  newestFileStats,
  readPickerWindow,
  sessionMetaCache,
  stableJson,
  stringProp,
  summarizeToolInput,
  textOf,
  timestampMs,
  toolCallKind,
  resultText,
} from './common'
import type {
  ObservabilityAgentGraph,
  ObservabilitySessionDetail,
  ObservabilityTimelineEvent,
  ObservabilityTokenSnapshot,
  ObservabilityToolCall,
  SessionMeta,
  TaskItem,
  TranscriptStats,
} from '../../shared/types/observability'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const TASKS_DIR = join(homedir(), '.claude', 'tasks')

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

/** A session id is interpolated into a `<id>.jsonl` filesystem path, so it must
 *  not contain path separators or `..` — otherwise a renderer-supplied value
 *  like `../../../secret` would escape PROJECTS_DIR and read arbitrary
 *  .jsonl files. (Real ids are UUIDs; this only rejects traversal.) */
export function isValidSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.length > 0 && !/[\\/]|\.\./.test(sessionId)
}

/** Locate a session's transcript file by id, across all project dirs. */
export function findSessionFile(sessionId: string): string | null {
  if (!isValidSessionId(sessionId) || !existsSync(PROJECTS_DIR)) return null
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
/** The agent's closing text of the last turn — the "what just happened" summary
 *  for the completion notification. First text block, whitespace-collapsed and
 *  clipped to a headline length. */
export function lastAssistantMessage(m: { content?: unknown }): string {
  const content = m?.content
  const text = Array.isArray(content)
    ? content
        .filter(isTextBlock)
        .map((b) => b.text)
        .join(' ')
    : typeof content === 'string'
      ? content
      : ''
  return text.replace(/\s+/g, ' ').trim()
}

export function lastAssistantTurn(
  file: string,
): { id: string; endTurn: boolean; summary: string } | null {
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
      const o = parseLine(lines[i])
      if (!o) continue // first line in the window may be truncated — skip
      if (o?.type === 'assistant') {
        const m = messageOf(o)
        return {
          id: String(m?.id || o.uuid || o.timestamp || i),
          endTurn: isRecord(o.message) && o.message.stop_reason === 'end_turn',
          summary: lastAssistantMessage(m ?? {}),
        }
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
      const o = parseLine(lines[i])
      if (!o) continue
      if (o?.type === 'assistant') {
        const c = messageOf(o)?.content
        if (Array.isArray(c))
          return c
            .filter(isTextBlock)
            .map((b) => b.text)
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

/** The widget renders a short tail; keeping more would ship a whole session's
 *  prompts over IPC on every poll. */
const RECENT_PROMPTS_MAX = 10

/** Append, dropping the oldest past the cap. Mutates in place — both parse
 *  paths hold a long-lived array. */
function pushPrompt(list: UserPrompt[], prompt: UserPrompt): void {
  list.push(prompt)
  if (list.length > RECENT_PROMPTS_MAX) list.splice(0, list.length - RECENT_PROMPTS_MAX)
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
    recentPrompts: [],
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
  const recentPrompts: UserPrompt[] = []
  const toolCounts: Record<string, number> = {}
  const seenUsage = new Set<string>()
  const seenToolUses = new Set<string>()

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const obj = parseLine(line)
    if (!obj) continue
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
    if (!gitBranch && typeof obj.gitBranch === 'string') gitBranch = obj.gitBranch
    // Claude writes these as standalone lines (no message); keep the latest.
    const sidecar = sidecarOf(obj)
    if (sidecar?.type === 'ai-title') aiTitle = sidecar.aiTitle
    else if (sidecar?.type === 'permission-mode') permissionMode = sidecar.permissionMode
    else if (sidecar?.type === 'last-prompt') lastPrompt = sidecar.lastPrompt

    const prompt = userPromptOf(obj)
    if (prompt) pushPrompt(recentPrompts, prompt)

    const msg = messageOf(obj)
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
    const usageKey = String(
      msg.id || obj.requestId || obj.uuid || `${obj.timestamp || ''}:${JSON.stringify(u || {})}`,
    )
    if (u && !seenUsage.has(usageKey)) {
      seenUsage.add(usageKey)
      turns++
      if (msg.model) model = msg.model
      const { input, cacheRead, output } = usageTotals(u)
      totalInput += input
      totalCacheRead += cacheRead
      totalOutput += output
      contextTokens = input + cacheRead + output
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'tool_use') {
          const toolKey =
            typeof block.id === 'string'
              ? block.id
              : `${obj.uuid || ''}:${block.name}:${JSON.stringify(block.input || {})}`
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
    recentPrompts,
    toolCounts,
    mtime,
    ts: Date.now(),
  }
}

export type TranscriptStatsAccumulator = {
  sessionId: string
  model: string
  cwd: string
  gitBranch: string
  firstUserText: string
  contextTokens: number
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  turns: number
  lastAction: { tool: string; detail: string } | null
  aiTitle: string
  permissionMode: string
  lastPrompt: string
  recentPrompts: UserPrompt[]
  toolCounts: Record<string, number>
  seenUsage: Set<string>
  seenToolUses: Set<string>
}

export type TranscriptStatsFileParseState = {
  file: string
  size: number
  mtime: number
  offset: number
  pending: string
  accumulator: TranscriptStatsAccumulator
  stats: TranscriptStats
}

type TranscriptRangeReader = (file: string, start: number, end: number) => string

export function createTranscriptStatsAccumulator(sessionId = ''): TranscriptStatsAccumulator {
  return {
    sessionId,
    model: 'unknown',
    cwd: '',
    gitBranch: '',
    firstUserText: '',
    contextTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    turns: 0,
    lastAction: null,
    aiTitle: '',
    permissionMode: '',
    lastPrompt: '',
    recentPrompts: [],
    toolCounts: {},
    seenUsage: new Set<string>(),
    seenToolUses: new Set<string>(),
  }
}

export function foldTranscriptStatsLines(
  accumulator: TranscriptStatsAccumulator,
  lines: string | string[],
): TranscriptStatsAccumulator {
  const source = Array.isArray(lines) ? lines : lines.split('\n')
  for (const line of source) {
    if (!line.trim()) continue
    const obj = parseLine(line)
    if (!obj) continue
    if (!accumulator.cwd && typeof obj.cwd === 'string') accumulator.cwd = obj.cwd
    if (!accumulator.gitBranch && typeof obj.gitBranch === 'string')
      accumulator.gitBranch = obj.gitBranch
    // Claude writes standalone lines (no message); keep latest.
    const sidecar = sidecarOf(obj)
    if (sidecar?.type === 'ai-title') accumulator.aiTitle = sidecar.aiTitle
    else if (sidecar?.type === 'permission-mode')
      accumulator.permissionMode = sidecar.permissionMode
    else if (sidecar?.type === 'last-prompt') accumulator.lastPrompt = sidecar.lastPrompt

    const prompt = userPromptOf(obj)
    if (prompt) pushPrompt(accumulator.recentPrompts, prompt)

    const msg = messageOf(obj)
    if (!msg) continue

    if (msg.role === 'user' && !accumulator.firstUserText) {
      const t = textOf(msg.content).trim()
      // skip tool_result-only / command-noise lines
      if (t && !t.startsWith('<') && !Array.isArray(msg.content))
        accumulator.firstUserText = t.slice(0, 140)
      if (t && Array.isArray(msg.content) && !t.startsWith('<'))
        accumulator.firstUserText = t.slice(0, 140)
    }

    if (msg.role !== 'assistant') continue
    const u = msg.usage
    const usageKey = String(
      msg.id || obj.requestId || obj.uuid || `${obj.timestamp || ''}:${JSON.stringify(u || {})}`,
    )
    if (u && !accumulator.seenUsage.has(usageKey)) {
      accumulator.seenUsage.add(usageKey)
      accumulator.turns++
      if (msg.model) accumulator.model = msg.model
      const { input, cacheRead, output } = usageTotals(u)
      accumulator.totalInput += input
      accumulator.totalCacheRead += cacheRead
      accumulator.totalOutput += output
      accumulator.contextTokens = input + cacheRead + output
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'tool_use') {
          const toolKey =
            typeof block.id === 'string'
              ? block.id
              : `${obj.uuid || ''}:${block.name}:${JSON.stringify(block.input || {})}`
          if (accumulator.seenToolUses.has(toolKey)) continue
          accumulator.seenToolUses.add(toolKey)
          accumulator.lastAction = {
            tool: block.name,
            detail: summarizeToolInput(block.name, block.input),
          }
          accumulator.toolCounts[block.name] = (accumulator.toolCounts[block.name] || 0) + 1
        }
      }
    }
  }
  return accumulator
}

export function transcriptStatsFromAccumulator(
  accumulator: TranscriptStatsAccumulator,
  mtime: number,
): TranscriptStats {
  const contextLimit = contextLimitFor(accumulator.model, accumulator.contextTokens)
  return {
    ok: accumulator.turns > 0,
    sessionId: accumulator.sessionId,
    model: accumulator.model,
    cwd: accumulator.cwd,
    gitBranch: accumulator.gitBranch,
    contextTokens: accumulator.contextTokens,
    contextLimit,
    contextPct: Math.min(100, (accumulator.contextTokens / contextLimit) * 100),
    totalInputTokens: accumulator.totalInput + accumulator.totalCacheRead,
    totalOutputTokens: accumulator.totalOutput,
    estCostUsd:
      accumulator.totalInput * PRICE.input +
      accumulator.totalCacheRead * PRICE.cacheRead +
      accumulator.totalOutput * PRICE.output,
    turns: accumulator.turns,
    lastAction: accumulator.lastAction,
    firstUserText: accumulator.firstUserText,
    aiTitle: accumulator.aiTitle,
    permissionMode: accumulator.permissionMode,
    lastPrompt: accumulator.lastPrompt,
    recentPrompts: accumulator.recentPrompts,
    toolCounts: accumulator.toolCounts,
    mtime,
    ts: Date.now(),
  }
}

function readTranscriptRange(file: string, start: number, end: number): string {
  const length = Math.max(0, end - start)
  if (!length) return ''
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const bytes = readSync(fd, buf, 0, length, start)
    return buf.subarray(0, bytes).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function splitCompleteTranscriptLines(raw: string): { lines: string[]; pending: string } {
  const lines = raw.split('\n')
  if (raw.endsWith('\n')) return { lines, pending: '' }

  const tail = lines.pop() ?? ''
  if (!tail.trim()) return { lines, pending: tail }
  try {
    JSON.parse(tail)
    lines.push(tail)
    return { lines, pending: '' }
  } catch {
    return { lines, pending: tail }
  }
}

export function parseTranscriptFileIncremental(
  file: string,
  sessionId: string,
  previous: TranscriptStatsFileParseState | null,
  size: number,
  mtime: number,
  readRange: TranscriptRangeReader = readTranscriptRange,
): TranscriptStatsFileParseState {
  const reset =
    !previous ||
    previous.file !== file ||
    size < previous.offset ||
    (size === previous.offset && mtime !== previous.mtime)
  const base = reset
    ? {
        file,
        size: 0,
        mtime: 0,
        offset: 0,
        pending: '',
        accumulator: createTranscriptStatsAccumulator(sessionId),
        stats: emptyStats(sessionId),
      }
    : previous

  let pending = base.pending
  if (size > base.offset) {
    const chunk = readRange(file, base.offset, size)
    const split = splitCompleteTranscriptLines(pending + chunk)
    foldTranscriptStatsLines(base.accumulator, split.lines)
    pending = split.pending
  }

  return {
    file,
    size,
    mtime,
    offset: size,
    pending,
    accumulator: base.accumulator,
    stats: transcriptStatsFromAccumulator(base.accumulator, mtime),
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
    return {
      events: [],
      toolCalls: [],
      tokenSnapshots: [],
      turns: [],
      graph: { nodes: [], edges: [] },
      warnings: ['Transcript unreadable'],
    }
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
    const obj = parseLine(line)
    if (!obj) {
      warnings.push(`line ${lineNo}: malformed JSON`)
      pushEvent({
        timestamp: lineNo,
        line: lineNo,
        kind: 'parse_error',
        severity: 'error',
        previewText: 'Malformed JSON',
      })
      return
    }

    const timestamp = timestampMs(obj, lineNo)
    const msg = messageOf(obj)
    const role = msg?.role || obj.role
    const content = msg?.content ?? obj.content

    if (role === 'user') {
      const blocks = Array.isArray(content) ? content : []
      const results = blocks.filter(isToolResultBlock)
      if (results.length > 0) {
        for (const block of results) {
          const full = resultText(block.content, obj.toolUseResult)
          const isError = toolFailed(block, obj.toolUseResult)
          pushEvent({
            timestamp,
            line: lineNo,
            kind: 'tool_result',
            severity: isError ? 'error' : 'info',
            turnId: currentTurn || undefined,
            callId: typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
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
          const callId =
            typeof b.id === 'string' ? b.id : `${sessionId}:${lineNo}:${toolName}:${events.length}`
          const toolKey =
            typeof b.id === 'string'
              ? b.id
              : `${obj.uuid || ''}:${toolName}:${JSON.stringify(b.input || {})}`
          if (seenToolUses.has(toolKey)) continue
          seenToolUses.add(toolKey)
          const input = inputRecord(b.input)
          const kind = toolCallKind(toolName)
          const commandPreview = toolName === 'Bash' ? stringProp(input, 'command') : undefined
          const agentRole =
            kind === 'agent_launch'
              ? stringProp(input, 'subagent_type', 'agent_type', 'role') || 'agent'
              : undefined
          const agentTaskPreview =
            kind === 'agent_launch'
              ? compactPreview(stringProp(input, 'description', 'prompt', 'task'), 1200)
              : undefined
          const skillName =
            kind === 'skill_invoke' ? stringProp(input, 'skill', 'name', 'command') : undefined
          pushEvent({
            timestamp,
            line: lineNo,
            kind,
            severity: 'info',
            turnId: currentTurn || undefined,
            callId,
            toolName,
            previewText:
              `${toolName} ${commandPreview || agentTaskPreview || skillName || summarizeToolInput(toolName, input)}`.trim(),
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
    const usageKey = String(
      msg?.id || obj.requestId || obj.uuid || `${obj.timestamp || ''}:${JSON.stringify(u || {})}`,
    )
    if (u && !seenUsage.has(usageKey)) {
      seenUsage.add(usageKey)
      const { input, cacheRead: cachedInput, output } = usageTotals(u)
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

  const resultByCall = new Map(
    events
      .filter((event) => event.kind === 'tool_result' && event.callId)
      .map((event) => [event.callId as string, event]),
  )
  const callEvents = events.filter(
    (event) =>
      (event.kind === 'tool_call' ||
        event.kind === 'agent_launch' ||
        event.kind === 'skill_invoke') &&
      event.callId,
  )
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

  const turns = [
    ...new Set(events.map((event) => event.turnId).filter((turnId): turnId is string => !!turnId)),
  ].map((turnId) => {
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
      toolCalls: rows.filter(
        (event) =>
          event.kind === 'tool_call' ||
          event.kind === 'agent_launch' ||
          event.kind === 'skill_invoke',
      ).length,
      lastMessage:
        [...rows].reverse().find((event) => event.kind === 'assistant_message')?.previewText || '',
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
// Must cover the observability snapshot/rebuild sweeps (up to ~500 sessions
// per pass) — at 8 entries those sweeps evicted everything every pass and each
// session took the cold full-file re-parse path (tens of seconds over a GB
// archive). Parse states are small (counters + per-turn id sets), so ~512
// stays in the tens of MB even for heavy archives.
const TRANSCRIPT_STATS_PARSE_STATE_MAX_ENTRIES = 512
const transcriptStatsParseStates = new Map<string, TranscriptStatsFileParseState>()

function rememberTranscriptStatsParseState(
  sessionId: string,
  state: TranscriptStatsFileParseState,
): void {
  transcriptStatsParseStates.delete(sessionId)
  transcriptStatsParseStates.set(sessionId, state)
  while (transcriptStatsParseStates.size > TRANSCRIPT_STATS_PARSE_STATE_MAX_ENTRIES) {
    const oldest = transcriptStatsParseStates.keys().next().value
    if (!oldest) return
    transcriptStatsParseStates.delete(oldest)
  }
}

export function readTranscriptStats(sessionId: string): TranscriptStats {
  const file = sessionId ? findSessionFile(sessionId) : null
  if (!file) return emptyStats(sessionId)
  let size = 0
  let mtime = 0
  try {
    const st = statSync(file)
    size = st.size
    mtime = st.mtimeMs
  } catch {
    return emptyStats(sessionId)
  }
  const cached = transcriptStatsParseStates.get(sessionId)
  if (cached && cached.file === file && cached.size === size && cached.mtime === mtime) {
    rememberTranscriptStatsParseState(sessionId, cached)
    return withStatusLineContext(cached.stats, sessionId)
  }
  try {
    const next = parseTranscriptFileIncremental(file, sessionId, cached || null, size, mtime)
    rememberTranscriptStatsParseState(sessionId, next)
    return withStatusLineContext(next.stats, sessionId)
  } catch {
    transcriptStatsParseStates.delete(sessionId)
    return emptyStats(sessionId)
  }
}

export function resetTranscriptStatsCacheForTests(): void {
  transcriptStatsParseStates.clear()
}

// Claude's statusLine reports the authoritative context_window_size, which
// fixes the model-table guess in contextLimitFor (e.g. 200k vs 1M). When the
// cache has it, recompute the limit/pct from that.
export function withStatusLineContext(stats: TranscriptStats, sessionId: string): TranscriptStats {
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
    const obj = parseLine(line)
    if (!obj) continue
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
    if (!gitBranch && typeof obj.gitBranch === 'string') gitBranch = obj.gitBranch

    const msg = messageOf(obj)
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

export function listClaudeSessions(): SessionMeta[] {
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
  return newestFileStats(files.map((f) => f.file))
    .map((st) =>
      sessionMetaCache().get(st.file, st.size, st.mtimeMs, () =>
        parseClaudeSessionMeta(st.file, idsByFile.get(st.file) || ''),
      ),
    )
    .filter((s): s is SessionMeta => !!s)
}
