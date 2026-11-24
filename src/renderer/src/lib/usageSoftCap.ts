export function normalizeSoftCap(value: unknown): number {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0
}

export function exceedsSoftCap(pct: number | undefined, cap: number): boolean {
  return normalizeSoftCap(cap) > 0 && typeof pct === 'number' && Number.isFinite(pct) && pct >= cap
}
