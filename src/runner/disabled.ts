// The kill switch (agents/disabled.json). Two shapes are accepted on read —
// the legacy bare array and the current { scheduleIds, reasons } object — and
// only the current one is ever written.
import { DISABLED_FILE, readJson } from './config'
import { log } from './log'
import { withFileLockShared, writeJsonAtomicShared } from './state-io'

export type DisabledReason = { reason: string; at: number }
type DisabledFile = { scheduleIds?: string[]; reasons?: Record<string, DisabledReason> }

export function readDisabled(): Set<string> {
  const a = readJson<string[] | DisabledFile>(DISABLED_FILE())
  const ids = Array.isArray(a) ? a : a?.scheduleIds || []
  return new Set(ids)
}

// Side-car reasons map (see src/main/agents-disabled.ts). Preserved verbatim on
// write so a UI-recorded reason survives a runner-side toggle.
export function readDisabledReasons(): Record<string, DisabledReason> {
  const a = readJson<string[] | DisabledFile>(DISABLED_FILE())
  return !Array.isArray(a) && a?.reasons && typeof a.reasons === 'object' ? a.reasons : {}
}

// `extraReasons` are the entries THIS write is adding; everything else is
// re-read from disk inside the lock so a reason the app recorded since our
// snapshot isn't clobbered.
export function writeDisabled(
  set: Set<string>,
  extraReasons: Record<string, DisabledReason> = {},
): void {
  try {
    // Not a JSON list, so the shared list helper doesn't apply — but this is
    // still the kill switch, and a torn write here silently re-enables agents.
    withFileLockShared(DISABLED_FILE(), () => {
      const ids = [...set]
      const reasons = { ...readDisabledReasons(), ...extraReasons }
      const kept: Record<string, DisabledReason> = {}
      for (const id of ids) if (reasons[id]) kept[id] = reasons[id]
      writeJsonAtomicShared(DISABLED_FILE(), { scheduleIds: ids, reasons: kept })
    })
  } catch (e) {
    log(`failed writing disabled: ${e}`)
  }
}
