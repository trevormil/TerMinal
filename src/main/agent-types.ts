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

// On-demand Codex agents. Each runs in its own git worktree off the default
// branch; codex does the work, files tickets, and opens the PR itself. We just
// orchestrate the worktree + process and stream the output.

export type AgentRunContext = Persona

export type { Agent, AgentCheck, AgentDefinition, AgentJudge, AgentModelPolicy, AgentQuality, AgentRun, AgentRunEvaluation, AgentRunEvaluationCheck, AgentRunStatus, AgentRunTrace, Engine } from '../shared/types/agents'
export type { RerunSpec } from '../shared/types/agents'
export type { PrAgentKind } from '../shared/types/agents'

