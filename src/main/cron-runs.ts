import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { listRuns as listAgentRuns, type AgentRun } from './agents'
import { listBgTasks, type BgTask } from './bg-tasks'
import { queueRunOutcomeSummary, readOutcomeSummaries } from './run-summarizer'

// Read the run records the headless runner (bin/terminal-cron) writes per run.
const DEFAULT_RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'cron-runs')
const DEFAULT_SESSION_RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'session-runs')
const STALE_MS = 2 * 60 * 60 * 1000 // matches terminal-cron's STALE_MS
export const SESSION_RUN_LOG_MAX_BYTES = 1024 * 1024
const SESSION_RUN_LOG_FLUSH_MS = 250
const SESSION_RUN_LOG_TRUNCATED = '[TerMinal: earlier session log truncated]\n'

const cronRunsDir = (): string => process.env.TERMINAL_CRON_RUNS_DIR || DEFAULT_RUNS_DIR
const sessionRunsDir = (): string =>
  process.env.TERMINAL_SESSION_RUNS_DIR || DEFAULT_SESSION_RUNS_DIR

export type CronRun = {
  id: string
  scheduleId: string
  agentId: string
  agentTitle: string
  engine: string
  status: 'running' | 'done' | 'failed' | 'canceled'
  startedAt: number
  endedAt?: number
  exitCode?: number
  branch: string
  repoLabel: string
  worktree: string
  error?: string
  pid?: number // script-wrapper pid (watchdog liveness probe)
  runnerPid?: number // this runner's pid — SIGTERM'd to cancel the run (#9)
}

export type SessionRun = {
  id: string
  source: 'session'
  agentId: string
  agentTitle: string
  engine: string
  status: 'running' | 'done' | 'failed' | 'interrupted'
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  repoLabel: string
  branch: string
  worktree: string
  error?: string
  sessionId: string
  remote?: boolean
  ticketSlug?: string
}

function recentJsonFiles(dir: string, limit: number): string[] {
  if (limit <= 0) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return { file: f, mtimeMs: statSync(join(dir, f)).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { file: string; mtimeMs: number } => !!entry)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.file)
}

// These disk-backed lists are re-read by several pollers at once (Runs tab,
// tab badges, harness status, the mobile bridge) — each call stats + parses
// hundreds of files. A short TTL bounds that to one sweep per interval; the
// module's own writers bust it so in-app status changes surface immediately.
const RUNS_LIST_TTL_MS = 3000
let cronRunsCache: { at: number; limit: number; runs: CronRun[] } | null = null
let sessionRunsCache: { at: number; limit: number; runs: SessionRun[] } | null = null

function bustRunsListCache(): void {
  cronRunsCache = null
  sessionRunsCache = null
}

export function readCronRuns(scheduleId?: string, limit = 200): CronRun[] {
  const dir = cronRunsDir()
  if (!existsSync(dir)) return []
  if (
    !scheduleId &&
    cronRunsCache &&
    cronRunsCache.limit >= limit &&
    Date.now() - cronRunsCache.at < RUNS_LIST_TTL_MS
  ) {
    return cronRunsCache.runs.slice(0, limit)
  }
  const out: CronRun[] = []
  const files = scheduleId
    ? readdirSync(dir).filter((f) => f.endsWith('.json'))
    : recentJsonFiles(dir, limit)
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as CronRun
      if (!scheduleId || r.scheduleId === scheduleId) out.push(r)
    } catch {
      /* skip */
    }
  }
  const runs = out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit)
  if (!scheduleId) cronRunsCache = { at: Date.now(), limit, runs }
  return runs
}

