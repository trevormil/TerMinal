export function viewedProgress(viewed: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, (viewed / total) * 100)) : 0
}
