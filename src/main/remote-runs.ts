import type { UnifiedRun } from './cron-runs'
import type { HitlItem } from './hitl'

export type RemoteRunHost = { id: string; label: string }
export type RemoteRunError = { hostId: string; label: string; error: string }
export type RemoteRunsResult = { runs: UnifiedRun[]; errors: RemoteRunError[] }
export type RemoteHitlResult = { items: HitlItem[]; errors: RemoteRunError[] }

/** How long a single host gets to answer before it's treated as unreachable. */
export const REMOTE_FANOUT_TIMEOUT_MS = 8000

export type FanoutOpts = { timeoutMs?: number }

/**
 * Bound one host's fetch. `Promise.allSettled` handles a host that *rejects*,
 * but not one that never answers at all — and that is the failure mode that
 * actually bites: Tailscale SSH whose auth has lapsed sits at an interactive
 * "visit this URL to authenticate" prompt that neither returns nor errors. The
 * fan-out then never settles, the caller's `Promise.all` never resolves, and the
 * view sits on "Loading…" forever. A timeout is what makes "best-effort" true.
 */
function withTimeout<T>(p: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

// Fan out to every configured remote host in parallel and merge their runs into
// one list, stamping each run with the host it came from so the Runs tab can
// badge/filter by host. Best-effort: a host that is unreachable (SSH down, bad
// target, hung auth prompt) contributes an error entry instead of failing or
// stalling the whole view — the operator still sees local runs and the hosts
// that answered.
export async function collectRemoteRuns(
  hosts: RemoteRunHost[],
  fetchOne: (host: RemoteRunHost) => Promise<UnifiedRun[]>,
  opts?: FanoutOpts,
): Promise<RemoteRunsResult> {
  const ms = opts?.timeoutMs ?? REMOTE_FANOUT_TIMEOUT_MS
  const settled = await Promise.allSettled(
    hosts.map((h) =>
      withTimeout(fetchOne(h), h.label, ms).then((rs) =>
        rs.map((r) => ({ ...r, hostId: h.id, hostLabel: h.label })),
      ),
    ),
  )
  const runs: UnifiedRun[] = []
  const errors: RemoteRunError[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') runs.push(...s.value)
    else
      errors.push({
        hostId: hosts[i].id,
        label: hosts[i].label,
        error: String((s.reason && s.reason.message) || s.reason || 'error'),
      })
  })
  return { runs, errors }
}

// Same best-effort fan-out for open HITL items (ADR-0002 #14), so a run that
// failed on a host and filed a HITL there surfaces in the Mac Inbox with a host
// badge instead of being invisible. Stamps hostId/hostLabel on each item.
export async function collectRemoteHitl(
  hosts: RemoteRunHost[],
  fetchOne: (host: RemoteRunHost) => Promise<HitlItem[]>,
  opts?: FanoutOpts,
): Promise<RemoteHitlResult> {
  const ms = opts?.timeoutMs ?? REMOTE_FANOUT_TIMEOUT_MS
  const settled = await Promise.allSettled(
    hosts.map((h) =>
      withTimeout(fetchOne(h), h.label, ms).then((items) =>
        items.map((it) => ({ ...it, hostId: h.id, hostLabel: h.label })),
      ),
    ),
  )
  const items: HitlItem[] = []
  const errors: RemoteRunError[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') items.push(...s.value)
    else
      errors.push({
        hostId: hosts[i].id,
        label: hosts[i].label,
        error: String((s.reason && s.reason.message) || s.reason || 'error'),
      })
  })
  return { items, errors }
}
