// Collectors — observe every AI execution surface and feed the ai-runs/ ledger.
// Wraps the existing transcript parsers and the cron/agent runner output paths.
//
// Four sources:
//   claude-code  → reads ~/.claude/projects/<hash>/<sid>.jsonl
//   codex-cli    → reads ~/.codex/sessions/<sid>/messages.jsonl (best effort)
//   claude-p     → parses the usage summary line from `claude -p` stdout
//   codex-exec   → parses the usage summary line from `codex exec` stdout

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { writeAIRun, makeAIRun, type AIRun, type AIRunSource } from './ai-runs'

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects')
const CODEX_SESSIONS = join(homedir(), '.codex', 'sessions')
const COLLECTOR_STATE_FILE = join(
  homedir(),
  '.config',
  'TerMinal',
  'ai-runs',
  'collector-state.json',
)

// ---------------------------------------------------------------------------
// Incremental collection state.
//
// The transcript archives these collectors walk reach into the GB range, and
// the loop re-runs every 5 minutes — re-reading everything froze the main
// process for tens of seconds per tick. Persist (size, mtimeMs) per file and
// skip any file that hasn't changed since its last collection; only files
// that actually grew are re-read. State survives restarts so app boot pays
// only for what changed while the app was closed.
// ---------------------------------------------------------------------------

type CollectorFileState = { size: number; mtimeMs: number }
type CollectorState = Record<string, CollectorFileState>

async function loadCollectorState(file: string): Promise<CollectorState> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as CollectorState) : {}
  } catch {
    return {}
  }
}

async function saveCollectorState(file: string, state: CollectorState): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(state))
  } catch {
    /* best effort — worst case the next run re-reads */
  }
}

export type CollectorOptions = {
  /** Transcript root override (tests). */
  root?: string
  /** Incremental-state file override (tests). */
  stateFile?: string
  /** Run sink override (tests). */
  writeRun?: (run: AIRun) => void
}

export type CollectorResult = { written: number; skipped: number }

// ---------------------------------------------------------------------------
// Claude transcripts → AIRuns
//
// Each ~/.claude/projects/<hash>/<sid>.jsonl gets summarized into ONE AIRun
// record per session id. We sum usage across turns to get totals, then
// stamp the cwd + model + duration. Idempotent: we use the sessionId as the
// AIRun id so re-running just overwrites with the latest totals.
// ---------------------------------------------------------------------------

type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type ClaudeSessionSummary = {
  sessionId: string
  cwd: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: number
  endedAt: number
  turns: number
}

async function parseClaudeSession(
  file: string,
  sessionId: string,
): Promise<ClaudeSessionSummary | null> {
  let cwd = ''
  let model = ''
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let startedAt = 0
  let endedAt = 0
  let turns = 0
  let raw = ''
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
    const ts = typeof obj.timestamp === 'number' ? obj.timestamp : Date.parse(obj.timestamp || '')
    if (!Number.isNaN(ts) && ts > 0) {
      if (!startedAt) startedAt = ts
      endedAt = ts
    }
    const msg = obj.message
    if (!msg || msg.role !== 'assistant') continue
    const u: ClaudeUsage | undefined = msg.usage
    if (!u) continue
    turns++
    if (typeof msg.model === 'string') model = msg.model
    input += u.input_tokens || 0
    output += u.output_tokens || 0
    cacheRead += u.cache_read_input_tokens || 0
    cacheWrite += u.cache_creation_input_tokens || 0
  }
  if (turns === 0) return null
  return {
    sessionId,
    cwd,
    model: model || 'unknown',
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    startedAt: startedAt || Date.now(),
    endedAt: endedAt || Date.now(),
    turns,
  }
}

/** Walk the Claude projects dir and persist an AIRun per session.
 *  Idempotent: AIRun.id = `claude-${sessionId}` so re-runs overwrite the
 *  same record with fresh totals as the transcript grows. Incremental:
 *  files whose (size, mtime) match the persisted state are never re-read. */
