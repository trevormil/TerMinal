// SLA aging for the inbox (ticket #0080). An urgent item from three days ago
// looked identical to one from three minutes ago; this is the axis that makes
// the difference visible.

export type AgeTier = 'fresh' | 'today' | 'aging' | 'stale'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Buckets are absolute, not severity-scaled: the point is "how long has this
 * been sitting", and mixing severity in would hide an old low-severity item
 * that has genuinely been ignored for a week.
 */
export function ageTierOf(createdAt: number, now = Date.now()): AgeTier {
  const age = now - (createdAt || 0)
  if (age < 4 * HOUR) return 'fresh'
  if (age < DAY) return 'today'
  if (age < 3 * DAY) return 'aging'
  return 'stale'
}

/** Colour for the age indicator. `fresh` is deliberately uncoloured — a new
 *  item needs no warning, and colouring everything means colouring nothing. */
export function ageColor(tier: AgeTier): string | undefined {
  return tier === 'stale'
    ? 'var(--gt-red)'
    : tier === 'aging'
      ? '#d6a84a'
      : tier === 'today'
        ? '#71717a'
        : undefined
}

export function ageLabel(tier: AgeTier): string {
  return tier === 'stale'
    ? 'Sitting for 3+ days'
    : tier === 'aging'
      ? 'Sitting for over a day'
      : tier === 'today'
        ? 'Filed earlier today'
        : 'Filed in the last few hours'
}

/** Human "due in" text for a snooze instant. */
export function untilLabel(until: number, now = Date.now()): string {
  const ms = until - now
  if (ms <= 0) return 'due'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.round(ms / HOUR)
  if (hours < 24) return `${hours}h`
  return `${Math.round(ms / DAY)}d`
}
