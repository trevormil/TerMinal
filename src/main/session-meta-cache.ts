// (size, mtime)-keyed parse cache with disk persistence.
//
// Listing sessions for the entry picker used to re-read a ~384KB window of
// EVERY transcript on every open — hundreds of MB of I/O + JSON.parse per
// call. A transcript's picker metadata only changes when the file does, so
// cache the parsed result per file keyed by (size, mtimeMs) and persist the
// cache so the first open after an app restart is cheap too.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type Entry<T> = { size: number; mtimeMs: number; meta: T | null }

export type MetaCache<T> = {
  /** Cached parse: `parse` runs only when (size, mtimeMs) changed for `file`. */
  get(file: string, size: number, mtimeMs: number, parse: () => T | null): T | null
  /** Write the cache to disk now (normally debounced). */
  flush(): void
}

export function createMetaCache<T>(cacheFile: string, maxEntries = 5000): MetaCache<T> {
  let map: Map<string, Entry<T>> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const load = (): Map<string, Entry<T>> => {
    if (map) return map
    map = new Map()
    try {
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (parsed && typeof parsed === 'object')
        for (const [k, v] of Object.entries(parsed)) map.set(k, v as Entry<T>)
    } catch {
      /* cold cache */
    }
    return map
  }

  const save = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!map) return
    // Entries for deleted files accrete forever — keep the newest N.
    if (map.size > maxEntries) {
      map = new Map(
        [...map.entries()].sort((a, b) => b[1].mtimeMs - a[1].mtimeMs).slice(0, maxEntries),
      )
    }
    try {
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(map)))
    } catch {
      /* best effort — worst case the next cold start re-parses */
    }
  }

  const scheduleSave = (): void => {
    if (saveTimer) return
    saveTimer = setTimeout(save, 2000)
    saveTimer.unref?.()
  }

  return {
    get(file, size, mtimeMs, parse) {
      const m = load()
      const hit = m.get(file)
      if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.meta
      const meta = parse()
      m.set(file, { size, mtimeMs, meta })
      scheduleSave()
      return meta
    },
    flush: save,
  }
}
