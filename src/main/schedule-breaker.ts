// Merge circuit-breaker state into a schedule row.
//
// `schedules.json` carries the user's own on/off switch; the BREAKER lives in a
// separate disabled.json — the local one (agents-disabled.ts) and, for a
// schedule assigned to a host, the host's own (host-disabled.ts). A view that
// reads only `enabled` renders a schedule the runner gave up on as healthy.
// src/main/ipc/schedules.ts merges the two for the desktop; this is the same
// merge, shaped for any row with an id and an `enabled` flag.

export type BreakerEntry = { id: string; reason?: string; hostLabel?: string }

export type BreakerAware<T> = T & {
  /** Why the breaker tripped, when it did. Absent for a plain manual pause. */
  disabledReason?: string
}

/** Reason text for one tripped schedule — host-labelled, since "paused" on a
 *  phone is meaningless without saying which machine gave up. */
function reasonOf(e: BreakerEntry): string | undefined {
  const parts = [e.hostLabel, e.reason].filter((s): s is string => !!s && !!s.trim())
  return parts.length ? parts.join(' · ') : undefined
}

export function applyBreaker<T extends { id: string; enabled: boolean }>(
  schedules: T[],
  entries: BreakerEntry[],
): BreakerAware<T>[] {
  if (!entries.length) return schedules
  const byId = new Map(entries.map((e) => [e.id, e]))
  return schedules.map((s) => {
    const hit = byId.get(s.id)
    if (!hit) return s
    const reason = reasonOf(hit)
    return { ...s, enabled: false, ...(reason ? { disabledReason: reason } : {}) }
  })
}
