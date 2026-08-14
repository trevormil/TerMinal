// Reading monitors.json and the per-monitor state files. The daemon OWNS every
// write under monitor-state/; monitors.json it only ever reads (the app is the
// single writer, through its lock).
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONNECTIVITY_FILE, MONITORS_FILE, STATE_DIR, log } from './paths'
import type { Connectivity, StoredMonitor, StoredState } from './types'

export function readMonitors(): StoredMonitor[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(MONITORS_FILE(), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (m): m is StoredMonitor =>
        !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string',
    )
  } catch {
    return []
  }
}

export function readState(id: string): StoredState | null {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR(), `${id}.json`), 'utf8')) as StoredState
  } catch {
    return null
  }
}

// Temp + rename: a plain write truncates first, so a kill mid-write leaves a
// state file the daemon can no longer parse and the monitor silently resets.
export function writeState(id: string, state: StoredState): void {
  mkdirSync(STATE_DIR(), { recursive: true })
  const file = join(STATE_DIR(), `${id}.json`)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* the temp file may never have been created */
    }
    log(`state write failed for ${id}: ${e}`)
  }
}

export function readConnectivity(): Connectivity {
  try {
    return JSON.parse(readFileSync(CONNECTIVITY_FILE(), 'utf8')) as Connectivity
  } catch {
    return { offline: false }
  }
}

export function writeConnectivity(next: Connectivity): void {
  try {
    writeFileSync(CONNECTIVITY_FILE(), `${JSON.stringify(next, null, 2)}\n`)
  } catch {
    /* best effort — the verdict is a UI convenience, not the gate itself */
  }
}
