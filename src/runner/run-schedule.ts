// ---- run a schedule --------------------------------------------------------
//
// One firing: sweep, guard, isolate a worktree, run the engine through a pty
// wrapper with retries, then finalize — and only after the last retry escalate
// to HITL + ticket + circuit breaker.
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseUsageFromOutput, writeAIRun } from './ai-runs'
import { readJson, RUNS_DIR, WT_DIR } from './config'
import { readDisabled } from './disabled'
import {
  buildChildEnv,
  buildCommand,
  resolveScriptPath,
  scriptArgsFor,
  shellFor,
} from './engine-cmd'
import { defaultBase, git } from './git'
import { fileHitl } from './hitl'
import { activity, log } from './log'
import { activeRunFor, CIRCUIT_BREAK_AFTER, maybeCircuitBreak, sweepStaleRuns } from './runs'
import { readSchedules, stamp } from './schedules'
import { fileTicket } from './tickets'
import { writeJsonAtomicShared } from './state-io'

// Retry policy for flaky runs. A non-zero exit (or a timeout) is retried up to
// DEFAULT_RETRY_MAX more times with exponential backoff before the run is
// finalized as failed — only then do the HITL / ticket / circuit-breaker
// handlers fire. Per-schedule sched.retry / sched.timeoutSec override these.
const DEFAULT_RETRY_MAX = 2 // 2 retries → up to 3 attempts per firing
const BACKOFF_BASE_SEC = 30 // 30s → 2m → 8m (×4 each step)
const BACKOFF_FACTOR = 4
const BACKOFF_MAX_SEC = 8 * 60
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30m hard cap per attempt
const TIMEOUT_EXIT = 124 // conventional exit code for a timed-out command

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const backoffMsFor = (retryIndex: number, baseSec: number): number =>
  Math.min(baseSec * BACKOFF_FACTOR ** retryIndex, BACKOFF_MAX_SEC) * 1000

