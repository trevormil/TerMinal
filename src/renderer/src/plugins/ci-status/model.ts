import type { CiRun } from '../../lib/types'

export function latestCiRun(runs: CiRun[]): CiRun | null {
  return runs.reduce<CiRun | null>(
    (latest, run) => (!latest || run.createdAt > latest.createdAt ? run : latest),
    null,
  )
}
