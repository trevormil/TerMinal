import { appendFileSync, readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { listRuns as listAgentRuns, type AgentRun } from './agents'
import { listBgTasks, type BgTask } from './bg-tasks'
import { bucketRunTrends, type RunTrendPoint } from './run-trends'

// Read the run records the headless runner (bin/terminal-cron) writes per run.
const RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'cron-runs')
const SESSION_RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'session-runs')
const STALE_MS = 2 * 60 * 60 * 1000 // matches terminal-cron's STALE_MS

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

export function readCronRuns(scheduleId?: string, limit = 200): CronRun[] {
  if (!existsSync(RUNS_DIR)) return []
  const out: CronRun[] = []
  for (const f of readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      const r = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8')) as CronRun
      if (!scheduleId || r.scheduleId === scheduleId) out.push(r)
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit)
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
  if (!existsSync(RUNS_DIR)) return { swept: 0 }
  const now = Date.now()
  let swept = 0
  for (const f of readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue
    const path = join(RUNS_DIR, f)
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
      swept++
    } catch {
      /* skip unreadable record */
    }
  }
  return { swept }
}

export function readCronRunLog(runId: string): string {
  const safe = runId.replace(/[^\w-]/g, '')
  const f = join(RUNS_DIR, `${safe}.log`)
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

const safeRunId = (runId: string): string => runId.replace(/[^\w-]/g, '')

export function beginSessionRun(run: SessionRun): void {
  const safe = safeRunId(run.id)
  if (!safe) return
  mkdirSync(SESSION_RUNS_DIR, { recursive: true })
  writeFileSync(join(SESSION_RUNS_DIR, `${safe}.json`), JSON.stringify(run, null, 2))
  writeFileSync(
    join(SESSION_RUNS_DIR, `${safe}.log`),
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
  try {
    mkdirSync(SESSION_RUNS_DIR, { recursive: true })
    appendFileSync(join(SESSION_RUNS_DIR, `${safe}.log`), chunk)
  } catch {
    /* best-effort observability */
  }
}

export function finalizeSessionRun(runId: string, patch: Pick<SessionRun, 'status' | 'endedAt'> & Partial<SessionRun>): void {
  const safe = safeRunId(runId)
  if (!safe) return
  const path = join(SESSION_RUNS_DIR, `${safe}.json`)
  try {
    const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SessionRun) : null
    if (!current) return
    writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2))
  } catch {
    /* best-effort observability */
  }
}

export function readSessionRuns(limit = 200): SessionRun[] {
  if (!existsSync(SESSION_RUNS_DIR)) return []
  const out: SessionRun[] = []
  for (const f of readdirSync(SESSION_RUNS_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      out.push(JSON.parse(readFileSync(join(SESSION_RUNS_DIR, f), 'utf8')) as SessionRun)
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit)
}

// Session runs are IN-PROCESS — their PTY lives and dies with this app. So after
// a restart (or a crash/force-quit that skipped pty:exit → finalizeSessionRun),
// ANY record still at status:running is a zombie: nothing is actually running.
// Call once at startup, BEFORE the user can open new sessions, to finalize them
// as 'interrupted' — otherwise they pile up and inflate the Runs "running" count.
export function sweepStaleSessionRuns(): { swept: number } {
  if (!existsSync(SESSION_RUNS_DIR)) return { swept: 0 }
  const now = Date.now()
  let swept = 0
  for (const f of readdirSync(SESSION_RUNS_DIR)) {
    if (!f.endsWith('.json')) continue
    const path = join(SESSION_RUNS_DIR, f)
    try {
      const r = JSON.parse(readFileSync(path, 'utf8')) as SessionRun
      if (r.status !== 'running') continue
      writeFileSync(
        path,
        JSON.stringify({ ...r, status: 'interrupted', endedAt: r.endedAt ?? now, error: r.error ?? 'interrupted: app restarted' }, null, 2),
      )
      swept++
    } catch {
      /* skip unreadable record */
    }
  }
  return { swept }
}

export function readSessionRunLog(runId: string): string {
  const safe = safeRunId(runId)
  const f = join(SESSION_RUNS_DIR, `${safe}.log`)
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
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

// Success-rate / duration trends over the last `days` (#6). Reads the full run
// history (a generous limit — runs are never deleted) and buckets by day.
export function runTrends(days = 14): RunTrendPoint[] {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return bucketRunTrends(listAllRuns(20000), days, midnight.getTime())
}

export function listAllRuns(limit = 400): UnifiedRun[] {
  const cron = readCronRuns(undefined, limit).map(cronRunToUnified)
  const agent = listAgentRuns().map(agentRunToUnified)
  const bg = listBgTasks().map(bgTaskToUnified)
  const sessions = readSessionRuns(limit).map(sessionRunToUnified)
  return [...cron, ...agent, ...bg, ...sessions].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit)
}
