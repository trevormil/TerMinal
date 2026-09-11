type CostRun = { startedAt: number; costUsd: number }
export function dailyCost(runs: CostRun[], now = Date.now()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  week.setDate(week.getDate() - 6)
  const result = { todayUsd: 0, weekUsd: 0, todayRuns: 0, weekRuns: 0 }
  for (const run of runs) {
    if (
      !Number.isFinite(run.startedAt) ||
      !Number.isFinite(run.costUsd) ||
      run.costUsd < 0 ||
      run.startedAt > now ||
      run.startedAt < week.getTime()
    )
      continue
    result.weekUsd += run.costUsd
    result.weekRuns++
    if (run.startedAt >= today.getTime()) {
      result.todayUsd += run.costUsd
      result.todayRuns++
    }
  }
  return result
}
export function formatCost(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
