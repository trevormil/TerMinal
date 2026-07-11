import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { costOf } from './ai-pricing'
import { listSessions, readObservabilityIndexRecords, readObservabilitySessionDetail, readObservabilitySnapshot } from './data'

const DB_PATH = join(homedir(), '.config', 'TerMinal', 'observability.sqlite')

// Row-level queries scan the entire indexed history; this caps how many of the
// top-ranked rows we hand to the renderer so a huge result set can't blow up the
// IPC payload or the (windowed) table. Aggregations (rollups) are unbounded —
// GROUP BY keeps them small. Raise if real histories exceed this.
const ROW_QUERY_CAP = 50000

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

const QUERY_META: Record<ObservabilityIndexQueryId, { title: string; description: string; columns: string[] }> = {
  sessions_by_tokens: {
    title: 'Session token hotspots',
    description: 'Sessions ranked by total indexed input and output tokens.',
    columns: ['session_id', 'engine', 'repo', 'model', 'total_tokens', 'input_tokens', 'output_tokens', 'cost_usd', 'tool_total'],
  },
  low_yield_sessions: {
    title: 'Low-yield sessions',
    description: 'High-input sessions that produced comparatively little output.',
    columns: ['session_id', 'repo', 'model', 'input_tokens', 'output_tokens', 'output_per_input', 'cost_usd'],
  },
  tool_calls: {
    title: 'Specific tool calls',
    description: 'Individual calls with parent-turn tokens plus exact input/output byte footprint.',
    columns: ['session_id', 'call_id', 'repo', 'model', 'turn_id', 'line', 'tool_name', 'skill_name', 'status', 'turn_input_tokens', 'turn_output_tokens', 'turn_total_tokens', 'input_bytes', 'output_bytes', 'duration_ms', 'command_preview'],
  },
  tool_payloads: {
    title: 'Tool call payloads',
    description: 'Every tool call with its full request JSON and full response captured verbatim.',
    columns: ['session_id', 'call_id', 'repo', 'tool_name', 'status', 'input_bytes', 'output_bytes', 'duration_ms', 'truncated', 'input_json', 'output_json'],
  },
  tool_errors: {
    title: 'Tool call errors',
    description: 'Failed tool calls with the captured error output, newest first.',
    columns: ['session_id', 'call_id', 'repo', 'tool_name', 'turn_id', 'line', 'output_bytes', 'duration_ms', 'command_text', 'error_text'],
  },
  tool_call_bloat: {
    title: 'Tool-call output bloat',
    description: 'Tools ranked by captured output bytes and call volume.',
    columns: ['tool_name', 'calls', 'total_output_bytes', 'avg_output_bytes', 'max_output_bytes', 'open_calls', 'error_calls'],
  },
  turn_hotspots: {
    title: 'Turn hotspots',
    description: 'Individual turns ranked by total token usage.',
    columns: ['session_id', 'turn_id', 'repo', 'model', 'total_tokens', 'input_tokens', 'output_tokens', 'tool_calls'],
  },
  costliest_turns: {
    title: 'Costliest turns',
    description: 'Individual turns ranked by estimated USD cost.',
    columns: ['session_id', 'turn_id', 'repo', 'model', 'cost_usd', 'total_tokens', 'input_tokens', 'output_tokens', 'tool_calls', 'duration_ms'],
  },
  model_rollup: {
    title: 'Model rollup',
    description: 'Token, cost, and session totals grouped by model.',
    columns: ['model', 'sessions', 'total_tokens', 'input_tokens', 'output_tokens', 'cost_usd'],
  },
  repo_rollup: {
    title: 'Repo rollup',
    description: 'Token, cost, and tool-call totals grouped by repo.',
    columns: ['repo', 'sessions', 'total_tokens', 'input_tokens', 'output_tokens', 'cost_usd', 'tool_calls'],
  },
  session_events: {
    title: 'Session event stream',
    description: 'Full chronological transcript of one session — every message, reasoning block, tool call and result.',
    columns: ['seq', 'line', 'kind', 'severity', 'turn_id', 'tool_name', 'role', 'bytes', 'text'],
  },
  audit: {
    title: 'Token efficiency audit',
    description: 'Deterministic recommendations from indexed sessions, turns, and tool calls.',
    columns: ['severity', 'scope', 'title', 'metric', 'recommendation'],
  },
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

// Embedded SQLite via better-sqlite3 (native module). Opening is lazy + guarded
// so a native-load failure degrades to "unavailable" with an error instead of
// crashing the main process. Prepared statements + a single transaction replace
// the old `sqlite3` CLI (which hit ENOBUFS piping a multi-hundred-MB script over
// stdin, and maxBuffer limits parsing query JSON back from stdout).
let db: Database.Database | null = null
let dbError: string | null = null

function getDb(): Database.Database | null {
  if (db) return db
  try {
    ensureDir(DB_PATH)
    const handle = new Database(DB_PATH)
    handle.pragma('journal_mode = WAL')
    db = handle
    dbError = null
    return db
  } catch (e) {
    dbError = (e as Error).message
    return null
  }
}

function sqliteAvailable(): boolean {
  return getDb() !== null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function queryJson<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): T[] {
  const handle = getDb()
  if (!handle) return []
  return handle.prepare(sql).all() as T[]
}

// Opening the DB creates the file, so file existence no longer signals "built".
// A populated index is one where the schema (the `sessions` table) exists.
function indexBuilt(): boolean {
  const handle = getDb()
  if (!handle) return false
  try {
    return !!handle.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()
  } catch {
    return false
  }
}

function createSchemaSql(): string {
  return `
DROP TABLE IF EXISTS meta;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS token_snapshots;
DROP TABLE IF EXISTS turns;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS events;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  repo TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  model TEXT NOT NULL,
  mtime REAL NOT NULL,
  telemetry TEXT NOT NULL,
  turns INTEGER NOT NULL,
  context_tokens INTEGER NOT NULL,
  context_limit INTEGER NOT NULL,
  context_pct REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  tool_total INTEGER NOT NULL,
  first_user_text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS token_snapshots (
  session_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cumulative_input INTEGER NOT NULL,
  cumulative_output INTEGER NOT NULL,
  cumulative_total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  started_at REAL NOT NULL,
  completed_at REAL NOT NULL,
  duration_ms REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  tool_calls INTEGER NOT NULL,
  last_message TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_id)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  line INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  started_at REAL NOT NULL,
  completed_at REAL,
  completed_line INTEGER,
  status TEXT NOT NULL,
  input_bytes INTEGER NOT NULL,
  output_bytes INTEGER NOT NULL,
  duration_ms REAL,
  command_preview TEXT NOT NULL,
  command_text TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL DEFAULT '',
  output_json TEXT NOT NULL DEFAULT '',
  error_text TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, call_id)
);
CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  line INTEGER NOT NULL,
  timestamp REAL NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  role TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_sessions_tokens ON sessions(total_tokens DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo);
CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model);
CREATE INDEX IF NOT EXISTS idx_turns_tokens ON turns(total_tokens DESC);
CREATE INDEX IF NOT EXISTS idx_turns_cost ON turns(cost_usd DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_input_bytes ON tool_calls(input_bytes DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_bytes ON tool_calls(output_bytes DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON tool_calls(status);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
`
}

export function rebuildObservabilityIndex(limit = 240): ObservabilityIndexBuildResult {
  const started = Date.now()
  const handle = getDb()
  if (!handle) {
    return { ok: false, dbPath: DB_PATH, exists: existsSync(DB_PATH), sqliteAvailable: false, indexedAt: null, sessions: 0, turns: 0, toolCalls: 0, tokenSnapshots: 0, events: 0, durationMs: 0, indexedSessions: 0, error: dbError || 'better-sqlite3 is not available' }
  }

  const snapshot = readObservabilitySnapshot(Math.max(1, Math.min(100000, limit)))
  const indexedAt = Date.now()
  // Compute the Claude session list ONCE and reuse it for every per-session
  // detail read below. Previously each readObservabilitySessionDetail re-ran
  // listSessions('claude') internally, re-scanning every transcript on disk on
  // every iteration → O(N²) and a multi-second main-thread freeze.
  const claudeSessions = listSessions('claude')

  handle.exec(createSchemaSql())

  const insertMeta = handle.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)')
  const insertSession = handle.prepare(`INSERT OR REPLACE INTO sessions
    (session_id, engine, title, cwd, repo, git_branch, model, mtime, telemetry, turns, context_tokens, context_limit, context_pct, input_tokens, output_tokens, total_tokens, cost_usd, tool_total, first_user_text)
    VALUES (@session_id, @engine, @title, @cwd, @repo, @git_branch, @model, @mtime, @telemetry, @turns, @context_tokens, @context_limit, @context_pct, @input_tokens, @output_tokens, @total_tokens, @cost_usd, @tool_total, @first_user_text)`)
  const insertSnapshot = handle.prepare(`INSERT INTO token_snapshots
    (session_id, timestamp, input_tokens, output_tokens, cached_input_tokens, total_tokens, cumulative_input, cumulative_output, cumulative_total)
    VALUES (@session_id, @timestamp, @input_tokens, @output_tokens, @cached_input_tokens, @total_tokens, @cumulative_input, @cumulative_output, @cumulative_total)`)
  const insertTurn = handle.prepare(`INSERT OR REPLACE INTO turns
    (session_id, turn_id, started_at, completed_at, duration_ms, input_tokens, output_tokens, total_tokens, cost_usd, tool_calls, last_message)
    VALUES (@session_id, @turn_id, @started_at, @completed_at, @duration_ms, @input_tokens, @output_tokens, @total_tokens, @cost_usd, @tool_calls, @last_message)`)
  const insertTool = handle.prepare(`INSERT OR REPLACE INTO tool_calls
    (session_id, call_id, turn_id, line, tool_name, skill_name, agent_role, started_at, completed_at, completed_line, status, input_bytes, output_bytes, duration_ms, command_preview, command_text, input_json, output_json, error_text, truncated)
    VALUES (@session_id, @call_id, @turn_id, @line, @tool_name, @skill_name, @agent_role, @started_at, @completed_at, @completed_line, @status, @input_bytes, @output_bytes, @duration_ms, @command_preview, @command_text, @input_json, @output_json, @error_text, @truncated)`)
  const insertEvent = handle.prepare(`INSERT OR REPLACE INTO events
    (session_id, seq, line, timestamp, kind, severity, turn_id, call_id, tool_name, role, bytes, text)
    VALUES (@session_id, @seq, @line, @timestamp, @kind, @severity, @turn_id, @call_id, @tool_name, @role, @bytes, @text)`)

  const ingest = handle.transaction(() => {
    insertMeta.run({ key: 'indexed_at', value: String(indexedAt) })
    insertMeta.run({ key: 'source_limit', value: String(limit) })

    for (const session of snapshot.sessions) {
      insertSession.run({
        session_id: session.id,
        engine: session.engine,
        title: session.title.slice(0, 500),
        cwd: session.cwd,
        repo: session.repo,
        git_branch: session.gitBranch,
        model: session.model,
        mtime: num(session.mtime),
        telemetry: session.telemetry,
        turns: num(session.turns),
        context_tokens: num(session.contextTokens),
        context_limit: num(session.contextLimit),
        context_pct: num(session.contextPct),
        input_tokens: num(session.totalInputTokens),
        output_tokens: num(session.totalOutputTokens),
        total_tokens: num(session.totalInputTokens) + num(session.totalOutputTokens),
        cost_usd: num(session.estCostUsd),
        tool_total: num(session.toolTotal),
        first_user_text: session.firstUserText.slice(0, 1000),
      })

      if (session.engine !== 'claude' || session.telemetry !== 'ready') continue
      let detail: ReturnType<typeof readObservabilitySessionDetail> = null
      try {
        detail = readObservabilitySessionDetail(session.id, claudeSessions)
      } catch {
        detail = null
      }
      if (!detail) continue

      for (const snap of detail.tokenSnapshots) {
        insertSnapshot.run({
          session_id: session.id,
          timestamp: num(snap.timestamp),
          input_tokens: num(snap.input),
          output_tokens: num(snap.output),
          cached_input_tokens: num(snap.cachedInput),
          total_tokens: num(snap.total),
          cumulative_input: num(snap.cumulativeInput),
          cumulative_output: num(snap.cumulativeOutput),
          cumulative_total: num(snap.cumulativeTotal),
        })
      }
      for (const turn of detail.turns) {
        insertTurn.run({
          session_id: session.id,
          turn_id: turn.id,
          started_at: num(turn.startedAt),
          completed_at: num(turn.completedAt),
          duration_ms: num(turn.durationMs),
          input_tokens: num(turn.inputTokens),
          output_tokens: num(turn.outputTokens),
          total_tokens: num(turn.totalTokens),
          cost_usd: costOf(session.model, { input: num(turn.inputTokens), output: num(turn.outputTokens) }),
          tool_calls: num(turn.toolCalls),
          last_message: turn.lastMessage.slice(0, 1000),
        })
      }

      // Full request/response JSON + complete event stream — one extra parse so the
      // index is the lossless record, not just previews. Failures here must not drop
      // the session's preview-level rows already inserted above.
      let records: ReturnType<typeof readObservabilityIndexRecords> = null
      try {
        records = readObservabilityIndexRecords(session.id)
      } catch {
        records = null
      }
      const payloadByCall = new Map((records?.toolPayloads || []).map((p) => [p.callId, p]))

      for (const tool of detail.toolCalls) {
        const full = payloadByCall.get(tool.callId)
        insertTool.run({
          session_id: session.id,
          call_id: tool.callId,
          turn_id: tool.turnId || '',
          line: num(tool.line),
          tool_name: tool.toolName,
          skill_name: tool.skillName || '',
          agent_role: tool.agentRole || '',
          started_at: num(tool.startedAt),
          completed_at: numOrNull(tool.completedAt),
          completed_line: numOrNull(tool.completedLine),
          status: tool.status,
          input_bytes: num(tool.argumentsBytes),
          output_bytes: num(tool.outputBytes),
          duration_ms: numOrNull(tool.durationMs),
          command_preview: (tool.commandPreview || tool.argumentsPreview || '').slice(0, 1000),
          command_text: full?.commandText || '',
          input_json: full?.inputText || '',
          output_json: full?.outputText || '',
          error_text: full?.errorText || '',
          truncated: full?.truncated ? 1 : 0,
        })
      }

      for (const event of records?.events || []) {
        insertEvent.run({
          session_id: session.id,
          seq: num(event.seq),
          line: num(event.line),
          timestamp: num(event.timestamp),
          kind: event.kind,
          severity: event.severity,
          turn_id: event.turnId || '',
          call_id: event.callId || '',
          tool_name: event.toolName || '',
          role: event.role || '',
          bytes: num(event.bytes),
          text: event.text || '',
        })
      }
    }
  })

  ingest()

  return { ...observabilityIndexStatus(), durationMs: Date.now() - started, indexedSessions: snapshot.sessions.length }
}

