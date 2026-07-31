import {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
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

// ---------------------------------------------------------------------------
// Cross-process locking + corrupt-state quarantine (ticket 0068).
//
// Atomicity alone is not enough: four processes write this state (the app,
// bin/terminal-cron, bin/terminal-cli, the MCP server). Each does a
// read-modify-write, so two overlapping writes lose one of the updates even
// though each individual write is atomic — a disabled schedule keeps firing, a
// resolved HITL item comes back. `withFileLock` serialises them.
//
// The lock has to be crash-safe above all else: this is a desktop app, agent
// processes get killed routinely, and a lock that outlives its owner would wedge
// the app forever. So the lock carries the owner pid and a timestamp, and any
// waiter may steal it once the owner is gone or the stamp is old. As a final
// backstop the acquire itself times out and breaks the lock rather than
// blocking indefinitely — losing an update is bad, hanging the UI is worse.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_MS = 30_000

export type LockOptions = {
  /** Give up waiting and break the lock after this long. */
  timeoutMs?: number
  /** A lock older than this is considered abandoned and may be stolen. */
  staleMs?: number
}

type LockRecord = { pid: number; at: number; token: string }

/** Block the calling thread. Sync on purpose — every state writer here is sync. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLock(lockPath: string): LockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord
    if (typeof parsed?.token !== 'string') return null
    return parsed
  } catch {
    // Absent, or a torn lock file — either way we cannot honour it.
    return null
  }
}

/** True while some process holds the lock for `file`. Test/diagnostic helper. */
export function isLocked(file: string): boolean {
  return existsSync(`${file}.lock`)
}

function tryAcquire(lockPath: string, token: string): boolean {
  let fd: number
  try {
    fd = openSync(lockPath, 'wx')
  } catch {
    return false
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), token }))
  } finally {
    closeSync(fd)
  }
  // Two processes that both judged an abandoned lock stale can unlink each
  // other's fresh lock. Reading back after a beat catches that; the loser
  // simply waits again.
  sleepSync(2)
  return readLock(lockPath)?.token === token
}

/**
 * Run `fn` while holding an advisory cross-process lock on `file`.
 *
 * Advisory: it only guards writers that also take the lock. All of TerMinal's
 * read-modify-write paths go through `updateJsonState`, which does.
 */
export function withFileLock<T>(file: string, fn: () => T, opts?: LockOptions): T {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS
  const lockPath = `${file}.lock`
  const token = randomUUID()
  mkdirSync(dirname(file), { recursive: true })

  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (tryAcquire(lockPath, token)) break

    const held = readLock(lockPath)
    const abandoned =
      held === null || !pidAlive(held.pid) || Date.now() - held.at > staleMs || Date.now() > deadline
    if (abandoned) {
      // Break it. Unlinking rather than overwriting keeps the next tryAcquire
      // the single point where ownership is decided.
      try {
        unlinkSync(lockPath)
      } catch {
        /* someone else broke it first */
      }
      continue
    }
    sleepSync(10)
  }

  try {
    return fn()
  } finally {
    // Only release a lock we still own — if it was stolen while we worked, the
    // new owner's lock must survive.
    if (readLock(lockPath)?.token === token) {
      try {
        unlinkSync(lockPath)
      } catch {
        /* already gone */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Corrupt-state quarantine.
//
// The bug this exists to kill: readers returned `[]` (or defaults) when a file
// failed to parse, and the next writer persisted that as truth. One torn write
// to global.json plus one "Save agent" silently deleted every other global
// agent. Absent and unparseable are NOT the same thing — absent means "use the
// default", unparseable means "stop, something is wrong".
// ---------------------------------------------------------------------------

export class CorruptStateError extends Error {
  constructor(
    readonly file: string,
    readonly quarantinedTo: string,
  ) {
    super(`Refusing to overwrite corrupt state file ${file}; moved aside to ${quarantinedTo}`)
    this.name = 'CorruptStateError'
  }
}

export type ReadStateOptions<T> = {
  /** Shape check. A parseable file of the wrong shape is corruption too. */
  accept?: (value: unknown) => boolean
  /** Ignored by the reader; present so read and update share one options type. */
  mode?: number
  _phantom?: T
}

export type StateRead<T> = { value: T; present: boolean; corrupt: boolean }

/**
 * Read a JSON state file, distinguishing "absent" from "present but unreadable".
 *
 * Never destructive — quarantining is a writer's decision, so a stray read
 * cannot move a user's file out from under a running process.
 */
export function readJsonState<T>(
  file: string,
  fallback: () => T,
  opts?: ReadStateOptions<T>,
): StateRead<T> {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { value: fallback(), present: false, corrupt: false }
  }
  // An empty file is what a truncating writer leaves behind mid-crash, but it is
  // also what `touch` leaves; treat it as absent rather than blocking writes.
  if (raw.trim() === '') return { value: fallback(), present: false, corrupt: false }
  try {
    const parsed = JSON.parse(raw) as T
    if (opts?.accept && !opts.accept(parsed)) {
      return { value: fallback(), present: true, corrupt: true }
    }
    return { value: parsed, present: true, corrupt: false }
  } catch {
    return { value: fallback(), present: true, corrupt: true }
  }
}

/** Move an unreadable state file aside so the next write can start clean. */
export function quarantineCorruptFile(file: string, now = Date.now()): string {
  const dest = `${file}.corrupt-${now}`
  renameSync(file, dest)
  return dest
}

/**
 * Locked read-modify-write of a JSON state file.
 *
 * `update` is called with the value as it is on disk *at lock time*, not a
 * snapshot the caller read earlier — that read/write gap is exactly what loses
 * updates between the app and the cron runner. Returning `undefined` aborts the
 * write. A corrupt file is quarantined and `CorruptStateError` is thrown rather
 * than overwritten with the fallback.
 */
export function updateJsonState<T>(
  file: string,
  fallback: () => T,
  update: (current: T) => T | undefined,
  opts?: ReadStateOptions<T> & LockOptions,
): T | undefined {
  return withFileLock(
    file,
    () => {
      const read = readJsonState(file, fallback, opts)
      if (read.corrupt) {
        throw new CorruptStateError(file, quarantineCorruptFile(file))
      }
      const next = update(read.value)
      if (next === undefined) return undefined
      writeJsonAtomic(file, next, opts?.mode ? { mode: opts.mode } : undefined)
      return next
    },
    opts,
  )
}
