import type { CiJob } from './types'

/** Group CI jobs by stage, ordered by run order (ascending job id) so stages
 *  appear lint → test → build → deploy. Pure — unit-tested. */
export function groupJobsByStage(jobs: CiJob[]): { stage: string; jobs: CiJob[] }[] {
  const stages: { stage: string; jobs: CiJob[] }[] = []
  for (const j of [...jobs].sort((a, b) => a.id - b.id)) {
    let g = stages.find((s) => s.stage === j.stage)
    if (!g) stages.push((g = { stage: j.stage, jobs: [] }))
    g.jobs.push(j)
  }
  return stages
}