export async function collectClaudeSessions(
  maxAgeMs = 30 * 86_400_000,
  opts: CollectorOptions = {},
): Promise<CollectorResult> {
  const rootDir = opts.root ?? CLAUDE_PROJECTS
  const stateFile = opts.stateFile ?? COLLECTOR_STATE_FILE
  const writeRun = opts.writeRun ?? writeAIRun
  if (!existsSync(rootDir)) return { written: 0, skipped: 0 }
  const state = await loadCollectorState(stateFile)
  let written = 0
  let skipped = 0
  const cutoff = Date.now() - maxAgeMs
  let dirs: string[] = []
  try {
    dirs = await readdir(rootDir)
  } catch {
    return { written: 0, skipped: 0 }
  }
  for (const dir of dirs) {
    const p = join(rootDir, dir)
    let files: string[] = []
    try {
      files = await readdir(p)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const file = join(p, f)
      let st: { size: number; mtimeMs: number }
      try {
        st = await stat(file)
      } catch {
        continue
      }
      if (st.mtimeMs < cutoff) continue // ancient — don't bother
      const prev = state[file]
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
        skipped++
        continue
      }
      const sessionId = f.replace(/\.jsonl$/, '')
      const summary = await parseClaudeSession(file, sessionId)
      // Remember no-usage files too — they'd otherwise be re-read every tick.
      state[file] = { size: st.size, mtimeMs: st.mtimeMs }
      if (!summary) continue
      const run = makeAIRun({
        source: 'claude-code',
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        model: summary.model,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheReadTokens: summary.cacheReadTokens,
        cacheWriteTokens: summary.cacheWriteTokens,
        repoRoot: summary.cwd,
        sessionId,
        durationMs: summary.endedAt - summary.startedAt,
      })
      // Override id with deterministic key for idempotent overwrite
      run.id = `claude-${sessionId}`
      writeRun(run)
      written++
    }
  }
  await saveCollectorState(stateFile, state)
  return { written, skipped }
}

// ---------------------------------------------------------------------------
// Codex transcripts → AIRuns
// Best effort — codex's session format may vary by version. We look for
// per-message `usage` fields like Claude's; absent that, skip.
// ---------------------------------------------------------------------------

/** Recursively find .jsonl files under `dir`. Codex nests sessions by date
 *  (`YYYY/MM/DD/rollout-*.jsonl`) — the old one-level scan found nothing. */
async function walkCodexJsonl(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const path = join(dir, name)
    let st
    try {
      st = await stat(path)
    } catch {
      continue
    }
    if (st.isDirectory()) await walkCodexJsonl(path, depth - 1, out)
    else if (name.endsWith('.jsonl')) out.push(path)
  }
}

export async function collectCodexSessions(
  maxAgeMs = 30 * 86_400_000,
  opts: CollectorOptions = {},
): Promise<CollectorResult> {
  const rootDir = opts.root ?? CODEX_SESSIONS
  const stateFile = opts.stateFile ?? COLLECTOR_STATE_FILE
  const writeRun = opts.writeRun ?? writeAIRun
  if (!existsSync(rootDir)) return { written: 0, skipped: 0 }
  const state = await loadCollectorState(stateFile)
  let written = 0
  let skipped = 0
  const cutoff = Date.now() - maxAgeMs
  const files: string[] = []
  await walkCodexJsonl(rootDir, 6, files)
  for (const file of files) {
    let st: { size: number; mtimeMs: number }
    try {
      st = await stat(file)
    } catch {
      continue
    }
    const mtime = st.mtimeMs
    if (mtime < cutoff) continue
    const prev = state[file]
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
      skipped++
      continue
    }
    // Session id: the file's own name, except for generic names where the
    // parent directory is the session id (old `<sid>/messages.jsonl` layout).
    const base = basename(file, '.jsonl')
    const sid = base === 'messages' || base === 'transcript' ? basename(dirname(file)) : base
    let input = 0
    let output = 0
    let model = ''
    let cwd = ''
    let startedAt = 0
    let endedAt = mtime
    let turns = 0
    let raw = ''
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let obj: any
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
      if (typeof obj.model === 'string') model = obj.model
      const ts = typeof obj.timestamp === 'number' ? obj.timestamp : Date.parse(obj.timestamp || '')
      if (!Number.isNaN(ts) && ts > 0) {
        if (!startedAt) startedAt = ts
        endedAt = ts
      }
      const u = obj.usage || obj.message?.usage
      if (u) {
        turns++
        input += u.input_tokens || u.prompt_tokens || 0
        output += u.output_tokens || u.completion_tokens || 0
      }
    }
    state[file] = { size: st.size, mtimeMs: st.mtimeMs }
    if (turns === 0) continue
    const run = makeAIRun({
      source: 'codex-cli',
      startedAt: startedAt || endedAt,
      endedAt,
      model: model || 'gpt-5',
      inputTokens: input,
      outputTokens: output,
      repoRoot: cwd,
      sessionId: sid,
      durationMs: endedAt - (startedAt || endedAt),
    })
    run.id = `codex-${sid}`
    writeRun(run)
    written++
  }
  await saveCollectorState(stateFile, state)
  return { written, skipped }
}

