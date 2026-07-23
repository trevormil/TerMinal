import type { HitlSource } from './hitl'

// Pure severity logic, split out so it's testable without importing hitl.ts
// (which transitively pulls in Electron via the activity feed).
//
// Three tiers, and a CONFIGURABLE notify threshold, so the inbox behaves like
// real email: only what you've said is loud enough interrupts you; the rest
// waits for your next sweep.
//   'urgent' — emergency / a real block: notifies (push/Telegram/desktop).
//   'normal' — worth seeing, not worth a buzz: inbox-only unless you lower the
//              threshold.
//   'low'    — FYI / a completion reminder: inbox-only.
// Every item persists in the inbox regardless; severity only gates the alert.
export type HitlSeverity = 'urgent' | 'normal' | 'low'

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
 *  FYI; a genuine block wants you now. */
export function defaultSeverity(source: HitlSource): HitlSeverity {
  return source === 'completion-hook' ? 'low' : 'urgent'
}

/** Does an item at this severity fire a notification, given the threshold? */
export function shouldNotify(severity: HitlSeverity, threshold: NotifyThreshold): boolean {
  return RANK[severity] >= RANK[threshold]
}