export function observabilityIndexStatus(): ObservabilityIndexStatus {
  const available = sqliteAvailable()
  const exists = available && indexBuilt()
  if (!available || !exists) {
    return { ok: available, dbPath: DB_PATH, exists, sqliteAvailable: available, indexedAt: null, sessions: 0, turns: 0, toolCalls: 0, tokenSnapshots: 0, events: 0, error: available ? undefined : dbError || 'better-sqlite3 is not available' }
  }
  try {
    const meta = queryJson<{ value: string }>("SELECT value FROM meta WHERE key = 'indexed_at' LIMIT 1")
    const rows = queryJson<{ sessions: number; turns: number; toolCalls: number; tokenSnapshots: number }>(`
      SELECT
        (SELECT COUNT(*) FROM sessions) AS sessions,
        (SELECT COUNT(*) FROM turns) AS turns,
        (SELECT COUNT(*) FROM tool_calls) AS toolCalls,
        (SELECT COUNT(*) FROM token_snapshots) AS tokenSnapshots
    `)[0]
    // `events` is newer than the rest of the schema — an index built before it
    // existed still answers the counts above, so tolerate the missing table.
    let eventCount = 0
    try {
      eventCount = Number(queryJson<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0]?.n || 0)
    } catch {
      eventCount = 0
    }
    return {
      ok: true,
      dbPath: DB_PATH,
      exists,
      sqliteAvailable: available,
      indexedAt: meta[0]?.value ? Number(meta[0].value) : statSync(DB_PATH).mtimeMs,
      sessions: Number(rows?.sessions || 0),
      turns: Number(rows?.turns || 0),
      toolCalls: Number(rows?.toolCalls || 0),
      tokenSnapshots: Number(rows?.tokenSnapshots || 0),
      events: eventCount,
    }
  } catch (e) {
    return { ok: false, dbPath: DB_PATH, exists, sqliteAvailable: available, indexedAt: null, sessions: 0, turns: 0, toolCalls: 0, tokenSnapshots: 0, events: 0, error: (e as Error).message }
  }
}