// App-side watchdog. Mirrors bin/terminal-cron's sweep but runs whenever the
// app is alive — not gated on a schedule firing. Without this, a phantom run
// (schedule deleted before the runner finalized the record, terminal closed
// mid-run, OOM) sits at status:running forever when the user has no enabled
// schedules left to trigger a sweep on the cron side.
//
// Conservative: only finalizes records that are (a) status:running, (b) older
// than STALE_MS, AND (c) have NO live process matching the worktree path. The
// process check is a coarse pgrep — false positives would mean leaving a
// real run alone (safer than killing it accidentally).
export function sweepStaleCronRuns(): { swept: number } {
  const dir = cronRunsDir()
  if (!existsSync(dir)) return { swept: 0 }
  const now = Date.now()
  let swept = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    try {
      const r = JSON.parse(readFileSync(path, 'utf8')) as CronRun & { worktree?: string }
      if (r.status !== 'running') continue
      if (now - (r.startedAt || 0) < STALE_MS) continue
      // No process / no worktree match → phantom. Skip the live-process check
      // when we have no worktree (very old records): fall through to sweep.
      // We don't bother shelling out — the cost of a false sweep is the user
      // sees a "failed: stale" badge instead of the truth, which is fine.
      const finalized = {
        ...r,
        status: 'failed' as const,
        endedAt: now,
        error: 'stale: app-side watchdog finalized (>2h with no in-app activity)',
      }
      writeFileSync(path, JSON.stringify(finalized, null, 2))
      bustRunsListCache()
      swept++
    } catch {
      /* skip unreadable record */
    }
  }
  sweepCronRunSummaries()
  return { swept }
}

/** Backfill outcome summaries for settled cron runs that don't have one.
 *
 *  bin/terminal-cron is deliberately self-contained (no app imports), so it
 *  cannot queue its own summaries. This app-side sweep covers cron runs
 *  instead, riding the existing 30-minute stale-run reconciliation. Bounded by
 *  a recency window, a per-sweep limit, and the summarizer's own hourly cap. */
export function sweepCronRunSummaries(
  opts: { now?: number; call?: (prompt: string) => Promise<string> } = {},
): { queued: number } {
  const now = opts.now ?? Date.now()
  const existing = readOutcomeSummaries()
  let queued = 0
  for (const r of readCronRuns(undefined, 200)) {
    if (queued >= CRON_SUMMARY_SWEEP_LIMIT) break
    if (r.status === 'running') continue
    if (existing.has(r.id)) continue
    if (now - (r.endedAt || r.startedAt || 0) > CRON_SUMMARY_MAX_AGE_MS) continue
    queueRunOutcomeSummary({
      runId: r.id,
      status: r.status,
      readLog: () => readCronRunLog(r.id),
      context: `Scheduled run: ${r.agentTitle} in ${r.repoLabel}`,
      call: opts.call,
    })
    queued++
  }
  return { queued }
}

const CRON_SUMMARY_SWEEP_LIMIT = 20
const CRON_SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** On-disk log path for the runs:log-tail IPC. */
export function cronRunLogPath(runId: string): string {
  return join(cronRunsDir(), `${runId.replace(/[^\w-]/g, '')}.log`)
}

