import type { ChildProcess } from 'node:child_process'

// Child-process lifecycle helpers for agent runs — kept out of agents.ts so
// they are testable without importing electron.

// Hard cap per agent STEP, mirroring bin/terminal-cron's DEFAULT_TIMEOUT_MS.
// Deliberately per-step, not per-run: it is applied around each spawned child in
// runStep, so a 5-step spec is bounded at 5 x this. The point is catching a HUNG
// engine, and a step that has produced no exit in 30 minutes is hung regardless
// of how many steps precede it.
export const AGENT_RUN_TIMEOUT_MS = 30 * 60 * 1000
/** Conventional exit code for a timed-out command (same as terminal-cron). */
export const AGENT_TIMEOUT_EXIT = 124

/**
 * Resolve a step's hard cap. `runSpec` had NO timeout at all (only cron did), so
 * a hung engine left the run `running` forever — and because the duplicate-run
 * guard refuses to start an agent that already has a running run, that agent was
 * then blocked permanently until the app restarted.
 */
export function resolveRunTimeoutMs(timeoutSec?: number): number {
  const sec = Number(timeoutSec)
  if (!Number.isFinite(sec) || sec <= 0) return AGENT_RUN_TIMEOUT_MS
  return Math.floor(sec) * 1000
}

// Agent children are spawned `detached: true` so each gets its own process
// GROUP. That matters because we spawn `script`, which spawns the login shell,
// which spawns `claude`/`codex` — killing the pid only ever reached the `script`
// wrapper, leaving the engine alive, still burning tokens and still able to
// commit and push. Killing the negative pid signals the whole group.
export function killProcessGroup(p: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!p.pid) return
  try {
    process.kill(-p.pid, signal)
  } catch {
    // No group (already reaped, or the platform refused) — fall back to the pid
    // so we at least kill the wrapper.
    try {
      p.kill(signal)
    } catch {
      /* already gone */
    }
  }
}
