import type { HitlSource } from './hitl'

// Pure severity logic, split out so it's testable without importing hitl.ts
// (which transitively pulls in Electron via the activity feed).
//
//   'push'   — needs you now: sends a notification (macOS/Telegram/phone push).
//   'normal' — inbox-only fallback you sweep once or twice a day; no ping.
// Every item persists in the inbox regardless; severity only gates the alert.
export type HitlSeverity = 'push' | 'normal'

/** Legacy items (and any without an explicit severity) count as 'push' so an
 *  upgrade never silently downgrades something that used to notify. */
export function itemSeverity(item: { severity?: HitlSeverity }): HitlSeverity {
  return item.severity ?? 'push'
}

/** Default severity when a filer doesn't specify one. A completion reminder is
 *  a quiet review nudge; a genuine block wants you now. */
export function defaultSeverity(source: HitlSource): HitlSeverity {
  return source === 'completion-hook' ? 'normal' : 'push'
}