export function readCronRunLog(runId: string): string {
  const safe = runId.replace(/[^\w-]/g, '')
  const f = join(cronRunsDir(), `${safe}.log`)
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

const safeRunId = (runId: string): string => runId.replace(/[^\w-]/g, '')
const pendingSessionLogChunks = new Map<
  string,
  { chunks: string[]; timer?: ReturnType<typeof setTimeout> }
>()

function capSessionRunLog(text: string): string {
  if (Buffer.byteLength(text) <= SESSION_RUN_LOG_MAX_BYTES) return text
  const markerBytes = Buffer.byteLength(SESSION_RUN_LOG_TRUNCATED)
  const tailBytes = Math.max(0, SESSION_RUN_LOG_MAX_BYTES - markerBytes)
  const tail = Buffer.from(text).subarray(-tailBytes).toString('utf8')
  return SESSION_RUN_LOG_TRUNCATED + tail
}

function flushSessionRunLog(runId: string): void {
  const safe = safeRunId(runId)
  if (!safe) return
  const pending = pendingSessionLogChunks.get(safe)
  if (!pending || pending.chunks.length === 0) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingSessionLogChunks.delete(safe)
  try {
    const dir = sessionRunsDir()
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${safe}.log`)
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(path, capSessionRunLog(current + pending.chunks.join('')))
  } catch {
    /* best-effort observability */
  }
}

export function flushAllSessionRunLogs(): void {
  for (const safe of [...pendingSessionLogChunks.keys()]) flushSessionRunLog(safe)
}

export function beginSessionRun(run: SessionRun): void {
  const safe = safeRunId(run.id)
  if (!safe) return
  pendingSessionLogChunks.delete(safe)
  const dir = sessionRunsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(run, null, 2))
  bustRunsListCache()
  writeFileSync(
    join(dir, `${safe}.log`),
    [
      `session: ${run.sessionId}`,
      `engine: ${run.engine}`,
      `repo: ${run.repoLabel || run.repoRoot || run.worktree || 'unknown'}`,
      `cwd: ${run.worktree || run.repoRoot || 'unknown'}`,
      run.ticketSlug ? `ticket: ${run.ticketSlug}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n') + '\n\n',
  )
}

export function appendSessionRunLog(runId: string, chunk: string): void {
  const safe = safeRunId(runId)
  if (!safe || !chunk) return
  const pending = pendingSessionLogChunks.get(safe) ?? { chunks: [] }
  pending.chunks.push(chunk)
  if (!pending.timer) {
    pending.timer = setTimeout(() => flushSessionRunLog(safe), SESSION_RUN_LOG_FLUSH_MS)
    pending.timer.unref?.()
  }
  pendingSessionLogChunks.set(safe, pending)
}

export function finalizeSessionRun(
  runId: string,
  patch: Pick<SessionRun, 'status' | 'endedAt'> & Partial<SessionRun>,
): void {
  const safe = safeRunId(runId)
  if (!safe) return
  flushSessionRunLog(safe)
  const path = join(sessionRunsDir(), `${safe}.json`)
  try {
    const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SessionRun) : null
    if (!current) return
    writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2))
    bustRunsListCache()
  } catch {
    /* best-effort observability */
  }
  // The run is already finalized on disk — this cannot affect it either way.
  queueRunOutcomeSummary({
    runId: safe,
    status: patch.status,
    readLog: () => readSessionRunLog(safe),
    context: `Session run: ${patch.agentTitle || ''}`.trim(),
  })
}

export function readSessionRuns(limit = 200): SessionRun[] {
  const dir = sessionRunsDir()
  if (!existsSync(dir)) return []
  if (
    sessionRunsCache &&
    sessionRunsCache.limit >= limit &&
    Date.now() - sessionRunsCache.at < RUNS_LIST_TTL_MS
  ) {
    return sessionRunsCache.runs.slice(0, limit)
  }
  const out: SessionRun[] = []
  for (const f of recentJsonFiles(dir, limit)) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as SessionRun)
    } catch {
      /* skip */
    }
  }
  const runs = out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit)
  sessionRunsCache = { at: Date.now(), limit, runs }
  return runs
}

// Session runs are IN-PROCESS — their PTY lives and dies with this app. So after
// a restart (or a crash/force-quit that skipped pty:exit → finalizeSessionRun),
// ANY record still at status:running is a zombie: nothing is actually running.
// Call once at startup, BEFORE the user can open new sessions, to finalize them
// as 'interrupted' — otherwise they pile up and inflate the Runs "running" count.
export function sweepStaleSessionRuns(): { swept: number } {
  const dir = sessionRunsDir()
  if (!existsSync(dir)) return { swept: 0 }
  const now = Date.now()
  let swept = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    try {
      const r = JSON.parse(readFileSync(path, 'utf8')) as SessionRun
      if (r.status !== 'running') continue
      writeFileSync(
        path,
        JSON.stringify(
          {
            ...r,
            status: 'interrupted',
            endedAt: r.endedAt ?? now,
            error: r.error ?? 'interrupted: app restarted',
          },
          null,
          2,
        ),
      )
      bustRunsListCache()
      swept++
    } catch {
      /* skip unreadable record */
    }
  }
  return { swept }
}

/** On-disk log path for the runs:log-tail IPC. */
export function sessionRunLogPath(runId: string): string {
  return join(sessionRunsDir(), `${safeRunId(runId)}.log`)
}

