// Where the Monitoring daemon reads and writes.
//
// The config-dir seam itself is `src/runner/config.ts` — the one shared by every
// standalone bundle in this repo, resolved per call so a sandboxed run can
// redirect it (ticket 108). Building the path again here would be a second seam
// to keep honest, which is exactly what the typed-bin refactor is removing.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG } from '../runner/config'

export const MONITORS_FILE = (): string => join(CFG(), 'monitors.json')
export const STATE_DIR = (): string => join(CFG(), 'monitor-state')
export const CLI = (): string => join(CFG(), 'bin', 'terminal-cli')
export const LOG = (): string => join(CFG(), 'monitor.log')
export const TICK_LOCK = (): string => join(CFG(), 'monitor-tick.lock')
export const CONNECTIVITY_FILE = (): string => join(CFG(), 'monitor-connectivity.json')

/** Append one line to monitor.log. Never throws — logging is not the job. */
export function log(msg: string): void {
  try {
    writeFileSync(LOG(), `${new Date().toISOString()} ${msg}\n`, { flag: 'a' })
  } catch {
    /* the daemon must survive an unwritable log */
  }
}
