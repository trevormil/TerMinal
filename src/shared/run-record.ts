// The ONE run-status vocabulary (ticket 91). Four run stores (agent, cron,
// bg, session) each declared their own status union; they disagreed by
// omission, which is why UnifiedRun.status had widened to `string` and every
// consumer switch carried a default arm it could not explain. Each store now
// derives its subset from this list, so adding a status is one edit here and
// a type error everywhere a switch forgot it.
//
// Persisted history needs NO migration: every value ever written by an
// in-repo writer is already in this list. `normalizeRunStatus` exists for the
// one boundary that is not ours — run records fetched from a remote host,
// which may be running an older or newer build.

export const RUN_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'canceled',
  'interrupted',
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (RUN_STATUSES as readonly string[]).includes(v)
}

/** Total mapping for untrusted boundaries (remote hosts). An unknown status is
 *  bucketed as 'failed' — visible and investigable — never silently dropped or
 *  rendered as healthy. The original string survives in the record's error. */
export function normalizeRunStatus(raw: unknown): RunStatus {
  return isRunStatus(raw) ? raw : 'failed'
}

/** A run is settled when nothing will ever update it again. */
export function isSettledRunStatus(s: RunStatus): boolean {
  return s !== 'queued' && s !== 'running'
}

/** How a stale-sweep finalizes an abandoned `running` record. The two in-app
 *  sweeps differ only in this policy: cron runs age out (a crashed runner may
 *  still be alive elsewhere), session runs die with the app (any survivor at
 *  startup is a zombie by definition). */
export type StaleRunPolicy = {
  finalStatus: RunStatus
  error: string
  /** Only finalize records older than this; omit for unconditional. */
  olderThanMs?: number
}

/** Decide whether a running record should be finalized under `policy`, and
 *  return the finalized copy, or null to leave it alone. Pure — the caller
 *  owns the file IO. */
export function finalizeStaleRun<
  R extends { status: string; startedAt?: number; endedAt?: number; error?: string },
>(
  record: R,
  policy: StaleRunPolicy,
  now: number,
):
  | (Omit<R, 'status' | 'endedAt' | 'error'> & {
      status: RunStatus
      endedAt: number
      error: string
    })
  | null {
  if (record.status !== 'running') return null
  if (policy.olderThanMs !== undefined && now - (record.startedAt || 0) < policy.olderThanMs)
    return null
  return {
    ...record,
    status: policy.finalStatus,
    endedAt: record.endedAt ?? now,
    error: record.error ?? policy.error,
  }
}
