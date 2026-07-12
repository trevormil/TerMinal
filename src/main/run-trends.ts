// Run success-rate / duration trends (#6 GH-parity — "this workflow's success
// rate dropped"). Pure bucketing so it's unit-testable; the reader lives in
// cron-runs.ts and feeds it UnifiedRun records.

export type RunTrendPoint = {
  date: string // YYYY-MM-DD (bucket start, local day)
  total: number
  succeeded: number // status 'done'
  failed: number // status 'failed'
  successRate: number // succeeded / (succeeded + failed); 0 when no terminal runs
  avgDurationMs: number // over runs with an endedAt; 0 when none
}

type TrendRun = { startedAt: number; endedAt?: number; status: string }

const DAY_MS = 86_400_000

// Bucket runs into the last `days` local days, oldest→newest (left-to-right for a
// chart). `dayStart` is the ms at local midnight of "today"; passed in so the
// function stays pure (no Date.now / new Date()-now dependence for testing).
export function bucketRunTrends(runs: TrendRun[], days: number, dayStart: number): RunTrendPoint[] {
  const out: RunTrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const start = dayStart - i * DAY_MS
    const end = start + DAY_MS
    const inDay = runs.filter((r) => r.startedAt >= start && r.startedAt < end)
    let succeeded = 0
    let failed = 0
    let durSum = 0
    let durN = 0
    for (const r of inDay) {
      if (r.status === 'done') succeeded++
      else if (r.status === 'failed') failed++
      if (r.endedAt && r.endedAt >= r.startedAt) {
        durSum += r.endedAt - r.startedAt
        durN++
      }
    }
    const terminal = succeeded + failed
    out.push({
      date: new Date(start).toISOString().slice(0, 10),
      total: inDay.length,
      succeeded,
      failed,
      successRate: terminal > 0 ? succeeded / terminal : 0,
      avgDurationMs: durN > 0 ? Math.round(durSum / durN) : 0,
    })
  }
  return out
}
