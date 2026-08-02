// The agent domain's type vocabulary (ticket 91).
//
// Split out of agents.ts, which was 2,509 lines of five unrelated concerns —
// types, a 380-line data catalog, the repo/global registry, the run store, and
// process spawning. Types first because everything else imports them, so
// hoisting them is what lets the rest come apart without cycles.
//
// Pure declarations: no imports with runtime cost, nothing to execute. That is
// deliberate — a types module that reaches for the filesystem is a types module
// that drags the filesystem into every consumer.

import type { Persona } from './personas'

/** Which PR-scoped agent to run. Lived 1,700 lines away from its only use. */
export type PrAgentKind = 'review' | 'iterate'

export type Engine = import('../shared/engines').EngineId

export type AgentModelPolicy = {
  default?: string
  cheap?: string
  deep?: string
  judge?: string
  allowOverride?: boolean
}

export type AgentCheck = {
  id: string
  title: string
  command: string
  cwd?: 'repo' | 'worktree'
  required?: boolean
  timeoutMs?: number
}

export type AgentJudge = {
  enabled?: boolean
  mode?: 'deterministic' | 'llm' | 'hybrid'
  model?: string
  rubric?: string[]
  passThreshold?: number
}

export type AgentQuality = {
  acceptanceCriteria?: string[]
  requiredArtifacts?: string[]
  deterministicChecks?: AgentCheck[]
  judge?: AgentJudge
}

export type AgentRunEvaluationCheck = {
  id: string
  title: string
  command?: string
  status: 'pass' | 'fail' | 'skipped'
  required?: boolean
  detail?: string
}

export type AgentRunEvaluation = {
  status: 'pass' | 'fail' | 'incomplete'
  evaluatedAt: number
  summary: string
  checks: AgentRunEvaluationCheck[]
  judge?: {
    enabled: boolean
    mode: AgentJudge['mode']
    status: 'not-run'
    model?: string
    detail: string
  }
}

export type AgentRunTrace = {
  ticketSlug?: string
  ticketId?: number
  ticketRef?: string
  prIid?: number
  prKind?: 'review' | 'iterate'
  sourceBranch?: string
  /** Set when this run is one of N parallel variant attempts ("lanes") of a
   *  ticket. `group` ties the lanes together; index/total are 1-based. */
  lane?: { group: string; index: number; total: number }
}

export type AgentDefinition = {
  id: string
  ref: { id: string; scope: 'repo' | 'global'; kind: 'classic' | 'persistent' }
  title: string
  description?: string
  icon?: string
  scope: 'repo' | 'global'
  kind: 'classic' | 'persistent'
  source: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global' | 'persistent'
  runtime: {
    engine?: Engine
    model?: string
    modelPolicy?: AgentModelPolicy
    mode: 'prompt' | 'script' | 'persistent'
    scriptPath?: string
    memoryDir?: string
    inPlace?: boolean
    opensPr?: boolean
    force?: boolean
  }
  instructions: {
    prompt?: string
    system?: string
    knowledgePolicy?: 'minimal' | 'standard' | 'deep'
    outputContract?: string
  }
  quality: AgentQuality
  metadata: {
    tags?: string[]
    createdAt?: number
    updatedAt?: number
    lastRunAt?: number
  }
}

// On-demand Codex agents. Each runs in its own git worktree off the default
// branch; codex does the work, files tickets, and opens the PR itself. We just
// orchestrate the worktree + process and stream the output.

export type Agent = {
  id: string
  title: string
  description?: string
  icon?: string
  prompt: string
  opensPr?: boolean
  engine?: Engine // default engine; overridable per run
  // Per-engine model alias (claude: "haiku"|"sonnet"|"opus"; codex: model name
  // like "gpt-5-codex", "gpt-5", "o4-mini"). undefined → engine default. Lets
  // lightweight agents (health, deps audit) avoid burning the biggest model.
  model?: string
  modelPolicy?: AgentModelPolicy
  quality?: AgentQuality
  outputContract?: string
  acceptanceCriteria?: string[]
  // Computed by readAgents: true when .agents/<id>.sh (or the global script)
  // exists. The runner branches on this — UI uses it for a "sh" badge so
  // operators can see at a glance which agents are script-first.
  hasScript?: boolean
  // Run directly in the repo (no fresh worktree) — e.g. orchestrators like
  // /factory that manage their own worktrees internally, or quick additive ops.
  inPlace?: boolean
  // FORCE MODE — the runner sets TERMINAL_FORCE_MAIN=1 in the child env so the
  // global block-main-merge hook lets the agent push to / merge into main.
  // The prompt is auto-prepended with a FORCE preamble so the agent's own
  // skills don't refuse. UI labels these with a red FORCE chip. Reserve for
  // genuine emergencies — every other agent should go through the PR/MR gate.
  force?: boolean
  // provenance (set by readAgents): a built-in default, a default overridden by
  // this repo's .agents/agents.json, a repo-only agent, a global agent
  // (~/.config/TerMinal/agents/global.json), or a default overridden globally.
  source?: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global'
}

export type AgentRunContext = Persona

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
  persona?: string
  pipeline?: string // display label when this run chained multiple stages
  rerun?: RerunSpec
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  worktree: string
  branch: string
  output: string
  /** USD cost of the run when the harness reports it (OpenRouter/or-agent). */
  costUsd?: number
  /** Snapshot of the agent's force flag at run-time — so historical runs
   *  display FORCE even if the agent is later deleted or rescoped. */
  force?: boolean
  trace?: AgentRunTrace
  evaluation?: AgentRunEvaluation
}

export type RerunSpec =
  | {
      kind: 'agent'
      agentId: string
      engine: Engine
      personaId?: string
      pipelineId?: string
      model?: string
    }
  | {
      kind: 'ticket'
      slug: string
      engine: Engine
      personaId?: string
      pipelineId?: string
      model?: string
    }
  | {
      kind: 'pr'
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string }
      prKind: PrAgentKind
      engine: Engine
      personaId?: string
      pipelineId?: string
      model?: string
    }
  | { kind: 'ticket-spawn'; text: string; engine: Engine; model?: string }
  | { kind: 'factory'; engine: Engine }
  | {
      kind: 'agent-designer'
      text: string
      engine: Engine
      scope: 'repo' | 'global'
      model?: string
    }
  | {
      kind: 'persistent-agent'
      persistentAgentId: string
      task: string
      engine: Engine
      model?: string
    }
  | { kind: 'persistent-agent-designer'; text: string; engine: Engine; model?: string }
  | { kind: 'schedule-designer'; text: string; engine: Engine }
