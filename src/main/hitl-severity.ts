import type { HitlSource } from './hitl'
import type { HitlSeverity } from '../shared/types/activity'
export type { HitlSeverity } from '../shared/types/activity'

/** Minimum severity that fires a notification. Default 'urgent' — only the loud
 *  stuff pings; everything else is email you check once or twice a day. */
export type NotifyThreshold = HitlSeverity

const RANK: Record<HitlSeverity, number> = { urgent: 3, normal: 2, low: 1 }

/** Normalize any stored/legacy value to a tier. Legacy 'push' → 'urgent',
 *  legacy 'normal' stays, absent → 'urgent' so nothing that used to notify goes
 *  silent after the upgrade. */
export function itemSeverity(item: { severity?: string }): HitlSeverity {
  switch (item.severity) {
    case 'urgent':
    case 'push': // legacy
      return 'urgent'
    case 'normal':
      return 'normal'
    case 'low':
      return 'low'
    default:
      return 'urgent'
  }
}

/** Default severity when a filer doesn't specify one. A completion reminder is
 *  FYI; a recurring-pattern digest is worth reading but never worth a buzz; a
 *  genuine block wants you now. */
export function defaultSeverity(source: HitlSource): HitlSeverity {
  if (source === 'completion-hook') return 'low'
  // The nightly review-findings miner promotes recurring findings ("this
  // category came up 6× across 3 repos — promote to CLAUDE.md?"). That's a
  // digest, not a block: nothing is stuck waiting on it and it will still be
  // true tomorrow. It's the archetypal middle tier, and the producer that makes
  // the 'normal' threshold behave differently from 'urgent' at all.
  if (source === 'review-pattern') return 'normal'
  return 'urgent'
}

/** Does an item at this severity fire a notification, given the threshold? */
export function shouldNotify(severity: HitlSeverity, threshold: NotifyThreshold): boolean {
  return RANK[severity] >= RANK[threshold]
}
