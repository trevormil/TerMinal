// --- crash-safe shared-state writes (ticket 0068) ----------------------------
//
// Canonical implementation + tests: src/main/atomic-write.ts. This runner is a
// separate short-lived process (launchd/systemd fires it, and docker/
// build-agent-image.sh bakes the BUILT artifact into an image with no sibling
// modules), so it carries its own copy of the logic rather than importing the
// app's — the bundler inlines this module into bin/terminal-cron.
//
// Why it matters here: this process and the desktop app both read-modify-write
// schedules.json and hitl.json. Without a lock, stamping lastRun from a snapshot
// read before the user disabled a schedule writes `enabled: true` back and the
// job keeps firing.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function writeJsonAtomicShared(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {}
    throw e
  }
}

export function sleepSyncShared(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

type LockRecord = { pid: number; at: number; token: string }

export function readLockShared(lockPath: string): LockRecord | null {
  try {
    const p = JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord
    return typeof p?.token === 'string' ? p : null
  } catch {
    return null
  }
}

export function pidAliveShared(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Advisory cross-process lock. Crash-safe: a lock whose owner died, or that
 *  outlives staleMs, is stolen; the acquire itself times out rather than wedge. */
export function withFileLockShared<T>(
  file: string,
  fn: () => T,
  { timeoutMs = 5000, staleMs = 30000 }: { timeoutMs?: number; staleMs?: number } = {},
): T {
  const lockPath = `${file}.lock`
  const token = randomUUID()
  mkdirSync(dirname(file), { recursive: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let took = false
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), token }))
      } finally {
        closeSync(fd)
      }
      // The stamping race the original documents: `openSync(…,'wx')` can
      // succeed for two processes that then both write, so re-read the file and
      // only claim the lock when OUR token is the one that survived.
      sleepSyncShared(2)
      took = readLockShared(lockPath)?.token === token
    } catch {}
    if (took) break
    const held = readLockShared(lockPath)
    if (
      held === null ||
      !pidAliveShared(held.pid) ||
      Date.now() - held.at > staleMs ||
      Date.now() > deadline
    ) {
      try {
        unlinkSync(lockPath)
      } catch {}
      continue
    }
    sleepSyncShared(10)
  }
  try {
    return fn()
  } finally {
    if (readLockShared(lockPath)?.token === token) {
      try {
        unlinkSync(lockPath)
      } catch {}
    }
  }
}

/** Locked read-modify-write of a JSON list. `update` receives the value as it is
 *  on disk AT LOCK TIME. A present-but-unparseable file is quarantined to
 *  <name>.corrupt-<ts> and the write is REFUSED — returning [] and writing that
 *  back is how a torn file silently deletes every entry. Returns true if written. */
export function updateJsonListShared<T>(
  file: string,
  update: (cur: T[]) => T[] | undefined,
): boolean {
  return withFileLockShared(file, () => {
    let raw: string | null = null
    try {
      raw = readFileSync(file, 'utf8')
    } catch {}
    let cur: T[] = []
    if (raw !== null && raw.trim() !== '') {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = undefined
      }
      if (!Array.isArray(parsed)) {
        const dest = `${file}.corrupt-${Date.now()}`
        renameSync(file, dest)
        throw new Error(`corrupt state file ${file}; moved aside to ${dest}`)
      }
      cur = parsed as T[]
    }
    const next = update(cur)
    if (next === undefined) return false
    writeJsonAtomicShared(file, next)
    return true
  })
}
