import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { repoForCwd } from './repo'
import { reviewForPrDir, newestPrDirForRepo } from './review'

// ---------------------------------------------------------------------------
// Claude Code transcript reader
//
// Claude Code writes one JSONL transcript per session at
//   ~/.claude/projects/<cwd-hash>/<session-id>.jsonl
// The filename is the session id; message lines carry usage, cwd, gitBranch.
//
// Gauntlet Terminal attaches to ONE session for the life of the window — every
// reader here is keyed by session id, so context %, cost, etc. all describe
// that single session, never an aggregate.
// ---------------------------------------------------------------------------

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

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
  mtime: number
  ts: number
}

export type SessionMeta = {
  id: string
  cwd: string
  gitBranch: string
  model: string
  turns: number
  firstUserText: string
  mtime: number
}

// opus 4.x blended estimate ($/token). Cache reads are ~10% of input price.
const PRICE = { input: 15 / 1e6, output: 75 / 1e6, cacheRead: 1.5 / 1e6 }

// Context window per model. Opus 4.6/4.7 and Sonnet 4.5+ run the 1M window;
// everything else (older Opus, Haiku, Claude 3.x) defaults to 200k.
function modelContextWindow(model: string): number {
  const m = model.toLowerCase()
  if (/\[1m\]|-1m\b/.test(m)) return 1_000_000
  if (/opus-4-[67]/.test(m)) return 1_000_000
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

/** Locate a session's transcript file by id, across all project dirs. */
export function findSessionFile(sessionId: string): string | null {
  if (!sessionId || !existsSync(PROJECTS_DIR)) return null
  for (const project of readdirSync(PROJECTS_DIR)) {
    const p = join(PROJECTS_DIR, project, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
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
    if (u) {
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
        if (block?.type === 'tool_use')
          lastAction = { tool: block.name, detail: summarizeToolInput(block.name, block.input) }
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
    mtime,
    ts: Date.now(),
  }
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
  const stats = parseTranscriptFile(file, sessionId)
  tCache = { id: sessionId, mtime, stats }
  return stats
}

/** All sessions across all projects, newest first — for the entry picker. */
export function listSessions(): SessionMeta[] {
  if (!existsSync(PROJECTS_DIR)) return []
  const out: SessionMeta[] = []
  for (const project of readdirSync(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, project)
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const id = f.replace(/\.jsonl$/, '')
      const s = parseTranscriptFile(join(dir, f), id)
      if (!s.ok) continue // skip empty / never-used sessions
      out.push({
        id,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        model: s.model,
        turns: s.turns,
        firstUserText: s.firstUserText,
        mtime: s.mtime,
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
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
  const dir = newestPrDirForRepo(repo.host, repo.path)
  if (!dir) return base
  const r = reviewForPrDir(dir)
  if (!r) return base
  return { ...base, ok: true, ...r }
}
