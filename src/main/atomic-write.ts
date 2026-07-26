import { writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Crash-safe JSON state writes (ticket 0042).
//
// Every one of TerMinal's state files — schedules.json, hitl.json, monitors.json,
// remote-session metadata — was written with a plain writeFileSync. That
// TRUNCATES the file before writing, so a crash, a kill, or a full disk in that
// window leaves a half-written file that no longer parses. For schedules.json
// that means launchd jobs silently stop; for hitl.json it means losing the
// inbox. The window is small but the loss is total, and these files are written
// on ordinary user actions.
//
// Writing to a sibling temp file and renaming fixes it: rename(2) is atomic
// within a filesystem, so a reader sees either the whole old file or the whole
// new one — never a torn one.

/**
 * Write `data` to `file` atomically (temp + rename).
 *
 * The temp file sits beside the target on purpose — rename is only atomic
 * within a single filesystem, so /tmp would not be safe.
 */
export function writeFileAtomic(file: string, data: string, opts?: { mode?: number }): void {
  mkdirSync(dirname(file), { recursive: true })
  // The pid keeps concurrent writers (app + cron daemon) off each other's temp.
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data, opts?.mode ? { mode: opts.mode } : undefined)
    renameSync(tmp, file)
  } catch (e) {
    // Never leave a stray temp behind on failure.
    try {
      unlinkSync(tmp)
    } catch {
      /* already gone */
    }
    throw e
  }
}

/** Convenience for the common "pretty-printed JSON state file" case. */
export function writeJsonAtomic(file: string, value: unknown, opts?: { mode?: number }): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, opts)
}
