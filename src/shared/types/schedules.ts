import type { Engine } from './agents'

export type ScheduleStatus = 'never' | 'running' | 'done' | 'failed'

export type Schedule = {
  id: string
  repoRoot: string
  repoLabel: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string // optional per-engine model alias (claude: haiku/sonnet/opus; codex: model name). Cron runner passes as --model <name>.
  effort?: string // optional reasoning-effort level; cron runner passes the engine's native flag (claude --effort / codex -c model_reasoning_effort / pi --thinking / or-agent --effort)
  prompt: string // snapshot of the agent prompt at save time (runner uses this)
  spec: ScheduleSpec
  enabled: boolean
  /**
   * Where this schedule fires (ADR-0002). Absent → local, triggered by launchd.
   * A hostId referencing settings.remoteHosts[] → fired by a systemd --user timer
   * on that always-on host (never a literal host name). The trigger layer is
   * chosen by the resolved host's `platform`, routed in schedule-router.ts.
   */
  host?: string
  /**
   * Execution substrate on the target host (ADR-0002 C3). Absent/`bare` → the
   * runner spawns the engine directly in a git worktree (default). `container` →
   * the run executes in a Docker image whose entrypoint dispatches the engine
   * (opt-in; the same image is the future DOKS CronJob artifact). Landed in #13.
   */
  runtime?: 'bare' | 'container' | 'k8s'
  /**
   * Per-schedule environment variables. Spread into the spawned wrapper's env
   * after the standard TERMINAL_* keys, so the schedule can pin parameterized
   * inputs the agent prompt depends on (e.g. BEACON_PROJECT=bolt to drain a
   * specific project, RELEASE_CHANNEL=canary, etc). NOT a place for secrets
   * the agent itself shouldn't see — TerMinal launches the wrapper in the
   * user's shell, so these are visible to the spawned engine.
   */
  env?: Record<string, string>
  /**
   * Optional per-schedule retry policy for flaky runs. When a run exits
   * non-zero, the headless runner (bin/terminal-cron) retries up to
   * `maxRetries` more times with exponential backoff before finalizing the run
   * as failed (and only then filing HITL / tripping the circuit breaker).
   * Absent → the runner's built-in defaults.
   */
  retry?: { maxRetries: number; backoffSec: number }
  /**
   * Optional hard wall-clock cap (seconds) on a single run attempt. The runner
   * kills a run that exceeds it and treats the timeout as a (retryable)
   * failure. Absent → the runner's built-in default.
   */
  timeoutSec?: number
  createdAt: number
  lastRun?: number
  lastStatus?: ScheduleStatus
  lastRunId?: string
}

// Stored timing spec. `calendar` → one or more StartCalendarInterval dicts;
// `cron` → a raw 5-field expression parsed to the same.
export type ScheduleSpec =
  | { kind: 'calendar'; minute: number; hour: number; weekdays?: number[] }
  | { kind: 'cron'; expr: string }
