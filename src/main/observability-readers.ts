// ---------------------------------------------------------------------------
// Observability readers — the READ side of the observability surface.
//
// These turn the per-engine transcript parsers in transcripts/ into the shapes
// the Observability tab and the SQLite indexer consume: the cross-session
// snapshot, one session's detail, a single tool call's full payload, the
// lossless index records, and a windowed view of a raw transcript.
//
// Deliberately a sibling of observability-index.ts rather than folded into it:
// that module is the WRITE side (it opens the SQLite database, builds, and
// queries it) and it imports these readers. Merging the two would make one
// ~2,000-line module with both responsibilities, and the data.ts facade
// re-exporting from it would close an import cycle.
// ---------------------------------------------------------------------------
import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import {
  messageOf,
  parseLine,
  isToolResultBlock,
  isToolUseBlock,
  toolFailed,
} from './transcript-schema'
import { repoRootOf } from './repo'
import { listSessions } from './transcripts'
import {
  findSessionFile,
  parseTranscriptDetailFile,
  parseTranscriptFile,
  readTranscriptStats,
  withStatusLineContext,
} from './transcripts/claude'
import {
  inputRecord,
  resultText,
  stableJson,
  statMtimeMs,
  stringProp,
  textOf,
  timestampMs,
  toolCallKind,
} from './transcripts/common'
import type {
  ObservabilityEventKind,
  ObservabilitySession,
  ObservabilitySessionDetail,
  ObservabilitySnapshot,
  ObservabilityToolCallPayload,
  ObservabilityTranscriptLine,
  ObservabilityTranscriptWindow,
  SessionMeta,
  TranscriptStats,
} from '../shared/types/observability'

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

