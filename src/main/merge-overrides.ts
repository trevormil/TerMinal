// Durable record of every time a human merged past the merge-ready bar
// (ticket #0079). The gate is deliberately overridable — the point is that the
// override is *attributable*, not that it is impossible.
//
// Append-only, and deliberately silent: the merge-time UI is a yes/no confirm,
// so nothing here is typed by the human. It exists so "who merged !123, and
// which legs of the bar were unmet" has an answer after the fact.

import { readFileSync, renameSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { writeJsonAtomic } from './atomic-write'

/** The legs of the merge-ready bar, as machine-readable kinds. */
export type MergeBarLeg = 'verdict' | 'tests' | 'findings'

export type MergeOverride = {
  ts: number
  prIid: number
  repoRoot: string
  /** Which legs were unmet. The queryable part of the record. */
  legs: MergeBarLeg[]
  /** The same legs as worded to the human at the time, for the activity feed. */
  blockers: string
  who: string
}

const MAX_RECORDS = 500
const LEGS: MergeBarLeg[] = ['verdict', 'tests', 'findings']

/**
 * Read the log, distinguishing the three states a writer must not conflate.
 *
 * `absent` means no override has ever been recorded — safe to start from [].
 * `corrupt` means the bytes are there but unusable — the writer quarantines.
 * An unexpected read failure (EACCES, EMFILE, a torn read while another process
 * writes) is NEITHER: it throws. The bug this shape exists to kill is a
 * transient read error collapsing to `[]` and the next append persisting that
 * as truth, silently deleting the entire audit trail.
 *
 * Mirrors the `readJsonState` contract from ticket 0068 (fix/atomic-state-writes).
 * Kept local rather than imported so this branch need not stack on that one;
 * fold the two together once #206 lands.
 */
export function readMergeOverrideLog(file: string): {
  records: MergeOverride[]
  present: boolean
  corrupt: boolean
} {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (e) {
    // Only a genuinely missing file is "absent". Anything else is a real error
    // and must not be answered with an empty log.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return { records: [], present: false, corrupt: false }
    throw e
  }
  // What a truncating writer leaves behind mid-crash, and what `touch` leaves.
  // Nothing to preserve either way, so treat it as absent rather than blocking.
  if (raw.trim() === '') return { records: [], present: false, corrupt: false }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { records: [], present: true, corrupt: true }
    return { records: parsed as MergeOverride[], present: true, corrupt: false }
  } catch {
    return { records: [], present: true, corrupt: true }
  }
}

/**
 * Every readable override record, for display.
 *
 * Corrupt or unreadable degrades to `[]` here on purpose — a viewer should show
 * nothing, not throw. Writers must use `readMergeOverrideLog` so they can tell
 * the difference; see `recordMergeOverride`.
 */
export function readMergeOverrides(file: string): MergeOverride[] {
  try {
    return readMergeOverrideLog(file).records
  } catch {
    return []
  }
}

function normaliseLegs(input: unknown): MergeBarLeg[] {
  if (!Array.isArray(input)) return []
  return LEGS.filter((leg) => input.includes(leg))
}

/**
 * Append one override. Returns the stored record.
 *
 * `file` is a parameter rather than a module constant so tests drive a temp
 * path and never touch ~/.config/TerMinal.
 */
export function recordMergeOverride(
  file: string,
  input: { prIid: number; repoRoot: string; legs?: unknown; blockers?: string; who?: string },
): MergeOverride {
  const record: MergeOverride = {
    ts: Date.now(),
    prIid: input.prIid,
    repoRoot: input.repoRoot || '',
    legs: normaliseLegs(input.legs),
    blockers: input.blockers || '',
    who: input.who || safeUser(),
  }

  // A corrupt log must NOT be silently overwritten: this is the audit record of
  // every merge that skipped the bar, and "unreadable" is not "empty". Move the
  // bytes aside for forensics, then start a fresh log so the new record lands.
  // A read error that is neither absent nor corrupt propagates rather than
  // replacing a readable history with a one-entry file.
  const read = readMergeOverrideLog(file)
  if (read.corrupt) quarantine(file)

  writeJsonAtomic(file, [...read.records, record].slice(-MAX_RECORDS))
  return record
}

function quarantine(file: string): void {
  let dest = `${file}.corrupt-${Date.now()}`
  // Two quarantines in the same millisecond would otherwise clobber the first.
  for (let n = 1; exists(dest); n++) dest = `${file}.corrupt-${Date.now()}-${n}`
  renameSync(file, dest)
}

function exists(file: string): boolean {
  try {
    statSync(file)
    return true
  } catch {
    return false
  }
}

function safeUser(): string {
  try {
    return userInfo().username || 'unknown'
  } catch {
    return 'unknown'
  }
}
