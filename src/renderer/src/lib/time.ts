// Timestamp formatting for the ticket log. A log is read in two very different
// modes — watching a run happen now, and reading back what happened weeks ago —
// so recent entries stay relative and older ones become real dates.

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const timeOfDay = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * The stamp shown on a log entry, relative to `now` (injectable so this is
 * testable and so a list can share one clock). Falls back to the raw string
 * for anything unparseable — a hand-edited or remote entry must still render.
 */
export function logTimestamp(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  // Clamp: a clock skew between hosts shouldn't render as negative time.
  const elapsed = Math.max(0, now - then)
  const d = new Date(then)

  if (elapsed < MIN) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MIN)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`

  // "Yesterday" is calendar-relative, not 24-hours-relative — 25h ago at 2am
  // is still yesterday to a reader.
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const daysBack = Math.floor((startOfToday.getTime() - then) / DAY) + 1
  if (daysBack === 1) return `Yesterday at ${timeOfDay(d)}`
  if (daysBack < 7) return `${daysBack}d ago`

  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  if (sameYear)
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${timeOfDay(d)}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Unambiguous absolute stamp, for the hover title behind the short one. */
export function fullTimestamp(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  return new Date(then).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * The compact `5s / 12m / 3h / 2d ago` ladder, shared by every tab that shows
 * a "last seen" stamp. Deliberately has **no** empty/missing-input handling:
 * each call site means something different by "no timestamp" ('', 'never',
 * 'unknown'), so that stays at the call site and only the ladder is shared.
 *
 * For the ticket log — which switches to absolute dates once entries age —
 * see `logTimestamp`.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  // Clamp: a remote host's clock running ahead shouldn't render backwards.
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
