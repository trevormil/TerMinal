import { useEffect, useState } from 'react'
import { ALL as ALL_INBOX_CATEGORIES } from '../../../shared/inbox-categories'
import { NO_PROMPT } from './spawnOptions'

// Typed registry for renderer-local UI preferences.
//
// The renderer had ~120 raw `localStorage.getItem(...)` calls, each re-deciding
// its own key string, its own default, its own parse, and its own try/catch —
// which is how a key gets typo'd in one of the two places it appears, and how a
// corrupt value takes a tab down. A pref is declared once here, and everything
// else reads it by NAME with a real type.
//
// Adoption is incremental by design: a call site converts by swapping its
// getItem/setItem pair for getPref/setPref (or usePref), and the key string and
// on-disk encoding stay byte-identical so nobody loses a setting.

type PrefDef<T> = {
  key: string
  fallback: T
  /** `raw` is never null — a missing value already resolved to `fallback`. */
  read: (raw: string) => T
  write: (value: T) => string
}

const str = (key: string, fallback: string): PrefDef<string> => ({
  key,
  fallback,
  read: (raw) => raw,
  write: (v) => v,
})

const num = (key: string, fallback: number): PrefDef<number> => ({
  key,
  fallback,
  read: (raw) => {
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  },
  write: (v) => String(v),
})

const strArray = (key: string, fallback: string[]): PrefDef<string[]> => ({
  key,
  fallback,
  read: (raw) => {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return fallback
    return v.filter((x): x is string => typeof x === 'string')
  },
  write: (v) => JSON.stringify(v),
})

/**
 * The registry. Key strings are load-bearing: they are what is already on disk
 * in every existing install, so they must never be "tidied".
 */
export const PREFS = {
  // '__auto__' = follow the current repo; '' = all repos.
  schedulesRepoFilter: str('gt.schedules.repoFilter', '__auto__'),
  runsRepoFilter: str('gt.runs.repoFilter', '__auto__'),
  activityLastSeen: num('gt.activity.lastSeen', 0),
  inboxCategory: str('gt.inbox.category', ALL_INBOX_CATEGORIES),
  inboxCollapsed: strArray('gt.inbox.collapsed', []),
  // Last pane the user chose in the MR/PR detail view. 'overview' — the change
  // map and filtered analytics — is where a review should start, so it is the
  // default; an explicit choice sticks until the user changes it again.
  mrDetailPane: str('gt.mrs.detailPane', 'overview'),
  // Spawn options on the New session screen. Per-machine, not per-repo: how
  // many sessions you like to fan out and which prompt you prefill is a habit,
  // not a property of the repo you happen to open.
  spawnCount: num('gt.spawn.count', 1),
  spawnPromptId: str('gt.spawn.promptId', NO_PROMPT),
} satisfies Record<string, PrefDef<never> | PrefDef<string> | PrefDef<number> | PrefDef<string[]>>

export type PrefName = keyof typeof PREFS
export type PrefValue<K extends PrefName> = (typeof PREFS)[K] extends PrefDef<infer T> ? T : never

type MiniStorage = Pick<Storage, 'getItem' | 'setItem'>

function storage(): MiniStorage | null {
  try {
    // Resolved per call, not captured: the renderer can run before storage
    // exists, and tests install their own.
    return (globalThis as { localStorage?: MiniStorage }).localStorage ?? null
  } catch {
    return null
  }
}

export function getPref<K extends PrefName>(name: K): PrefValue<K> {
  const def = PREFS[name] as unknown as PrefDef<PrefValue<K>>
  try {
    const raw = storage()?.getItem(def.key)
    if (raw === null || raw === undefined) return def.fallback
    return def.read(raw)
  } catch {
    // Corrupt or unreadable storage falls back to the default rather than
    // throwing into a render.
    return def.fallback
  }
}

const listeners = new Map<PrefName, Set<(value: never) => void>>()

function notify<K extends PrefName>(name: K, value: PrefValue<K>): void {
  for (const cb of listeners.get(name) ?? []) (cb as (v: PrefValue<K>) => void)(value)
}

export function setPref<K extends PrefName>(name: K, value: PrefValue<K>): void {
  const def = PREFS[name] as unknown as PrefDef<PrefValue<K>>
  try {
    storage()?.setItem(def.key, def.write(value))
  } catch {
    // Quota or disabled storage: the in-memory state below still updates, so
    // the UI stays consistent for this session.
  }
  notify(name, value)
}

export function subscribePref<K extends PrefName>(
  name: K,
  cb: (value: PrefValue<K>) => void,
): () => void {
  const set = listeners.get(name) ?? new Set()
  listeners.set(name, set)
  set.add(cb as (value: never) => void)
  return () => set.delete(cb as (value: never) => void)
}

/**
 * Fan a foreign-window write out to this window's subscribers. The `storage`
 * event never fires in the window that wrote, so same-window updates come from
 * `setPref` and cross-window ones come from here.
 */
export function __notifyStorageEvent(key: string | null): void {
  if (!key) return
  for (const name of Object.keys(PREFS) as PrefName[]) {
    if (PREFS[name].key === key) notify(name, getPref(name))
  }
}

let storageBound = false
function bindStorageEvent(): void {
  if (storageBound || typeof window === 'undefined') return
  storageBound = true
  window.addEventListener('storage', (e) => __notifyStorageEvent(e.key))
}

/** React state bound to a pref: reads it, writes it, and stays in sync across windows. */
export function usePref<K extends PrefName>(
  name: K,
): [PrefValue<K>, (value: PrefValue<K>) => void] {
  const [value, setValue] = useState<PrefValue<K>>(() => getPref(name))
  useEffect(() => {
    bindStorageEvent()
    setValue(getPref(name))
    return subscribePref(name, setValue)
  }, [name])
  return [value, (next: PrefValue<K>) => setPref(name, next)]
}
