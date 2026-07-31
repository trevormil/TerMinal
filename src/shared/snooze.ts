// Snooze presets (ticket #0080). Lives in shared/ because BOTH sides need it:
// main exposes it over IPC, and the renderer recomputes it at click time.
// Pure — no node builtins — so importing it from the renderer is safe.

/**
 * Common snooze targets, computed from `now`.
 *
 * MUST be called at the moment the menu opens, not cached at mount: these are
 * absolute instants, so a value computed hours ago has drifted into the past
 * and snoozing to the past is a silent no-op.
 */
export function snoozePresets(now = Date.now()): { id: string; label: string; until: number }[] {
  const tomorrow9 = new Date(now)
  tomorrow9.setDate(tomorrow9.getDate() + 1)
  tomorrow9.setHours(9, 0, 0, 0)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  nextWeek.setHours(9, 0, 0, 0)
  return [
    { id: '1h', label: '1 hour', until: now + 60 * 60 * 1000 },
    { id: '4h', label: '4 hours', until: now + 4 * 60 * 60 * 1000 },
    { id: 'tomorrow', label: 'Tomorrow 9am', until: tomorrow9.getTime() },
    { id: 'week', label: 'Next week', until: nextWeek.getTime() },
  ]
}