export async function runSchedule(id: string): Promise<number> {
  mkdirSync(RUNS_DIR(), { recursive: true })

  // Every cron invocation is also a heartbeat sweep — cheap and self-healing.
  sweepStaleRuns()

  const sched = readSchedules().find((s) => s.id === id)
  if (!sched) {
    log(`run: schedule ${id} not found — skipping`)
    return 0
  }
  if (sched.enabled === false) {
    log(`run: schedule ${id} disabled — skipping`)
    return 0
  }
  if (readDisabled().has(id)) {
    log(`run: schedule ${id} kill-switched (agents/disabled.json) — skipping`)
    return 0
  }

  // Concurrent-run guard. Stale runs were just swept; anything still
  // status:running for this schedule is a true overlap. Never allow two
  // concurrent runs of the same agent — they'd race on the same worktree
  // path scheme and pollute each other's state. File HITL + bail.
  const active = activeRunFor(id)
  if (active) {
    const msg = `concurrent run blocked — ${sched.agentTitle} run ${(active.id ?? '').slice(0, 8)} is already running (started ${new Date(active.startedAt as number).toISOString()})`
    log(`run: ${msg}`)
    fileHitl({
      title: `Concurrent cron run blocked · ${sched.agentTitle}`,
      action:
        'previous run is still in progress; this firing was refused — investigate why the previous run is taking so long',
      detail: `active run ${active.id} · ${active.branch}`,
      repo: sched.repoLabel,
      repoRoot: sched.repoRoot,
      runId: active.id,
      runSource: 'cron',
    })
    activity({
      kind: 'blocked',
      title: `Concurrent cron blocked · ${sched.agentTitle}`,
      detail: `previous run ${(active.id ?? '').slice(0, 8)} still running`,
      repo: sched.repoLabel,
      repoRoot: sched.repoRoot,
      suppressTelegram: true,
    })
    return 0
  }

  const runId = randomUUID()
  const ts = Date.now()
  const tag = `${ts}-${runId.slice(0, 4)}`
  // Host-targeted schedules store a host-relative repoRoot (e.g. ~/repos/<name>,
  // per ADR-0002 #18) since the app that saved them ran on a different machine.
  // Expand a leading ~/ against THIS host's home so worktree/base paths resolve.
  const repo = sched.repoRoot.startsWith('~/')
    ? join(homedir(), sched.repoRoot.slice(2))
    : sched.repoRoot
  const repoBase = repo.split('/').pop() || 'repo'
  const worktree = join(WT_DIR(), repoBase, `${id}-${tag}`)
  const branch = `cron/${sched.agentId}-${tag}`
  const logFile = join(RUNS_DIR(), `${runId}.log`)
  const recFile = join(RUNS_DIR(), `${runId}.json`)
  const writeRec = (extra: Record<string, unknown>): void =>
    writeJsonAtomicShared(recFile, {
      id: runId,
      scheduleId: id,
      agentId: sched.agentId,
      agentTitle: sched.agentTitle,
      engine: sched.engine,
      repoRoot: repo,
      repoLabel: sched.repoLabel,
      worktree,
      branch,
      startedAt: ts,
      ...extra,
    })

  log(`run ${runId}: schedule ${id} (${sched.agentTitle}) in ${repo}`)
  writeRec({ status: 'running' })
  stamp(id, { lastRun: ts, lastStatus: 'running', lastRunId: runId })
  activity({
    kind: 'agent-run',
    title: `Scheduled · ${sched.agentTitle} · started`,
    detail: `${sched.engine} · ${sched.repoLabel}`,
    repo: sched.repoLabel,
    repoRoot: repo,
  })

  // isolated worktree off the default base
  const base = defaultBase(repo)
  try {
    mkdirSync(join(WT_DIR(), repoBase), { recursive: true })
    git(repo, ['worktree', 'add', worktree, '-b', branch, base])
  } catch (e) {
    const msg = `worktree failed: ${e}`
    log(`run ${runId}: ${msg}`)
    writeFileSync(logFile, msg + '\n')
    writeRec({ status: 'failed', endedAt: Date.now(), error: msg })
    stamp(id, { lastStatus: 'failed' })
    activity({
      kind: 'tests-fail',
      title: `Scheduled · ${sched.agentTitle} · failed`,
      detail: msg.slice(0, 120),
      repo: sched.repoLabel,
      repoRoot: repo,
    })
    const wtTicketPath = fileTicket(repo, {
      title: `Cron run failed: ${sched.agentTitle} (worktree setup)`,
      body: `Worktree setup failed for the scheduled \`${sched.agentTitle}\` run.\n\n\`\`\`\n${msg}\n\`\`\`\n\n- schedule: \`${id}\`\n- run: \`${runId}\`\n- log: \`~/.config/TerMinal/cron-runs/${runId}.log\``,
    })
    fileHitl({
      title: `Scheduled run failed · ${sched.agentTitle}`,
      action: 'worktree setup failed — check the repo and cron log',
      detail: msg.slice(0, 200),
      repo: sched.repoLabel,
      repoRoot: repo,
      runId,
      runSource: 'cron',
      ticketPath: wtTicketPath,
    })
    maybeCircuitBreak(id, sched)
    return 1
  }

  const scriptPath = resolveScriptPath(repo, sched.agentId)
  const cmd = buildCommand(sched, worktree, scriptPath)
  const isMac = process.platform === 'darwin'
  const shell = shellFor(isMac)
  writeFileSync(
    logFile,
    `▸ ${sched.agentTitle} · ${sched.engine}\n▸ branch ${branch}\n▸ ${scriptPath ? `exec ${scriptPath}` : cmd}\n\n`,
  )
  const fd = openSync(logFile, 'a')

  const childEnv = buildChildEnv({ sched, repo, runId, branch, worktree })

  // Retry policy for this schedule (per-schedule overrides → runner defaults).
  const maxRetries = Math.max(0, Number(sched.retry?.maxRetries ?? DEFAULT_RETRY_MAX))
  const backoffBaseSec = Math.max(1, Number(sched.retry?.backoffSec ?? BACKOFF_BASE_SEC))
  const timeoutMs =
    sched.timeoutSec && sched.timeoutSec > 0 ? sched.timeoutSec * 1000 : DEFAULT_TIMEOUT_MS

  // Cooperative cancel: a user cancel (runs:cancel / remote runs.cancel) sends
  // SIGTERM to THIS runner's pid (recorded as runnerPid). We kill the current
  // attempt's process group, record the run as canceled, and exit WITHOUT
  // retrying (killing just the child would let the retry loop re-fire).
  let currentChild: ChildProcess | null = null
  let canceling = false
  const onCancelSignal = (): void => {
    if (canceling) return
    canceling = true
    try {
      if (currentChild && currentChild.pid) process.kill(-currentChild.pid, 'SIGTERM')
    } catch {}
    try {
      writeRec({ status: 'canceled', endedAt: Date.now(), error: 'canceled by user' })
    } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', onCancelSignal)
  process.on('SIGINT', onCancelSignal)

  // One attempt: spawn the wrapped CLI, enforce the per-attempt timeout, and
  // resolve { code, timedOut }. Detached so we get a process group we can kill
  // wholesale on timeout (killing `script` alone can orphan the agent child).
  //
  // Wrap in `script -q /dev/null` so the wrapped CLI sees a pseudo-TTY and
  // streams stdout/stderr in real time. Without this, `claude -p` (and other
  // engines) buffer everything until exit and the log is unreadable mid-run.
  // `script` is in /usr/bin on macOS by default.
  const runAttempt = (attempts: number): Promise<{ code: number; timedOut: boolean }> =>
    new Promise((resolve) => {
      const p = spawn('script', scriptArgsFor(isMac, shell, cmd), {
        cwd: worktree,
        env: childEnv,
        stdio: ['ignore', fd, fd],
        detached: true,
      })
      // Persist the wrapper PID so the watchdog can detect a dead-but-
      // still-marked-running record via `kill(pid, 0)` rather than waiting
      // STALE_MS (2h). Without this, a launchd SIGKILL or any silent runner
      // death leaves the cron-runs/<id>.json zombied at status:running for
      // hours — long enough that downstream cron ticks treat the schedule
      // as in-progress and skip themselves.
      currentChild = p
      // Record BOTH pids: p.pid (script wrapper — the watchdog's liveness probe)
      // and runnerPid (this process — a user cancel SIGTERMs this to stop retries).
      if (p.pid) writeRec({ status: 'running', pid: p.pid, runnerPid: process.pid, attempts })
      let timedOut = false
      const killGroup = (sig: NodeJS.Signals): void => {
        try {
          if (p.pid) process.kill(-p.pid, sig)
        } catch {}
      }
      const timer = setTimeout(() => {
        timedOut = true
        appendFileSync(
          logFile,
          `\n[timeout] attempt exceeded ${Math.round(timeoutMs / 1000)}s — killing run\n`,
        )
        killGroup('SIGTERM')
        setTimeout(() => killGroup('SIGKILL'), 5000) // hard-kill if it ignores TERM
      }, timeoutMs)
      p.on('error', (err) => {
        clearTimeout(timer)
        appendFileSync(logFile, `\n[spawn error] ${err.message}\n`)
        resolve({ code: 1, timedOut })
      })
      p.on('exit', (c) => {
        clearTimeout(timer)
        resolve({ code: timedOut ? TIMEOUT_EXIT : (c ?? 1), timedOut })
      })
    })

  let code = 1
  let timedOut = false
  let attempts = 0
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const waitMs = backoffMsFor(attempt - 1, backoffBaseSec)
      appendFileSync(
        logFile,
        `\n▸ attempt ${attempt} failed (exit ${code}${timedOut ? ', timed out' : ''}) — retry ${attempt}/${maxRetries} in ${Math.round(waitMs / 1000)}s\n`,
      )
      stamp(id, { lastStatus: 'running' })
      await sleep(waitMs)
      // Reset the worktree to a clean base so a half-applied failed attempt
      // never bleeds into the retry (we reuse the worktree, not a fresh one).
      try {
        git(worktree, ['reset', '--hard', base])
        git(worktree, ['clean', '-fd'])
      } catch (e) {
        appendFileSync(logFile, `[retry] worktree reset failed: ${e}\n`)
      }
      appendFileSync(logFile, `\n▸ attempt ${attempt + 1}/${maxRetries + 1}\n`)
    }
    attempts = attempt + 1
    const res = await runAttempt(attempts)
    code = res.code
    timedOut = res.timedOut
    if (code === 0) break
  }

  const status = code === 0 ? 'done' : 'failed'
  const endedAt = Date.now()
  writeRec({ status, endedAt, exitCode: code, attempts, ...(timedOut ? { timedOut: true } : {}) })
  stamp(id, { lastStatus: status })
  // Observability: parse the captured log for usage stats and persist as an
  // AIRun ledger entry. Silent on miss (scripts may emit
  // no usage line — that's expected).
  try {
    const logText = readFileSync(logFile, 'utf8')
    const usage = sched.engine === 'cursor' ? null : parseUsageFromOutput(logText)
    if (usage) {
      writeAIRun({
        engine: sched.engine,
        model:
          usage.model ||
          childEnv.TERMINAL_MODEL ||
          (sched.engine === 'codex' ? 'gpt-5' : sched.engine === 'cursor' ? 'cursor' : 'sonnet'),
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        repoRoot: repo,
        runId,
        agentId: sched.agentId,
        startedAt: ts,
        endedAt,
        exitCode: code,
      })
    }
  } catch {
    /* never block run finalization on observability */
  }
  const attemptNote = attempts > 1 ? ` · ${attempts} attempts` : ''
  activity({
    kind: code === 0 ? 'agent-run' : 'tests-fail',
    title: `Scheduled · ${sched.agentTitle} · ${status}`,
    detail: `${sched.engine} · ${branch}${attemptNote}${code === 0 && attempts > 1 ? ' (recovered on retry)' : ''}`,
    repo: sched.repoLabel,
    repoRoot: repo,
  })
  if (code !== 0) {
    // All retries exhausted — now (and only now) escalate.
    const failReason = timedOut
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : `exited with code ${code}`
    const failTicketPath = fileTicket(repo, {
      title: `Cron run failed: ${sched.agentTitle} (${timedOut ? 'timeout' : `exit ${code}`})`,
      body: `The scheduled \`${sched.agentTitle}\` run ${failReason} after ${attempts} attempt${attempts === 1 ? '' : 's'}.\n\n- schedule: \`${id}\`\n- run: \`${runId}\`\n- branch: \`${branch}\`\n- worktree: \`${worktree}\`\n- log: \`~/.config/TerMinal/cron-runs/${runId}.log\`\n\nInvestigate the log and fix the underlying issue; circuit-breaker auto-disables after ${CIRCUIT_BREAK_AFTER} consecutive failures.`,
    })
    fileHitl({
      title: `Scheduled run failed · ${sched.agentTitle}`,
      action: `${failReason} after ${attempts} attempt${attempts === 1 ? '' : 's'} — review the run log`,
      detail: `run ${runId} · ${branch}`,
      repo: sched.repoLabel,
      repoRoot: repo,
      runId,
      runSource: 'cron',
      ticketPath: failTicketPath,
    })
    maybeCircuitBreak(id, sched)
  }
  log(
    `run ${runId}: ${status} (exit ${code}, ${attempts} attempt${attempts === 1 ? '' : 's'}${timedOut ? ', timed out' : ''})`,
  )
  return code === 0 ? 0 : 1
}
