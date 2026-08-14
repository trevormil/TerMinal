export type CiRunStatus =
  'queued' | 'in_progress' | 'success' | 'failed' | 'canceled' | 'skipped' | 'pending'

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

export type CiTabStep = {
  name: string
  status: CiRunStatus
  number: number
}

export type CiTabJob = {
  id: string
  name: string
  stage: string
  status: CiRunStatus
  webUrl: string
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  steps?: CiTabStep[] // GH only; GitLab jobs are themselves the smallest unit
}

export type CiListResult = { runs: CiRun[]; error?: string }

export type CiJobsResult = { jobs: CiTabJob[]; error?: string }

export type CiLogResult = { log: string; truncated?: boolean; error?: string }
