import { readActivity, type ActivityKind } from './events'
import { listRuns } from './agents'
import { readCronRuns } from './cron-runs'
import { openCount as hitlOpenCount } from './hitl'
import { cycleAndFunnel, type CycleStats, type Funnel } from './cycle'

export type { CycleStats, Funnel } from './cycle'

// Read-only cross-repo factory health, aggregated from the global stores already
// on disk (activity.jsonl, agent-runs, cron-runs, hitl.json). No new tracking —
// just a roll-up so the operator can answer "is the factory productive / healthy".

const DAY = 86_400_000

export type WindowStats = {
  events: number
  ticketsFiled: number
  ticketsClosed: number
  prsOpened: number
  prsMerged: number
  reviews: number
  testsPass: number
  testsFail: number
  agentRuns: number
  checks: number
  docs: number
  blocked: number
}
export type RunStats = {
  total: number
  done: number
  failed: number
  running: number
  successRate: number
}
export type FactoryHealth = {
  generatedAt: number
  window24h: WindowStats
  window7d: WindowStats
  agents: RunStats
  cron: RunStats & { recentFailures: number }
  hitlOpen: number
  cycle: CycleStats
  funnel: Funnel
  recentFailures: { title: string; ts: number; repo: string; kind: string }[]
  daily: { day: string; count: number }[]
  byRepo: { repo: string; events: number }[]
}

function windowStats(events: { kind: ActivityKind; ts: number }[], since: number): WindowStats {
  const w = events.filter((e) => e.ts >= since)
  const n = (k: ActivityKind) => w.filter((e) => e.kind === k).length
  return {
    events: w.length,
    ticketsFiled: n('ticket-filed'),
    ticketsClosed: n('ticket-closed'),
    prsOpened: n('pr-opened'),
    prsMerged: n('pr-merged'),
    reviews: n('pr-verdict'),
    testsPass: n('tests-pass'),
    testsFail: n('tests-fail'),
    agentRuns: n('agent-run'),
    checks: n('check'),
    docs: n('doc'),
    blocked: n('blocked'),
  }
}

function runStats(runs: { status: string; startedAt?: number }[]): RunStats {
  const total = runs.length
  const done = runs.filter((r) => r.status === 'done').length
  const failed = runs.filter((r) => r.status === 'failed').length
  const running = runs.filter((r) => r.status === 'running').length
  const settled = done + failed
  return {
    total,
    done,
    failed,
    running,
    successRate: settled ? Math.round((done / settled) * 100) : 0,
  }
}

export function factoryHealth(now = Date.now()): FactoryHealth {
  const events = readActivity(2000)
  const agentRuns = listRuns()
  const cronRuns = readCronRuns(undefined, 1000)

  const recentCronFailures = cronRuns.filter(
    (r) => r.status === 'failed' && r.startedAt >= now - DAY,
  ).length

  // recent failures across agent + cron runs (last 24h), newest first
  const recentFailures = [
    ...agentRuns
      .filter(
        (r) =>
          (r.status === 'failed' || r.status === 'interrupted') &&
          (r.endedAt || r.startedAt) >= now - DAY,
      )
      .map((r) => ({
        title: r.agentTitle,
        ts: r.endedAt || r.startedAt,
        repo: r.repoRoot.split('/').pop() || '',
        kind: 'agent',
      })),
    ...cronRuns
      .filter((r) => r.status === 'failed' && r.startedAt >= now - DAY)
      .map((r) => ({
        title: r.agentTitle,
        ts: r.endedAt || r.startedAt,
        repo: r.repoLabel,
        kind: 'cron',
      })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20)

  // events/day for the last 14 days (oldest → newest)
  const daily: { day: string; count: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const start = now - i * DAY
    const d = new Date(start)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayEnd = dayStart + DAY
    daily.push({
      day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count: events.filter((e) => e.ts >= dayStart && e.ts < dayEnd).length,
    })
  }

  // top repos by event volume (last 7d)
  const repoCounts = new Map<string, number>()
  for (const e of events)
    if (e.ts >= now - 7 * DAY && e.repo) repoCounts.set(e.repo, (repoCounts.get(e.repo) || 0) + 1)
  const byRepo = [...repoCounts.entries()]
    .map(([repo, events]) => ({ repo, events }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 8)

  const { cycle, funnel } = cycleAndFunnel(events, now)

  return {
    generatedAt: now,
    window24h: windowStats(events, now - DAY),
    window7d: windowStats(events, now - 7 * DAY),
    agents: runStats(agentRuns),
    cron: { ...runStats(cronRuns), recentFailures: recentCronFailures },
    hitlOpen: hitlOpenCount(),
    cycle,
    funnel,
    recentFailures,
    daily,
    byRepo,
  }
}
