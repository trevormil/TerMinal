// Inbox snooze ("ask me tomorrow") — ticket #0080.
//
// Stored in a sidecar file keyed by HITL id rather than as a field on HitlItem:
// hitl.ts is owned elsewhere, and a sidecar has a real advantage anyway — a
// snooze is a *view* preference, so losing the sidecar degrades to "nothing is
// snoozed" and never loses an actual inbox item.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** id → ms-epoch instant the item becomes due again. */
export type SnoozeMap = Record<string, number>

export function readSnoozes(file: string): SnoozeMap {
  try {
    if (!existsSync(file)) return {}
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: SnoozeMap = {}
    for (const [id, until] of Object.entries(raw))
      if (typeof until === 'number' && Number.isFinite(until)) out[id] = until
    return out
  } catch {
    return {}
  }
}

function write(file: string, map: SnoozeMap): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(map, null, 2))
}

/** Drop entries that have already come due. Keeps the file from growing without
 *  bound and makes "is this snoozed" a pure map lookup for callers. */
export function pruneSnoozes(map: SnoozeMap, now = Date.now()): SnoozeMap {
  const out: SnoozeMap = {}
  for (const [id, until] of Object.entries(map)) if (until > now) out[id] = until
  return out
}

/** Snooze until `until` (ms epoch). A non-future instant un-snoozes instead —
 *  "snooze until the past" is the natural spelling of "wake it now". */
export function setSnooze(file: string, id: string, until: number, now = Date.now()): SnoozeMap {
  const map = pruneSnoozes(readSnoozes(file), now)
  if (Number.isFinite(until) && until > now) map[id] = until
  else delete map[id]
  write(file, map)
  return map
}

export function clearSnooze(file: string, id: string, now = Date.now()): SnoozeMap {
  return setSnooze(file, id, 0, now)
}

export function isSnoozedAt(map: SnoozeMap, id: string, now = Date.now()): boolean {
  const until = map[id]
  return typeof until === 'number' && until > now
}

/** Common presets offered in the inbox. Computed from `now` so a snooze taken
 *  at 23:55 still means tomorrow morning, not five minutes from now. */
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
