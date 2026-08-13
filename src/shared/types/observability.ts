import type { UserPrompt } from './app'

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
  /** The last few prompts the human typed, oldest first. See RECENT_PROMPTS_MAX. */
  recentPrompts: UserPrompt[]
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
  byEngine: Record<
    string,
    { sessions: number; readySessions: number; tokens: number; costUsd: number; toolCalls: number }
  >
  byRepo: Record<string, { sessions: number; tokens: number; costUsd: number; toolCalls: number }>
  topTools: { tool: string; count: number }[]
}

export type ObservabilityIndexStatus = {
  ok: boolean
  dbPath: string
  exists: boolean
  sqliteAvailable: boolean
  indexedAt: number | null
  sessions: number
  turns: number
  toolCalls: number
  tokenSnapshots: number
  events: number
  error?: string
}

export type ObservabilityIndexBuildResult = ObservabilityIndexStatus & {
  durationMs: number
  indexedSessions: number
}

export type ObservabilityIndexQueryId =
  | 'sessions_by_tokens'
  | 'low_yield_sessions'
  | 'tool_calls'
  | 'tool_payloads'
  | 'tool_errors'
  | 'tool_call_bloat'
  | 'turn_hotspots'
  | 'costliest_turns'
  | 'model_rollup'
  | 'repo_rollup'
  | 'session_events'
  | 'audit'

/**
 * Shared scope narrowing for the canned queries. Before this, every question was
 * "all history" or "one session"; these are the four axes the toolbar exposes.
 * Applied against the `sessions` row a result joins to — so a repo/model/engine
 * filter means "sessions matching this", and since/until bound `sessions.mtime`.
 */
export type ObservabilityQueryFilter = {
  /** Inclusive lower bound, ms epoch. */
  since?: number
  /** Inclusive upper bound, ms epoch. */
  until?: number
  repo?: string
  engine?: string
  model?: string
}

export type ObservabilityIndexQueryResult = {
  query: ObservabilityIndexQueryId
  title: string
  description: string
  columns: string[]
  rows: Record<string, unknown>[]
  indexedAt: number | null
  dbPath: string
  /** When set, the query needs a scope argument (e.g. a session_id) it didn't get. */
  needsArg?: 'session_id'
  error?: string
}

export type TranscriptHit = {
  /** 1-based line number in the .jsonl — the jump-to-context anchor. */
  line: number
  role: SearchHitRole
  timestamp?: number
  preview: string
}

export type SessionSearchResult = {
  sessionId: string
  engine: string
  cwd: string
  mtime: number
  firstUserText?: string
  hits: TranscriptHit[]
}

export type SearchHitRole = 'user' | 'assistant' | 'tool' | 'other'