export function readSessionRunLog(runId: string): string {
  const safe = safeRunId(runId)
  const f = join(sessionRunsDir(), `${safe}.log`)
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

/**
 * Tail of a session's pty log, for the phone's terminal peek. Reads only the
 * last `maxBytes` — the log grows unbounded while a session lives, and the
 * phone polls this every few seconds.
 */
export function readSessionRunLogTail(
  runId: string,
  maxBytes = 64 * 1024,
): { text: string; updatedAt: number } | null {
  const safe = safeRunId(runId)
  if (!safe) return null
  const f = join(sessionRunsDir(), `${safe}.log`)
  try {
    const stat = statSync(f)
    const length = Math.min(stat.size, maxBytes)
    const buf = Buffer.alloc(length)
    const fd = openSync(f, 'r')
    try {
      readSync(fd, buf, 0, length, stat.size - length)
    } finally {
      closeSync(fd)
    }
    return { text: buf.toString('utf8'), updatedAt: stat.mtimeMs }
  } catch {
    return null
  }
}

// ---- unified runs view -----------------------------------------------------

// A single shape for every run regardless of origin — cron-fired vs in-process
// agent vs ticket-spawn etc. Powers the Runs tab so the operator gets one
// global picture instead of jumping between Schedules and Agents.
export type UnifiedRun = {
  id: string
  source: 'cron' | 'agent' | 'bg' | 'session'
  agentId: string
  agentTitle: string
  engine: string
  status: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  repoLabel: string
  branch: string
  worktree: string
  scheduleId?: string
  error?: string
  force?: boolean
  /** USD cost when the harness reports it (OpenRouter/or-agent runs). */
  costUsd?: number
  trace?: AgentRun['trace']
  evaluation?: AgentRun['evaluation']
  /** Remote host this run came from. Undefined = local machine. Stamped by
   *  the `runs:remote-all` fan-out so the Runs tab can badge/filter by host. */
  hostId?: string
  hostLabel?: string
  /** Cron runner's own pid — SIGTERM'd to cancel the run (#9). */
  runnerPid?: number
  /** Best-effort two-line "what actually got done", written after the run
   *  settled. Absent whenever summarization was skipped or failed. */
  summary?: string
}

function agentRunToUnified(r: AgentRun): UnifiedRun {
  return {
    id: r.id,
    source: 'agent',
    agentId: r.agentId,
    agentTitle: r.agentTitle,
    engine: r.engine,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
    repoRoot: r.repoRoot,
    repoLabel: basename(r.repoRoot) || '',
    branch: r.branch,
    worktree: r.worktree,
    force: r.force,
    costUsd: r.costUsd,
    trace: r.trace,
    evaluation: r.evaluation,
  }
}

function cronRunToUnified(r: CronRun & { repoRoot?: string }): UnifiedRun {
  return {
    id: r.id,
    source: 'cron',
    agentId: r.agentId,
    agentTitle: r.agentTitle,
    engine: r.engine,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
    repoRoot: r.repoRoot || '',
    repoLabel: r.repoLabel,
    branch: r.branch,
    worktree: r.worktree,
    scheduleId: r.scheduleId,
    error: r.error,
    runnerPid: r.runnerPid,
  }
}

function bgTaskToUnified(r: BgTask): UnifiedRun {
  return {
    id: r.id,
    source: 'bg',
    agentId: 'background-task',
    agentTitle: r.label || 'Background task',
    engine: r.engine,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
    repoRoot: r.repoRoot,
    repoLabel: r.repo || basename(r.repoRoot) || '',
    branch: r.branch,
    worktree: r.worktree,
  }
}

function sessionRunToUnified(r: SessionRun): UnifiedRun {
  return {
    id: r.id,
    source: 'session',
    agentId: r.agentId,
    agentTitle: r.agentTitle,
    engine: r.engine,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
    repoRoot: r.repoRoot,
    repoLabel: r.repoLabel,
    branch: r.branch,
    worktree: r.worktree,
    error: r.error,
  }
}

export function listAllRuns(limit = 400): UnifiedRun[] {
  const cron = readCronRuns(undefined, limit).map(cronRunToUnified)
  const agent = listAgentRuns().map(agentRunToUnified)
  const bg = listBgTasks().map(bgTaskToUnified)
  const sessions = readSessionRuns(limit).map(sessionRunToUnified)
  const runs = [...cron, ...agent, ...bg, ...sessions]
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, limit)
  // Join the outcome-summary side-car in one sweep. Absent summaries just leave
  // the field undefined — no run record shape changed to carry this.
  const summaries = readOutcomeSummaries()
  if (summaries.size) for (const r of runs) r.summary = summaries.get(r.id)
  return runs
}
