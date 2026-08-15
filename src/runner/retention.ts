// ---- durable retention (ticket 0073) ---------------------------------------
//
// The desktop app has a "reclaim disk" button, but a button is not a policy —
// ~/.config/TerMinal reached 6.6 GB after an earlier one-time cleanup pass.
// The watchdog already runs on a launchd cadence, so it carries the recurring
// half: the cheap, mechanical reclaims that are safe without any app state.
// The size/age worktree budgets stay in the app's sweep (src/main/
// run-retention.ts), which can see running runs and dirty worktrees.
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inboxPathsFor, readInboxCounts, updateInbox } from '../shared/inbox-store'
import { writeJsonAtomicShared } from './state-io'
import { CFG, CRON_LOG, HITL_FILE, MONITOR_LOG, readJson, RETENTION_MARKER } from './config'
import { log } from './log'

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000
const LOG_MAX_BYTES = 2 * 1024 * 1024
const LEFTOVER_MIN_AGE_MS = 60 * 60 * 1000
const QUARANTINE_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000

// Cap an append-only log, keeping the TAIL (the end you actually debug with).
// One `.1` generation only — an unbounded chain is the same leak, renamed.
export function rotateLog(file: string, maxBytes: number): number {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const bytes = Buffer.byteLength(raw)
  if (bytes <= maxBytes) return 0
  let tail = raw.slice(-maxBytes)
  const nl = tail.indexOf('\n')
  if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1)
  writeFileSync(`${file}.1`, raw)
  writeFileSync(file, tail)
  return bytes - Buffer.byteLength(tail)
}

// A fresh .tmp/.lock may belong to a live writer, and a recent .corrupt-* is the
// ONLY surviving copy of whatever was quarantined — hence the two age gates.
export function sweepLeftovers(): number {
  let freed = 0
  const now = Date.now()
  for (const name of readdirSync(CFG())) {
    const isQuarantine = /\.corrupt-\d+$/.test(name)
    const isTemp = /\.tmp$/.test(name) || /\.lock$/.test(name) || /\.bak\.\d+$/.test(name)
    if (!isQuarantine && !isTemp) continue
    const path = join(CFG(), name)
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      if (now - st.mtimeMs < (isQuarantine ? QUARANTINE_MIN_AGE_MS : LEFTOVER_MIN_AGE_MS)) continue
      unlinkSync(path)
      freed += st.size
    } catch {}
  }
  return freed
}

// Settled items leave the live inbox the moment they are read or resolved —
// src/shared/inbox-store.ts appends them to hitl-archive.jsonl inside the same
// lock as the write that retired them. There is no age window any more and
// nothing to sweep on a cadence.
//
// What remains here is the FLUSH: a hot file written by an older build, or by
// the hand-written remote-host script, can still be carrying settled items. One
// locked no-op update splits them out (and folds any pre-split dated archive
// directory in). Returns how many items moved.
export function archiveHitl(): number {
  try {
    const p = inboxPathsFor(HITL_FILE())
    // Read the stored index, never a derived one: deriving it would parse the
    // hot file first and a torn file would throw HERE, before the locked write
    // that is supposed to quarantine it ever runs.
    const before = readInboxCounts(p).archived
    updateInbox(p, () => undefined)
    return Math.max(0, readInboxCounts(p).archived - before)
  } catch (e) {
    log(`retention: hitl archive failed: ${e}`)
    return 0
  }
}

export type RetentionSummary = {
  lastRunAt: number
  logBytes: number
  leftoverBytes: number
  archived: number
}

export async function maybeRunRetention(force = false): Promise<RetentionSummary | null> {
  if (!force) {
    const m = readJson<{ lastRunAt?: number }>(RETENTION_MARKER())
    if (m?.lastRunAt && Date.now() - m.lastRunAt < RETENTION_INTERVAL_MS) return null
  }
  const logs = rotateLog(MONITOR_LOG(), LOG_MAX_BYTES) + rotateLog(CRON_LOG(), LOG_MAX_BYTES)
  const leftovers = sweepLeftovers()
  const archived = archiveHitl()
  const summary = { lastRunAt: Date.now(), logBytes: logs, leftoverBytes: leftovers, archived }
  try {
    writeJsonAtomicShared(RETENTION_MARKER(), summary)
  } catch {}
  log(`retention: logs=${logs}B leftovers=${leftovers}B hitl-archived=${archived}`)
  return summary
}
