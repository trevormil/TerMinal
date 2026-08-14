// Per-agent reliability rollup. Pure aggregation over run records that already
// exist on disk (agent-runs, cron-runs, session-runs, bg-tasks) — this module
// collects nothing new and writes nothing. "Which of my agents actually
// succeeds" is answered entirely from history the app already keeps.

import type { AgentScorecard } from '../shared/types/agents'
export type { AgentScorecard } from '../shared/types/agents'
import type { FailingCheck } from '../shared/types/agents'
export type { FailingCheck } from '../shared/types/agents'
/** The slice of a run this module needs. Structurally satisfied by UnifiedRun
 *  (cron-runs.ts) and AgentRun (agents.ts) alike. */
export type ScorecardRun = {
  id: string
  agentId: string
  agentTitle?: string
  status: string
  startedAt: number
  endedAt?: number
  costUsd?: number
  evaluation?: {
    status: string
    checks?: { id: string; title: string; status: string }[]
  }
}

/** How many of the most recent runs a scorecard considers. */
export const SCORECARD_WINDOW = 30

const UNSUCCESSFUL = new Set(['failed', 'canceled', 'interrupted', 'error'])

export function scoreAgentRuns(runs: ScorecardRun[], window = SCORECARD_WINDOW): AgentScorecard {
  const w = [...runs].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, window)

  let done = 0
  let failed = 0
  let running = 0
  let costSum = 0
  let costN = 0
  let durSum = 0
  let durN = 0
  let evalPass = 0
  let evalFail = 0
  let evalIncomplete = 0
  const checkFails = new Map<string, FailingCheck>()

  for (const r of w) {
    if (r.status === 'done') done++
    else if (UNSUCCESSFUL.has(r.status)) failed++
    else running++

    if (typeof r.costUsd === 'number' && Number.isFinite(r.costUsd)) {
      costSum += r.costUsd
      costN++
    }
    if (typeof r.endedAt === 'number' && r.endedAt > r.startedAt) {
      durSum += r.endedAt - r.startedAt
      durN++
    }

    const ev = r.evaluation
    if (!ev) continue
    if (ev.status === 'pass') evalPass++
    else if (ev.status === 'incomplete') evalIncomplete++
    else evalFail++
    for (const c of ev.checks || []) {
      if (c.status !== 'fail') continue
      const prev = checkFails.get(c.id)
      if (prev) prev.count++
      else checkFails.set(c.id, { id: c.id, title: c.title, count: 1 })
    }
  }

  const settled = done + failed
  const newest = w[0]
  return {
    agentId: newest?.agentId || '',
    agentTitle: newest?.agentTitle || newest?.agentId || '',
    total: w.length,
    done,
    failed,
    running,
    successRate: settled ? Math.round((done / settled) * 100) : null,
    avgCostUsd: costN ? costSum / costN : undefined,
    totalCostUsd: costN ? costSum : undefined,
    avgDurationMs: durN ? Math.round(durSum / durN) : undefined,
    evaluated: evalPass + evalFail + evalIncomplete,
    evalPass,
    evalFail,
    evalIncomplete,
    failingChecks: [...checkFails.values()].sort((a, b) => b.count - a.count),
    lastRunAt: newest?.startedAt,
    lastStatus: newest?.status,
  }
}
