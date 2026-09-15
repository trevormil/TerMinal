export type UsageSample = { at: number; pct: number }
export function normalizeLookback(value: unknown): number {
  const n = Number(value)
  return [5, 15, 30, 60, 240].includes(n) ? n : 0
}
export function recordUsageSample(
  samples: UsageSample[],
  pct: number | undefined,
  at: number,
  minutes: number,
): UsageSample[] {
  if (!normalizeLookback(minutes) || pct === undefined || !Number.isFinite(pct)) return []
  const previous = samples.at(-1)
  const retained =
    previous && pct < previous.pct
      ? []
      : samples.filter((s) => s.at >= at - minutes * 60_000 && s.at < at)
  return [...retained, { at, pct }]
}
export function observedBurnRate(samples: UsageSample[]): number | null {
  if (samples.length < 2) return null
  const first = samples[0],
    last = samples[samples.length - 1]
  return last.at > first.at ? ((last.pct - first.pct) * 3_600_000) / (last.at - first.at) : null
}
