import type { RunStatus } from '../run-record'
import type { AgentRun } from './agents'
import type { EngineId } from '../engines'

export type CronRun = {
  id: string
  scheduleId: string
  agentId: string
  agentTitle: string
  engine: string
  status: Extract<RunStatus, 'running' | 'done' | 'failed' | 'canceled'>
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

// A single shape for every run regardless of origin — cron-fired vs in-process
// agent vs ticket-spawn etc. Powers the Runs tab so the operator gets one
// global picture instead of jumping between Schedules and Agents.
export type UnifiedRun = {
  id: string
  source: 'cron' | 'agent' | 'bg' | 'session'
  agentId: string
  agentTitle: string
  engine: string
  // Narrowed from `string` (ticket 91): the four stores share one vocabulary
  // now, and remote records normalize at the fetch boundary.
  status: RunStatus
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

export type RunArtifact = {
  slug: string
  title: string
  agent?: string
  ok?: boolean
  createdAt?: string
  reportPath: string
  summary?: string
}

export type StorageEntry = {
  path: string
  bytes: number
}

export type WorktreeStoreReport = {
  bytes: number
  thresholdBytes: number
  planned: StorageEntry[]
  deleted: StorageEntry[]
  protectedRunning: StorageEntry[]
  /** Held back because the worktree still has uncommitted work. */
  protectedDirty: StorageEntry[]
}

export type TerminalStateSweepReport = {
  root: string
  dryRun: boolean
  totalBytes: number
  reclaimableBytes: number
  reclaimedBytes: number
  worktrees: WorktreeStoreReport
  /** `<projectsDir>/.worktrees` — where agent/lane worktrees land (ticket 69 P8). */
  agentWorktrees: WorktreeStoreReport & { dir: string }
  /** Temp/lock/quarantine files the write path left behind. */
  leftovers: {
    bytes: number
    planned: StorageEntry[]
    deleted: StorageEntry[]
  }
  logs: {
    bytes: number
    maxBytes: number
    planned: StorageEntry[]
    rotated: StorageEntry[]
  }
  checkpoints: {
    bytes: number
    thresholdBytes: number
    /** Whole shadow repos aged out — the only prune checkpoints.ts ever had. */
    stores: {
      maxAgeMs: number
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
    gc: {
      planned: StorageEntry[]
      completed: CheckpointGcEntry[]
    }
    tmpObjects: {
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
  }
  scratch: {
    bytes: number
    clearable: boolean
  }
}

export type ScratchClearReport = {
  path: string
  bytes: number
  deleted: boolean
}

export type BgTask = {
  id: string
  repo: string // basename for display
  repoRoot: string // absolute path
  prompt: string
  engine: EngineId
  model?: string
  worktree: string
  branch: string
  pid?: number
  status: BgTaskStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  logFile: string
  mrUrl?: string
  /** Set when the task was spawned to work a backlog ticket (`/feature`). The
   *  watcher links the resulting PR back onto the ticket. */
  ticketSlug?: string
  ticketId?: number
  /** First few lines of the prompt for tab badges + listings */
  label: string
}

export type LoopRecord = {
  id: string
  repo: string // basename for display
  repoRoot: string
  goal: string
  mode: LoopMode
  engine: LoopEngine
  model?: string
  worktree: string
  branch: string
  status: LoopStatus
  phase: LoopPhase
  nextRole: LoopRole
  iteration: number
  activeRunId?: string
  activeRole?: LoopRole
  maxIterations: number
  createdAt: number
  updatedAt: number
}

/** Bounded view of loop state for the cockpit widget. */
export type LoopState = {
  phase: LoopPhase
  iteration: number
  bottleneck: string
  lastScore: string
  next: string
  assertions: { total: number; pass: number; fail: number; todo: number }
  tail: string[] // last few log lines
}

export type CheckpointGcEntry = StorageEntry & {
  error?: string
}

export type BgTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export type LoopEngine = 'claude' | 'codex' | 'cursor' | 'hermes'

export type LoopRole = 'planner' | 'generator' | 'evaluator'

export type LoopPhase = 'negotiate' | 'generate' | 'evaluate' | 'decide' | 'done' | 'stopped'

export type LoopStatus = 'idle' | 'running' | 'blocked' | 'done' | 'stopped'

// Three execution modes over the SAME loop state (contract.md, events.jsonl, …):
//   headless — TerMinal auto-steps one-shot role turns (stepLoop + watcher).
//   paired   — two live interactive sessions (a driver + a worker) drive the
//              roles themselves; the auto-stepper stays out of their way.
//   single   — ONE live generator session (planner+generator hat) plus an
//              ephemeral evaluator spawned by TerMinal after each of its turns.
//              The live session keeps warm context; the grader is always a fresh
//              context (the one non-negotiable: code is never graded by its
//              author). Driven by loop-listener's singleTick. Termination is
//              guaranteed by the maxIterations cap in decide() — see
//              singleDecide below.
export type LoopMode = 'headless' | 'paired' | 'single'