function toObservabilitySession(
  meta: SessionMeta,
  stats?: TranscriptStats | null,
): ObservabilitySession {
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
  const sessions = listSessions()
    .slice(0, Math.max(1, Math.min(500, limit)))
    .map((meta): ObservabilitySession => {
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

    const engine = (byEngine[session.engine] ??= {
      sessions: 0,
      readySessions: 0,
      tokens: 0,
      costUsd: 0,
      toolCalls: 0,
    })
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

    for (const [tool, count] of Object.entries(session.toolCounts))
      tools.set(tool, (tools.get(tool) || 0) + count)
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

let observabilityDetailCache: {
  id: string
  mtime: number
  detail: ObservabilitySessionDetail
} | null = null

export function readObservabilitySessionDetail(
  sessionId: string,
  // The caller may pass a pre-computed Claude session list to reuse across many
  // calls. Bulk index rebuilds do this: without it, every call re-ran
  // listSessions('claude') (a full re-scan + re-parse of every transcript's
  // picker window), making the rebuild O(N²). Behavior is identical — same list,
  // same lookup — it's just hoisted out of the loop.
  sessionList?: SessionMeta[],
): ObservabilitySessionDetail | null {
  const file = findSessionFile(sessionId)
  if (!file) return null
  const mtime = statMtimeMs(file)
  if (observabilityDetailCache?.id === sessionId && observabilityDetailCache.mtime === mtime) {
    return observabilityDetailCache.detail
  }

  const stats = withStatusLineContext(parseTranscriptFile(file, sessionId), sessionId)
  const meta =
    (sessionList ?? listSessions('claude')).find((session) => session.id === sessionId) ||
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

export function readObservabilityToolCallPayload(
  sessionId: string,
  callId: string,
): ObservabilityToolCallPayload | null {
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
    const obj = parseLine(line)
    if (!obj) return
    const content = messageOf(obj)?.content ?? obj.content
    if (messageOf(obj)?.role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!isToolUseBlock(block)) continue
        if ((block as any).id !== callId) continue
        const input = inputRecord((block as any).input)
        toolName = String((block as any).name || 'tool')
        inputText = stableJson(input)
        inputBytes = Buffer.byteLength(inputText, 'utf8')
        startedLine = index + 1
        commandText = toolName === 'Bash' ? stringProp(input, 'command') : undefined
        skillName =
          toolCallKind(toolName) === 'skill_invoke'
            ? stringProp(input, 'skill', 'name', 'command')
            : undefined
        agentRole =
          toolCallKind(toolName) === 'agent_launch'
            ? stringProp(input, 'subagent_type', 'agent_type', 'role') || undefined
            : undefined
      }
    }
    if (messageOf(obj)?.role === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object' || (block as any).type !== 'tool_result') continue
        if (!isToolResultBlock(block) || block.tool_use_id !== callId) continue
        outputText = resultText(block.content, obj.toolUseResult)
        outputBytes = Buffer.byteLength(outputText || '', 'utf8')
        completedLine = index + 1
        status = toolFailed(block, obj.toolUseResult) ? 'error' : 'ok'
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
  return {
    text: `${text.slice(0, FULL_PAYLOAD_CAP)}\n…[truncated ${text.length - FULL_PAYLOAD_CAP} chars]`,
    truncated: true,
  }
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

export function parseObservabilityIndexRecordsFile(
  file: string,
  sessionId: string,
): ObservabilityIndexRecords {
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
    const obj = parseLine(line)
    if (!obj) {
      pushEvent({
        line: lineNo,
        timestamp: lineNo,
        kind: 'parse_error',
        severity: 'error',
        turnId: currentTurn,
        callId: '',
        toolName: '',
        role: '',
        text: 'Malformed JSON',
      })
      return
    }
    const timestamp = timestampMs(obj, lineNo)
    const msg = messageOf(obj)
    const role = msg?.role || obj.role
    const content = msg?.content ?? obj.content

    if (role === 'user') {
      const blocks = Array.isArray(content) ? content : []
      const results = blocks.filter(
        (b) => b && typeof b === 'object' && (b as any).type === 'tool_result',
      )
      if (results.length > 0) {
        for (const block of results) {
          const callId =
            typeof (block as any).tool_use_id === 'string' ? (block as any).tool_use_id : ''
          const full = resultText(block.content, obj.toolUseResult)
          const isError = toolFailed(block, obj.toolUseResult)
          pushEvent({
            line: lineNo,
            timestamp,
            kind: 'tool_result',
            severity: isError ? 'error' : 'info',
            turnId: currentTurn,
            callId,
            toolName: '',
            role: 'user',
            text: full,
          })
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
      pushEvent({
        line: lineNo,
        timestamp,
        kind: 'user_message',
        severity: 'info',
        turnId: currentTurn,
        callId: '',
        toolName: '',
        role: 'user',
        text,
      })
      return
    }

    if (role !== 'assistant' || !Array.isArray(content)) return
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b: any = block
      if (b.type === 'thinking') {
        pushEvent({
          line: lineNo,
          timestamp,
          kind: 'reasoning',
          severity: 'info',
          turnId: currentTurn,
          callId: '',
          toolName: '',
          role: 'assistant',
          text: String(b.thinking || ''),
        })
      } else if (b.type === 'text') {
        pushEvent({
          line: lineNo,
          timestamp,
          kind: 'assistant_message',
          severity: 'info',
          turnId: currentTurn,
          callId: '',
          toolName: '',
          role: 'assistant',
          text: String(b.text || ''),
        })
      } else if (b.type === 'tool_use') {
        const toolName = String(b.name || 'tool')
        const callId = typeof b.id === 'string' ? b.id : `${sessionId}:${lineNo}:${toolName}:${seq}`
        if (calls.has(callId)) continue
        const input = inputRecord(b.input)
        const inputText = stableJson(input)
        const kind = toolCallKind(toolName)
        const commandText = toolName === 'Bash' ? stringProp(input, 'command') : ''
        const agentRole =
          kind === 'agent_launch'
            ? stringProp(input, 'subagent_type', 'agent_type', 'role') || 'agent'
            : ''
        const skillName =
          kind === 'skill_invoke' ? stringProp(input, 'skill', 'name', 'command') : ''
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
        pushEvent({
          line: lineNo,
          timestamp,
          kind,
          severity: 'info',
          turnId: currentTurn,
          callId,
          toolName,
          role: 'assistant',
          text: inputText,
        })
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

/** Read just the [center-radius, center+radius] line window of a (possibly very
 *  large) JSONL transcript without materializing the whole file. The previous
 *  readFileSync+split allocated the entire file (tens–hundreds of MB) on the
 *  main thread just to show ~48 lines. Chunked read with a sliding tail buffer
 *  (+ an explicit-center collector) keeps memory O(radius) while reproducing
 *  the exact split('\n') line numbering, including a trailing empty line when
 *  the file ends in a newline. */
export function readLineWindow(
  file: string,
  centerLine: number,
  radius: number,
): {
  windowLines: { line: number; text: string }[]
  startLine: number
  endLine: number
  totalLines: number
} {
  const wantCenter = centerLine > 0
  const cStart = wantCenter ? Math.max(1, Math.floor(centerLine) - radius) : 0
  const cEnd = wantCenter ? Math.floor(centerLine) + radius : 0
  const tail: { line: number; text: string }[] = []
  const ranged: { line: number; text: string }[] = []
  const tailCap = radius * 2 + 1
  let lineNo = 0
  const pushLine = (text: string) => {
    lineNo++
    tail.push({ line: lineNo, text })
    if (tail.length > tailCap) tail.shift()
    if (wantCenter && lineNo >= cStart && lineNo <= cEnd) ranged.push({ line: lineNo, text })
  }

  const fd = openSync(file, 'r')
  try {
    const CHUNK = 64 * 1024
    const buf = Buffer.allocUnsafe(CHUNK)
    let leftover = ''
    let bytes = 0
    while ((bytes = readSync(fd, buf, 0, CHUNK, null)) > 0) {
      leftover += buf.toString('utf8', 0, bytes)
      let nl: number
      while ((nl = leftover.indexOf('\n')) >= 0) {
        pushLine(leftover.slice(0, nl))
        leftover = leftover.slice(nl + 1)
      }
    }
    pushLine(leftover) // final element — matches split('\n') (empty when file ends in \n)
  } finally {
    closeSync(fd)
  }

  const totalLines = lineNo
  const center = wantCenter ? Math.min(totalLines, Math.floor(centerLine)) : totalLines
  const startLine = Math.max(1, center - radius)
  const endLine = Math.min(totalLines, center + radius)
  const useRanged = wantCenter && Math.floor(centerLine) <= totalLines
  const windowLines = (useRanged ? ranged : tail).filter(
    (l) => l.line >= startLine && l.line <= endLine,
  )
  return { windowLines, startLine, endLine, totalLines }
}

export function readObservabilityTranscriptWindow(
  sessionId: string,
  centerLine = 0,
  radius = 24,
): ObservabilityTranscriptWindow | null {
  const file = findSessionFile(sessionId)
  if (!file) return null

  const safeRadius = Math.max(4, Math.min(80, Math.floor(radius || 24)))
  let win: ReturnType<typeof readLineWindow>
  try {
    win = readLineWindow(file, centerLine, safeRadius)
  } catch {
    return null
  }
  const { windowLines, startLine, endLine, totalLines } = win
  const lines: ObservabilityTranscriptLine[] = []

  for (const { line: lineNo, text } of windowLines) {
    if (!text.trim()) continue
    const row: ObservabilityTranscriptLine = { line: lineNo, text }
    try {
      const obj: any = JSON.parse(text)
      row.timestamp = timestampMs(obj, lineNo)
      row.kind = String(obj.type || obj.message?.type || '')
      row.role = String(messageOf(obj)?.role || obj.role || '')
      const content = messageOf(obj)?.content ?? obj.content
      if (Array.isArray(content)) {
        const toolUse = content.find(
          (block) => block && typeof block === 'object' && (block as any).type === 'tool_use',
        )
        const toolResult = content.find(isToolResultBlock)
        if (toolUse) {
          row.callId = typeof (toolUse as any).id === 'string' ? (toolUse as any).id : undefined
          row.toolName =
            typeof (toolUse as any).name === 'string' ? (toolUse as any).name : undefined
        } else if (toolResult) {
          row.callId =
            typeof (toolResult as any).tool_use_id === 'string'
              ? (toolResult as any).tool_use_id
              : undefined
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

// The TDD reader moved to review.ts, next to the review-artifact parsing it
// wraps (ticket 91). Re-exported for existing importers.
