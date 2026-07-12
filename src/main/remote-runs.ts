import type { UnifiedRun } from './cron-runs'
import type { HitlItem } from './hitl'

export type RemoteRunHost = { id: string; label: string }
export type RemoteRunError = { hostId: string; label: string; error: string }
export type RemoteRunsResult = { runs: UnifiedRun[]; errors: RemoteRunError[] }
export type RemoteHitlResult = { items: HitlItem[]; errors: RemoteRunError[] }

// Fan out to every configured remote host in parallel and merge their runs into
// one list, stamping each run with the host it came from so the Runs tab can
// badge/filter by host. Best-effort: a host that is unreachable (SSH down, bad
// target) contributes an error entry instead of failing the whole view — the
// operator still sees local runs and the hosts that answered.
export async function collectRemoteRuns(
  hosts: RemoteRunHost[],
  fetchOne: (host: RemoteRunHost) => Promise<UnifiedRun[]>,
): Promise<RemoteRunsResult> {
  const settled = await Promise.allSettled(
    hosts.map((h) => fetchOne(h).then((rs) => rs.map((r) => ({ ...r, hostId: h.id, hostLabel: h.label })))),
  )
  const runs: UnifiedRun[] = []
  const errors: RemoteRunError[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') runs.push(...s.value)
    else errors.push({ hostId: hosts[i].id, label: hosts[i].label, error: String((s.reason && s.reason.message) || s.reason || 'error') })
  })
  return { runs, errors }
}

// Same best-effort fan-out for open HITL items (ADR-0002 #14), so a run that
// failed on a host and filed a HITL there surfaces in the Mac Inbox with a host
// badge instead of being invisible. Stamps hostId/hostLabel on each item.
export async function collectRemoteHitl(
  hosts: RemoteRunHost[],
  fetchOne: (host: RemoteRunHost) => Promise<HitlItem[]>,
): Promise<RemoteHitlResult> {
  const settled = await Promise.allSettled(
    hosts.map((h) => fetchOne(h).then((items) => items.map((it) => ({ ...it, hostId: h.id, hostLabel: h.label })))),
  )
  const items: HitlItem[] = []
  const errors: RemoteRunError[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') items.push(...s.value)
    else errors.push({ hostId: hosts[i].id, label: hosts[i].label, error: String((s.reason && s.reason.message) || s.reason || 'error') })
  })
  return { items, errors }
}
