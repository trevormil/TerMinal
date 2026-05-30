// CI listing — pipeline / workflow runs for the current repo, forge-agnostic.
// Per-MR CI lives in forge.ts → ci(); this module is the full recent-runs view
// surfaced in the CI tab.

import { run, forgeFor, type RunResult } from './forge'
import { repoForCwd } from './repo'

export type CiRunStatus =
  | 'queued'
  | 'in_progress'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'pending'

export type CiRun = {
  id: string // forge-native id (string for compat across hosts)
  name: string // workflow name (gh) / pipeline ref-name (glab fallback)
  status: CiRunStatus
  branch: string
  shortSha: string // 7-char head SHA
  event: string // push | pull_request | schedule | workflow_dispatch | (glab: source)
  webUrl: string
  createdAt: number // ms epoch
  updatedAt: number // ms epoch
  durationMs: number | null // null when still running
}

export type CiJob = {
  id: string
  name: string
  stage: string
  status: CiRunStatus
  webUrl: string
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
}

export type CiListResult = { runs: CiRun[]; error?: string }
export type CiJobsResult = { jobs: CiJob[]; error?: string }

// --- normalize forge-specific status strings ---------------------------------

function ghStatus(status: string, conclusion: string | null | undefined): CiRunStatus {
  if (status === 'completed') {
    if (conclusion === 'success') return 'success'
    if (conclusion === 'failure' || conclusion === 'timed_out') return 'failed'
    if (conclusion === 'cancelled') return 'canceled'
    if (conclusion === 'skipped' || conclusion === 'neutral') return 'skipped'
    return 'failed'
  }
  if (status === 'in_progress') return 'in_progress'
  if (status === 'queued' || status === 'waiting' || status === 'requested') return 'queued'
  return 'pending'
}

function glabStatus(s: string): CiRunStatus {
  switch (s) {
    case 'success':
    case 'manual':
      return 'success'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    case 'skipped':
      return 'skipped'
    case 'running':
      return 'in_progress'
    case 'pending':
    case 'preparing':
    case 'created':
    case 'scheduled':
    case 'waiting_for_resource':
      return 'queued'
    default:
      return 'pending'
  }
}

// --- listing -----------------------------------------------------------------

async function listGh(repoRoot: string, limit: number): Promise<CiListResult> {
  const r = await run(
    'gh',
    [
      'run',
      'list',
      '--limit',
      String(limit),
      '--json',
      'databaseId,status,conclusion,workflowName,headBranch,headSha,event,url,createdAt,updatedAt',
    ],
    repoRoot,
    { maxBuffer: 8 * 1024 * 1024 },
  )
  if (r.err && !r.stdout) return { runs: [], error: ciErr('gh', r) }
  let arr: any[]
  try {
    arr = JSON.parse(r.stdout || '[]')
  } catch {
    return { runs: [], error: 'gh: parse failed' }
  }
  const runs = arr.map((x): CiRun => {
    const created = Date.parse(x.createdAt || '') || 0
    const updated = Date.parse(x.updatedAt || '') || created
    const status = ghStatus(x.status || '', x.conclusion)
    return {
      id: String(x.databaseId ?? ''),
      name: x.workflowName || '',
      status,
      branch: x.headBranch || '',
      shortSha: (x.headSha || '').slice(0, 7),
      event: x.event || '',
      webUrl: x.url || '',
      createdAt: created,
      updatedAt: updated,
      durationMs: status === 'in_progress' || status === 'queued' ? null : Math.max(0, updated - created),
    }
  })
  return { runs }
}

