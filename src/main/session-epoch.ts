// ---------------------------------------------------------------------------
// Restart-under-the-same-key generation counter.
//
// `startSession(key, …)` on a key that already has a live session kills the old
// pty and installs a new one under the SAME key. node-pty still delivers the
// old pty's `onExit` — asynchronously, after the replacement is already in the
// map — and that closure captured `key`, not the pty. So the dead session's
// exit fired `pty:exit`, `finalizeSessionRun` and an "exited" activity event
// against the BRAND NEW terminal: a freshly started session showing as exited
// and dropping out of its loop pairing.
//
// Every start takes an epoch for its key. A callback checks whether its own
// epoch is still the current one and does nothing if it has been superseded.
// ---------------------------------------------------------------------------

export type EpochRegistry = {
  /** Claim the next epoch for `key`, superseding any previous holder. */
  next(key: string): number
  /** Is `epoch` still the live generation for `key`? */
  isCurrent(key: string, epoch: number): boolean
  /** Drop a key entirely (session stopped). */
  forget(key: string): void
  clear(): void
}

export function createEpochRegistry(): EpochRegistry {
  const epochs = new Map<string, number>()
  // Globally monotonic, NOT per-key. A per-key counter resets on `forget`, so a
  // stopped-then-restarted key would hand out epoch 1 again and a stale
  // callback still holding epoch 1 would pass the check. Epoch values are never
  // reused.
  let counter = 0
  return {
    next(key) {
      const epoch = ++counter
      epochs.set(key, epoch)
      return epoch
    },
    // A forgotten key is nobody's current epoch — a late callback from a stopped
    // session must not act either.
    isCurrent(key, epoch) {
      return epochs.get(key) === epoch
    },
    forget(key) {
      epochs.delete(key)
    },
    clear() {
      epochs.clear()
    },
  }
}