// ---------------------------------------------------------------------------
// claude -p / codex exec stdout parsers — used by the in-process and cron
// runners when they capture child output.
// ---------------------------------------------------------------------------

type UsageHit = {
  model?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Parse the usage summary line emitted by `claude -p` at exit. Format varies
 *  by claude CLI version; we look for "Total tokens: X input + Y output" and
 *  optional "(Z cached)" and "Model: claude-...". */
export function parseClaudeUsageFromOutput(out: string): UsageHit | null {
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead = 0
  let model: string | undefined
  // Walk lines from the end — usage summary lives near the tail
  const lines = out.split('\n').slice(-200)
  for (const raw of lines) {
    const line = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // strip ANSI
    let m: RegExpMatchArray | null
    if ((m = line.match(/(?:input|prompt)\s*tokens?[:\s]+(\d[\d,]*)/i)) && inputTokens === 0) {
      inputTokens = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if (
      (m = line.match(/(?:output|completion)\s*tokens?[:\s]+(\d[\d,]*)/i)) &&
      outputTokens === 0
    ) {
      outputTokens = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if ((m = line.match(/cache(?:d|\s*read)?[:\s]+(\d[\d,]*)/i)) && cacheRead === 0) {
      cacheRead = parseInt(m[1].replace(/,/g, ''), 10)
    }
    if (!model && (m = line.match(/model[:\s]+([\w\-\.]+)/i))) {
      model = m[1]
    }
  }
  if (inputTokens === 0 && outputTokens === 0) return null
  return { inputTokens, outputTokens, cacheReadTokens: cacheRead || undefined, model }
}

/** codex exec uses a similar tail summary; same parser works in most cases. */
export const parseCodexUsageFromOutput = parseClaudeUsageFromOutput

/** Build + persist an AIRun for a wrapped `claude -p` / `codex exec` run that
 *  captured its child output. Returns null when no usage line found. */
export function recordRunnerInvocation(opts: {
  source: 'claude-p' | 'codex-exec'
  output: string
  repoRoot: string
  runId: string
  agentId?: string
  startedAt: number
  endedAt: number
  exitCode: number
  modelHint?: string
}): boolean {
  const parsed =
    opts.source === 'claude-p'
      ? parseClaudeUsageFromOutput(opts.output)
      : parseCodexUsageFromOutput(opts.output)
  if (!parsed) return false
  const run = makeAIRun({
    source: opts.source,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    model: parsed.model || opts.modelHint || (opts.source === 'claude-p' ? 'sonnet' : 'gpt-5'),
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    repoRoot: opts.repoRoot,
    runId: opts.runId,
    agentId: opts.agentId,
    durationMs: opts.endedAt - opts.startedAt,
    exitCode: opts.exitCode,
  })
  writeAIRun(run)
  return true
}

/** App-boot scan: pull every Claude/Codex session into the ledger, then
 *  schedule periodic re-scans so growing transcripts update their totals. */
export function startAICollectionLoop(): void {
  // Initial scan immediately so the Observability tab shows real data at
  // app start. Then poll every 5 min. Both are async and incremental —
  // only transcripts that changed since the last collection are re-read.
  const collect = async () => {
    try {
      await collectClaudeSessions()
      await collectCodexSessions()
    } catch {
      /* best effort */
    }
  }
  void collect()
  setInterval(() => void collect(), 5 * 60 * 1000)
}