async function listGlab(repoRoot: string, limit: number): Promise<CiListResult> {
  const repo = repoForCwd(repoRoot)
  if (!repo) return { runs: [], error: 'no repo' }
  const proj = encodeURIComponent(repo.path)
  const r = await run('glab', ['api', `projects/${proj}/pipelines?per_page=${limit}`], repoRoot, {
    maxBuffer: 8 * 1024 * 1024,
  })
  if (r.err && !r.stdout) return { runs: [], error: ciErr('glab', r) }
  let arr: any[]
  try {
    arr = JSON.parse(r.stdout || '[]')
  } catch {
    return { runs: [], error: 'glab: parse failed' }
  }
  // The list endpoint is sparse; enrich each with duration/finished if cheap to do so.
  // To avoid N+1 API calls per refresh, derive durationMs from updated-created when
  // status is terminal. The detailed jobs view is fetched on click.
  const runs = arr.map((p): CiRun => {
    const created = Date.parse(p.created_at || '') || 0
    const updated = Date.parse(p.updated_at || '') || created
    const status = glabStatus(p.status || '')
    return {
      id: String(p.id ?? ''),
      name: p.ref || '',
      status,
      branch: p.ref || '',
      shortSha: (p.sha || '').slice(0, 7),
      event: p.source || '',
      webUrl: p.web_url || '',
      createdAt: created,
      updatedAt: updated,
      durationMs: status === 'in_progress' || status === 'queued' ? null : Math.max(0, updated - created),
    }
  })
  return { runs }
}

export async function listCiRuns(repoRoot: string, limit = 40): Promise<CiListResult> {
  return forgeFor(repoRoot).kind === 'github' ? listGh(repoRoot, limit) : listGlab(repoRoot, limit)
}

// --- per-run jobs ------------------------------------------------------------

async function jobsGh(repoRoot: string, runId: string): Promise<CiJobsResult> {
  const r = await run(
    'gh',
    [
      'run',
      'view',
      runId,
      '--json',
      'jobs',
    ],
    repoRoot,
    { maxBuffer: 8 * 1024 * 1024 },
  )
  if (r.err && !r.stdout) return { jobs: [], error: ciErr('gh', r) }
  let parsed: any
  try {
    parsed = JSON.parse(r.stdout || '{}')
  } catch {
    return { jobs: [], error: 'gh: parse failed' }
  }
  const raw = Array.isArray(parsed?.jobs) ? parsed.jobs : []
  const jobs = raw.map((j: any): CiJob => {
    const started = Date.parse(j.startedAt || '') || null
    const finished = Date.parse(j.completedAt || '') || null
    return {
      id: String(j.databaseId ?? j.name ?? ''),
      name: j.name || '',
      stage: '',
      status: ghStatus(j.status || '', j.conclusion),
      webUrl: j.url || '',
      startedAt: started,
      finishedAt: finished,
      durationMs: started && finished ? Math.max(0, finished - started) : null,
    }
  })
  return { jobs }
}

async function jobsGlab(repoRoot: string, pipelineId: string): Promise<CiJobsResult> {
  const repo = repoForCwd(repoRoot)
  if (!repo) return { jobs: [], error: 'no repo' }
  const proj = encodeURIComponent(repo.path)
  const r = await run(
    'glab',
    ['api', `projects/${proj}/pipelines/${pipelineId}/jobs?per_page=100`],
    repoRoot,
    { maxBuffer: 8 * 1024 * 1024 },
  )
  if (r.err && !r.stdout) return { jobs: [], error: ciErr('glab', r) }
  let arr: any[]
  try {
    arr = JSON.parse(r.stdout || '[]')
  } catch {
    return { jobs: [], error: 'glab: parse failed' }
  }
  const jobs = arr.map((j): CiJob => {
    const started = Date.parse(j.started_at || '') || null
    const finished = Date.parse(j.finished_at || '') || null
    return {
      id: String(j.id ?? ''),
      name: j.name || '',
      stage: j.stage || '',
      status: glabStatus(j.status || ''),
      webUrl: j.web_url || '',
      startedAt: started,
      finishedAt: finished,
      durationMs: started && finished ? Math.max(0, finished - started) : (j.duration ? Math.round(j.duration * 1000) : null),
    }
  })
  return { jobs }
}

export async function listCiJobs(repoRoot: string, runId: string): Promise<CiJobsResult> {
  return forgeFor(repoRoot).kind === 'github' ? jobsGh(repoRoot, runId) : jobsGlab(repoRoot, runId)
}

// --- helpers -----------------------------------------------------------------

function ciErr(cli: string, r: RunResult): string {
  const code = (r.err as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return `${cli} not found on PATH`
  const msg = `${r.stderr || ''} ${r.err?.message || ''}`.toLowerCase()
  if (/401|unauthor|\bauth\b|token|not logged in|login/.test(msg)) {
    return `${cli} not authenticated for this host`
  }
  return (r.stderr || r.err?.message || `${cli} error`).trim().split('\n')[0] || `${cli} error`
}
