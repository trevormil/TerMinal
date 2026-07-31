import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { configPath } from './config-dir'

// Kill-switch / circuit-breaker registry. A scheduleId in this list is
// skipped by bin/terminal-cron at run time. Headless runner writes here when
// it auto-disables a schedule after N consecutive failures; the Schedules tab
// reads + toggles via IPC.
//
// On-disk shape is { scheduleIds: string[], reasons: { [id]: { reason?, at } } }.
// scheduleIds stays the source of truth for "is this disabled" so the plain
// JSON reader in bin/terminal-cron keeps working; reasons is a side-car so a
// dark agent can explain ITSELF in the UI instead of just vanishing.

// Resolved per call (not at module load) through the one config-dir seam, so a
// test can point this at a temp dir. See src/main/config-dir.ts.
export const disabledFile = (): string => configPath('agents', 'disabled.json')

export type DisabledEntry = {
  id: string
  reason?: string
  /** epoch ms; 0 when read from a legacy record that predates reasons. */
  disabledAt: number
}

type Stored = { ids: string[]; reasons: Record<string, { reason?: string; at: number }> }

function readStored(): Stored {
  try {
    const file = disabledFile()
    if (!existsSync(file)) return { ids: [], reasons: {} }
    const a = JSON.parse(readFileSync(file, 'utf8'))
    const rawIds = Array.isArray(a) ? a : Array.isArray(a?.scheduleIds) ? a.scheduleIds : []
    const ids = rawIds.filter((x: unknown): x is string => typeof x === 'string')
    const reasons: Stored['reasons'] = {}
    const rawReasons =
      !Array.isArray(a) && a?.reasons && typeof a.reasons === 'object' ? a.reasons : {}
    for (const id of ids) {
      const r = (rawReasons as Record<string, unknown>)[id]
      if (r && typeof r === 'object') {
        const { reason, at } = r as { reason?: unknown; at?: unknown }
        reasons[id] = {
          reason: typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
          at: typeof at === 'number' ? at : 0,
        }
      }
    }
    return { ids, reasons }
  } catch {
    return { ids: [], reasons: {} }
  }
}

function writeStored(s: Stored): void {
  try {
    const file = disabledFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ scheduleIds: s.ids, reasons: s.reasons }, null, 2))
  } catch {
    /* best effort — the runner re-creates as needed */
  }
}

export function listDisabled(): string[] {
  return readStored().ids
}

/** Disabled ids with WHY and WHEN — what the UI needs to render a state chip. */
export function listDisabledDetail(): DisabledEntry[] {
  const { ids, reasons } = readStored()
  return ids.map((id) => ({
    id,
    reason: reasons[id]?.reason,
    disabledAt: reasons[id]?.at ?? 0,
  }))
}

export function isDisabled(id: string): boolean {
  return readStored().ids.includes(id)
}

function apply(s: Stored, id: string, disabled: boolean, reason?: string, at = Date.now()): void {
  if (disabled) {
    // Preserve the ORIGINAL reason — a later reasonless toggle (e.g. a bulk
    // pause sweeping an already-broken schedule) must not erase why it broke.
    if (!s.ids.includes(id)) s.ids.push(id)
    const prev = s.reasons[id]
    if (!prev) s.reasons[id] = { reason: reason?.trim() || undefined, at }
    else if (!prev.reason && reason?.trim()) s.reasons[id] = { reason: reason.trim(), at }
  } else {
    s.ids = s.ids.filter((x) => x !== id)
    delete s.reasons[id]
  }
}

export function setDisabled(id: string, disabled: boolean, reason?: string): string[] {
  const s = readStored()
  apply(s, id, disabled, reason)
  writeStored(s)
  return s.ids
}

// Bulk variant. Lets the Schedules tab's "Pause all" button kill-switch every
// known schedule in one click (and the inverse to bring them all back online).
// The runner re-reads this file every fire, so paused state takes effect on
// the next launchd tick without an app/launchd restart.
export function setAllDisabled(ids: string[], disabled: boolean, reason?: string): string[] {
  const s = readStored()
  const at = Date.now()
  for (const id of ids) apply(s, id, disabled, reason, at)
  writeStored(s)
  return s.ids
}
