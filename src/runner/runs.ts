// Run records + the watchdog half of the runner: every cron invocation reaps
// runs whose process is gone, refuses a concurrent firing, and trips the
// circuit breaker after N consecutive failures.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CronRun } from '../shared/types/runs'
import type { Schedule } from '../shared/types/schedules'
import { readJson, RUNS_DIR } from './config'
import { readDisabled, writeDisabled } from './disabled'
import { fileHitl } from './hitl'
import { activity, log } from './log'
import { stamp } from './schedules'
import { fileTicket } from './tickets'
import { writeJsonAtomicShared } from './state-io'

// A run is "stale" if it claims status:running but no live process is attached
// and it started more than this long ago. Catches runner death (terminal
// closed, host crashed, OOM, launchd killed) which would otherwise leave the
// record stuck at running forever.
export const STALE_MS = 2 * 60 * 60 * 1000 // 2 hours

// Auto-disable after this many consecutive failures (kill-switch / circuit
// breaker). Tunable per agent via .terminal/circuit-breaker.json in the future;
// 3 is a sane default that survives transient flakes but stops runaway loops.
export const CIRCUIT_BREAK_AFTER = 3

/** A run record as it sits on disk — every field is suspect until read. */
export type RunRecord = Partial<CronRun> & { repoRoot?: string; attempts?: number }

function runRecords(): { path: string; rec: RunRecord }[] {
  const dir = RUNS_DIR()
  if (!existsSync(dir)) return []
  const out: { path: string; rec: RunRecord }[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    const rec = readJson<RunRecord>(path)
    if (rec) out.push({ path, rec })
  }
  return out
}

// Returns the most recent run with status:running for the given scheduleId
// (after sweepStaleRuns() has already finalized anything truly dead), or
// undefined if none. Used to refuse a concurrent firing of the same agent.
export function activeRunFor(scheduleId: string): RunRecord | undefined {
  try {
    for (const { rec } of runRecords()) {
      if (rec.scheduleId === scheduleId && rec.status === 'running') return rec
    }
  } catch {}
  return undefined
}

// Read the most recent N runs for a given scheduleId, newest first.
export function recentRuns(scheduleId: string, limit = CIRCUIT_BREAK_AFTER): RunRecord[] {
  try {
    return runRecords()
      .map(({ rec }) => rec)
      .filter((rec) => rec.scheduleId === scheduleId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit)
  } catch {
    return []
  }
}

// Trip the breaker if the last N runs were all failures. Returns true if we tripped.
export function maybeCircuitBreak(scheduleId: string, sched: Schedule): boolean {
  const recent = recentRuns(scheduleId, CIRCUIT_BREAK_AFTER)
  if (recent.length < CIRCUIT_BREAK_AFTER) return false
  if (!recent.every((r) => r.status === 'failed')) return false
  const set = readDisabled()
  if (set.has(scheduleId)) return false // already disabled
  set.add(scheduleId)
  writeDisabled(set, {
    [scheduleId]: {
      reason: `auto-disabled after ${CIRCUIT_BREAK_AFTER} consecutive failures`,
      at: Date.now(),
    },
  })
  fileHitl({
    title: `Circuit broken · ${sched.agentTitle}`,
    action: `auto-disabled after ${CIRCUIT_BREAK_AFTER} consecutive failures — re-enable from the Schedules tab when fixed`,
    detail: `schedule ${scheduleId} · ${sched.repoLabel}`,
    repo: sched.repoLabel,
    repoRoot: sched.repoRoot,
  })
  activity({
    kind: 'blocked',
    title: `Circuit broken · ${sched.agentTitle}`,
    detail: `auto-disabled after ${CIRCUIT_BREAK_AFTER} fails`,
    repo: sched.repoLabel,
    repoRoot: sched.repoRoot,
    suppressTelegram: true,
  })
  log(
    `circuit-break: schedule ${scheduleId} (${sched.agentTitle}) disabled after ${CIRCUIT_BREAK_AFTER} fails`,
  )
  return true
}

// Probe whether a PID belongs to a live process. Sending signal 0 is a
// no-op delivery — succeeds if the process exists and we can signal it,
// throws ESRCH if no such process. ANY other error (EPERM) means the
// process exists; treat as alive to avoid false positives.
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

// Find runs claiming status:running with no live process attached and
// finalize them. Two reaping rules — liveness wins over time:
//   (1) Liveness: the run record has a PID and that PID is dead → reap
//       immediately. This catches the common failure mode (launchd or
//       OOM SIGKILLed the wrapper) within one cron tick.
//   (2) Time fallback: STALE_MS old with no useful PID. Covers legacy
//       records and pre-PID-tracking runs that died.
// Runs at the start of every cron invocation so the system self-heals
// even without a dedicated watchdog schedule. Returns the count.
export function sweepStaleRuns(): number {
  if (!existsSync(RUNS_DIR())) return 0
  let swept = 0
  try {
    for (const { path, rec } of runRecords()) {
      if (rec.status !== 'running') continue
      const ageMs = rec.startedAt ? Date.now() - rec.startedAt : 0
      const pidDead = !!rec.pid && !isPidAlive(rec.pid)
      // Liveness: only trust a fresh pidDead reading. Inside the first
      // few seconds the OS may not yet have registered the spawn — give
      // it a small grace period (10s) so we don't reap a still-warming
      // run. After STALE_MS we time-fall-back regardless of pid presence.
      const reapForLiveness = pidDead && ageMs > 10_000
      const reapForAge = ageMs >= STALE_MS
      if (!reapForLiveness && !reapForAge) continue
      const reason = reapForLiveness
        ? `dead process (pid ${rec.pid}); runner exited without finalizing the run`
        : 'stale: runner exited without finalizing the run (swept by watchdog)'
      const finalized = {
        ...rec,
        status: 'failed',
        endedAt: Date.now(),
        error: reason,
      }
      writeJsonAtomicShared(path, finalized)
      if (rec.scheduleId) stamp(rec.scheduleId, { lastStatus: 'failed' })
      const ageMin = Math.round(ageMs / 60_000)
      const detectionPhrase = reapForLiveness
        ? `the wrapper process (pid ${rec.pid}) is dead after ${ageMin} min`
        : `it was running for >${Math.round(STALE_MS / 3_600_000)}h with no live process`
      const staleTicketPath = rec.repoRoot
        ? fileTicket(rec.repoRoot, {
            title: `Cron run stale: ${rec.agentTitle || rec.agentId}`,
            body: `The scheduled run for **${rec.agentTitle || rec.agentId}** (branch \`${rec.branch}\`) was swept by the watchdog because ${detectionPhrase}.\n\n- run id: \`${rec.id}\`\n- log: \`~/.config/TerMinal/cron-runs/${rec.id}.log\`\n- worktree: \`${rec.worktree}\`\n\nInvestigate why the runner died mid-run (terminal closed, OOM, launchd killed, network hang). Fix the root cause; re-enable the schedule in the Schedules tab if the circuit-breaker tripped.`,
            type: 'bug',
            priority: 'high',
          })
        : null
      fileHitl({
        title: `Cron run stale · ${rec.agentTitle || rec.agentId}`,
        action: 'runner died mid-run — swept by watchdog and marked failed',
        detail: `run ${rec.id} · ${rec.branch || ''}`,
        repo: rec.repoLabel,
        repoRoot: rec.repoRoot,
        runId: rec.id,
        runSource: 'cron',
        ticketPath: staleTicketPath,
      })
      swept++
      log(`watchdog: marked ${rec.id} stale`)
    }
  } catch (e) {
    log(`watchdog sweep failed: ${e}`)
  }
  return swept
}