function indexedAt(): number | null {
  return observabilityIndexStatus().indexedAt
}

function auditRows(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const lowYield = queryJson(`
    SELECT session_id, repo, model, input_tokens, output_tokens, cost_usd,
      ROUND(CAST(output_tokens AS REAL) / NULLIF(input_tokens, 0), 4) AS output_per_input
    FROM sessions
    WHERE input_tokens >= 50000 AND output_tokens < input_tokens * 0.04
    ORDER BY input_tokens DESC
    LIMIT 6
  `)
  for (const row of lowYield) {
    rows.push({
      severity: 'high',
      scope: `session:${String(row.session_id).slice(0, 8)}`,
      title: 'High input with low output',
      metric: `${row.input_tokens} in / ${row.output_tokens} out`,
      recommendation: 'Use narrower log/file reads, summarize prior turns, and avoid replaying broad context into the next prompt.',
    })
  }

  const toolBloat = queryJson(`
    SELECT tool_name, COUNT(*) AS calls, SUM(output_bytes) AS total_output_bytes, MAX(output_bytes) AS max_output_bytes
    FROM tool_calls
    GROUP BY tool_name
    HAVING total_output_bytes >= 500000 OR max_output_bytes >= 100000
    ORDER BY total_output_bytes DESC
    LIMIT 6
  `)
  for (const row of toolBloat) {
    rows.push({
      severity: 'medium',
      scope: `tool:${row.tool_name}`,
      title: 'Large tool output captured',
      metric: `${row.calls} calls / ${row.total_output_bytes} bytes`,
      recommendation: 'Prefer deterministic filtered commands such as rg, --stat, --name-only, head/tail, or JSON field selection before handing output to the model.',
    })
  }

  const quietExpensive = queryJson(`
    SELECT session_id, repo, model, total_tokens, tool_total
    FROM sessions
    WHERE total_tokens >= 100000 AND tool_total = 0
    ORDER BY total_tokens DESC
    LIMIT 4
  `)
  for (const row of quietExpensive) {
    rows.push({
      severity: 'medium',
      scope: `session:${String(row.session_id).slice(0, 8)}`,
      title: 'Large session without tool progress',
      metric: `${row.total_tokens} tokens / 0 tools`,
      recommendation: 'Check whether the session is spending tokens on discussion instead of deterministic inspection or implementation steps.',
    })
  }

  const turnHotspots = queryJson(`
    SELECT turns.session_id, turns.turn_id, sessions.repo, turns.input_tokens, turns.output_tokens, turns.total_tokens
    FROM turns JOIN sessions USING (session_id)
    WHERE turns.input_tokens >= 25000 AND turns.output_tokens < 1000
    ORDER BY turns.input_tokens DESC
    LIMIT 4
  `)
  for (const row of turnHotspots) {
    rows.push({
      severity: 'medium',
      scope: `${String(row.session_id).slice(0, 8)}:${row.turn_id}`,
      title: 'Turn-level low yield',
      metric: `${row.input_tokens} in / ${row.output_tokens} out`,
      recommendation: 'Before the next turn, compact the task state and replace raw history with specific file refs or command outputs.',
    })
  }

  const errorProne = queryJson(`
    SELECT tool_name, COUNT(*) AS calls,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM tool_calls
    GROUP BY tool_name
    HAVING errors >= 3 AND errors * 1.0 / calls >= 0.25
    ORDER BY errors DESC
    LIMIT 4
  `)
  for (const row of errorProne) {
    rows.push({
      severity: 'high',
      scope: `tool:${row.tool_name}`,
      title: 'High tool error rate',
      metric: `${row.errors}/${row.calls} calls failed`,
      recommendation: 'Inspect the failing calls (Tool call errors query) — recurring failures usually mean a malformed argument shape or a missing precondition.',
    })
  }

  if (rows.length === 0) {
    rows.push({
      severity: 'info',
      scope: 'index',
      title: 'No major token-efficiency issues found',
      metric: 'current thresholds clear',
      recommendation: 'Keep using bounded log reads and rerun the index after larger agent sessions.',
    })
  }
  return rows.slice(0, 20)
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

export function queryObservabilityIndex(query: ObservabilityIndexQueryId, arg?: string): ObservabilityIndexQueryResult {
  const meta = QUERY_META[query]
  if (!sqliteAvailable()) return { query, ...meta, rows: [], indexedAt: null, dbPath: DB_PATH, error: dbError || 'better-sqlite3 is not available' }
  if (!indexBuilt()) return { query, ...meta, rows: [], indexedAt: null, dbPath: DB_PATH, error: 'Index has not been built yet.' }
  if (query === 'session_events' && !arg) {
    return { query, ...meta, rows: [], indexedAt: indexedAt(), dbPath: DB_PATH, needsArg: 'session_id' }
  }
  try {
    const rows =
      query === 'audit' ? auditRows()
      : query === 'sessions_by_tokens' ? queryJson(`
          SELECT session_id, engine, repo, model, total_tokens, input_tokens, output_tokens, ROUND(cost_usd, 4) AS cost_usd, tool_total
          FROM sessions ORDER BY total_tokens DESC LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'low_yield_sessions' ? queryJson(`
          SELECT session_id, repo, model, input_tokens, output_tokens,
            ROUND(CAST(output_tokens AS REAL) / NULLIF(input_tokens, 0), 4) AS output_per_input,
            ROUND(cost_usd, 4) AS cost_usd
          FROM sessions
          WHERE input_tokens > 0
          ORDER BY output_per_input ASC, input_tokens DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'tool_calls' ? queryJson(`
          SELECT tool_calls.session_id, tool_calls.call_id, sessions.repo, sessions.model, tool_calls.turn_id, tool_calls.line,
            tool_calls.tool_name, tool_calls.skill_name, tool_calls.status,
            COALESCE(turns.input_tokens, 0) AS turn_input_tokens,
            COALESCE(turns.output_tokens, 0) AS turn_output_tokens,
            COALESCE(turns.total_tokens, 0) AS turn_total_tokens,
            tool_calls.input_bytes,
            tool_calls.output_bytes, ROUND(tool_calls.duration_ms, 1) AS duration_ms,
            tool_calls.command_preview
          FROM tool_calls
          JOIN sessions USING (session_id)
          LEFT JOIN turns ON turns.session_id = tool_calls.session_id AND turns.turn_id = tool_calls.turn_id
          ORDER BY turn_total_tokens DESC, tool_calls.input_bytes + tool_calls.output_bytes DESC, tool_calls.output_bytes DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'tool_payloads' ? queryJson(`
          SELECT tool_calls.session_id, tool_calls.call_id, sessions.repo, tool_calls.tool_name, tool_calls.status,
            tool_calls.input_bytes, tool_calls.output_bytes, ROUND(tool_calls.duration_ms, 1) AS duration_ms,
            tool_calls.truncated, tool_calls.input_json, tool_calls.output_json
          FROM tool_calls
          JOIN sessions USING (session_id)
          ORDER BY tool_calls.input_bytes + tool_calls.output_bytes DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'tool_errors' ? queryJson(`
          SELECT tool_calls.session_id, tool_calls.call_id, sessions.repo, tool_calls.tool_name, tool_calls.turn_id,
            tool_calls.line, tool_calls.output_bytes, ROUND(tool_calls.duration_ms, 1) AS duration_ms,
            tool_calls.command_text, tool_calls.error_text
          FROM tool_calls
          JOIN sessions USING (session_id)
          WHERE tool_calls.status = 'error'
          ORDER BY tool_calls.completed_at DESC, tool_calls.started_at DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'tool_call_bloat' ? queryJson(`
          SELECT tool_name, COUNT(*) AS calls, SUM(output_bytes) AS total_output_bytes,
            ROUND(AVG(output_bytes), 1) AS avg_output_bytes, MAX(output_bytes) AS max_output_bytes,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_calls,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_calls
          FROM tool_calls
          GROUP BY tool_name
          ORDER BY total_output_bytes DESC, calls DESC
        `)
      : query === 'turn_hotspots' ? queryJson(`
          SELECT turns.session_id, turns.turn_id, sessions.repo, sessions.model, turns.total_tokens, turns.input_tokens, turns.output_tokens, turns.tool_calls
          FROM turns JOIN sessions USING (session_id)
          ORDER BY turns.total_tokens DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'costliest_turns' ? queryJson(`
          SELECT turns.session_id, turns.turn_id, sessions.repo, sessions.model, ROUND(turns.cost_usd, 4) AS cost_usd,
            turns.total_tokens, turns.input_tokens, turns.output_tokens, turns.tool_calls, ROUND(turns.duration_ms, 0) AS duration_ms
          FROM turns JOIN sessions USING (session_id)
          ORDER BY turns.cost_usd DESC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : query === 'model_rollup' ? queryJson(`
          SELECT model, COUNT(*) AS sessions, SUM(total_tokens) AS total_tokens, SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens, ROUND(SUM(cost_usd), 4) AS cost_usd
          FROM sessions GROUP BY model ORDER BY total_tokens DESC
        `)
      : query === 'repo_rollup' ? queryJson(`
          SELECT repo, COUNT(*) AS sessions, SUM(total_tokens) AS total_tokens, SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens, ROUND(SUM(cost_usd), 4) AS cost_usd, SUM(tool_total) AS tool_calls
          FROM sessions GROUP BY repo ORDER BY total_tokens DESC
        `)
      : query === 'session_events' ? queryJson(`
          SELECT seq, line, kind, severity, turn_id, tool_name, role, bytes, SUBSTR(text, 1, 12000) AS text
          FROM events
          WHERE session_id = '${escapeSqlLiteral(arg || '')}'
          ORDER BY seq ASC
          LIMIT ${ROW_QUERY_CAP}
        `)
      : []
    return { query, ...meta, rows, indexedAt: indexedAt(), dbPath: DB_PATH }
  } catch (e) {
    return { query, ...meta, rows: [], indexedAt: indexedAt(), dbPath: DB_PATH, error: (e as Error).message }
  }
}
