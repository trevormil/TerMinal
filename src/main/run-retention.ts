// Run retention policy (pure — no electron/fs, so it's unit-testable).
//
// Run logs on disk are NEVER auto-deleted (storage is cheap; the user prunes
// manually when space is tight). This only bounds the in-memory working set so a
// large on-disk archive doesn't bloat the process RAM.

// The most recent `keep` runs (by startedAt) to hold in memory. `keep <= 0` loads
// all. Returns a new ascending-sorted array; never mutates the input, never deletes.
export function inMemoryWorkingSet<T extends { startedAt: number }>(metas: T[], keep: number): T[] {
  const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
  return keep > 0 && sorted.length > keep ? sorted.slice(-keep) : sorted
}
