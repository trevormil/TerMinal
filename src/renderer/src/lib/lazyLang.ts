import { useEffect, useState } from 'react'
import type { Extension } from '@codemirror/state'

// Lazy CodeMirror grammars (ticket #0072).
//
// `@uiw/codemirror-extensions-langs` is a barrel that statically imports every
// @codemirror/lang-* and legacy-mode package at module top — ~7.2 MB — and four
// tabs imported it eagerly, so every renderer boot paid for grammars most
// sessions never touch.
//
// NOTE for anyone tempted by the package's own `loadLanguage(name)`: it is NOT
// dynamic. Its implementation is `langs[name] ? langs[name]() : null` inside a
// module that has already imported all of them, so switching to it changes
// nothing. The only thing that actually defers the cost is deferring the
// *module*, which is what this does — the whole grammar set becomes one async
// chunk, fetched the first time an editor needs highlighting.

type LangsBarrel = typeof import('@uiw/codemirror-extensions-langs')
type Langs = LangsBarrel['langs']

let cached: Langs | null = null
let inflight: Promise<Langs> | null = null

/** Load (once) the grammar barrel. Concurrent callers share one import. */
export function loadLangs(): Promise<Langs> {
  if (cached) return Promise.resolve(cached)
  inflight ??= import('@uiw/codemirror-extensions-langs')
    .then((m) => {
      cached = m.langs
      inflight = null
      return m.langs
    })
    .catch((e) => {
      // Never poison the cache — a transient chunk-load failure should not
      // permanently disable highlighting for the session.
      inflight = null
      throw e
    })
  return inflight
}

/** Synchronously available only after a previous load resolved. */
export function loadedLangs(): Langs | null {
  return cached
}

/**
 * Grammar extensions for a resolved language key, read from the cache.
 *
 * Synchronous and hook-free on purpose: the existing call sites resolve a
 * grammar deep inside conditional render branches, and turning those into hooks
 * would break hook ordering. Instead a component calls `useLangsReady()` once,
 * unconditionally, and these lookups start returning grammars once the chunk
 * lands.
 *
 * Before the chunk resolves this returns `[]` — the editor shows plain text for
 * a frame or two, then reconfigures with highlighting.
 */
export function langExtensionFor(key: string): Extension[] {
  if (!key || !cached) return []
  const make = (cached as Record<string, undefined | (() => Extension)>)[key]
  if (!make) return []
  try {
    return [make()]
  } catch {
    return []
  }
}

/**
 * Call once, unconditionally, in any component that renders an editor: kicks
 * off the grammar load and re-renders when it lands.
 */
export function useLangsReady(): boolean {
  const [ready, setReady] = useState(() => cached !== null)
  useEffect(() => {
    if (ready) return
    let canceled = false
    loadLangs()
      .then(() => {
        if (!canceled) setReady(true)
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [ready])
  return ready
}
