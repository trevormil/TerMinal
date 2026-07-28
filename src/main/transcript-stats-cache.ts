export class TranscriptStatsLruCache<T> {
  private readonly entries = new Map<string, { mtime: number; value: T }>()

  constructor(private readonly capacity = 8) {}

  get(sessionId: string, mtime: number, load: () => T): T {
    const hit = this.entries.get(sessionId)
    if (hit && hit.mtime === mtime) {
      this.touch(sessionId)
      return hit.value
    }

    const value = load()
    this.entries.delete(sessionId)
    this.entries.set(sessionId, { mtime, value })
    this.evict()
    return value
  }

  touch(sessionId: string): void {
    const hit = this.entries.get(sessionId)
    if (!hit) return
    this.entries.delete(sessionId)
    this.entries.set(sessionId, hit)
  }

  clear(): void {
    this.entries.clear()
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value
      if (!oldest) return
      this.entries.delete(oldest)
    }
  }
}
