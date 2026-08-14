// HITL IPC (ticket 0122 index.ts decomposition) — the cross-repo human-in-the-
// loop inbox plus the per-host fan-out.
//
// Resolve / remove / mark-read all route back to the host that OWNS the item:
// writing locally would let the 15s remote fan-in flip the state straight back.

import { handle } from '../typed-ipc'
import { readSettings } from '../settings'
import { readHitl, resolveHitl, removeHitl, markHitlRead, markAllHitlRead } from '../hitl'
import { collectRemoteHitl } from '../remote-runs'
import { remoteHitl, type RemoteSessionRef } from '../remote'

export type HitlIpcDeps = {
  remoteFromHostId(hostId: string, cwd?: string): RemoteSessionRef | null
}

export function registerHitlIpc(deps: HitlIpcDeps): void {
  // Global HITL inbox (cross-repo). Filing fires a blocked notification (TG + macOS).
  handle('hitl:list', () => readHitl())
  // Fan out open HITL items from every configured host (ADR-0002 #14), stamped with
  // hostId so the Inbox shows a host run's block alongside local ones. Best-effort:
  // an unreachable host contributes an error, not a failed view.
  handle('hitl:remote-all', () => {
    const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
    return collectRemoteHitl(hosts, async (h) => {
      const ref = deps.remoteFromHostId(h.id)
      return ref ? remoteHitl.list(ref) : []
    })
  })
  // Resolve/remove route to the item's host when it came from the remote fan-out
  // (#14) — resolving a host block on the Mac must write on the host that owns it,
  // not locally. No hostId → local, as before.
  handle('hitl:resolve', (_e, id: string, resolved?: boolean, hostId?: string) => {
    if (hostId) {
      const ref = deps.remoteFromHostId(hostId)
      if (ref) return remoteHitl.resolve(ref, id, resolved ?? true).catch(() => false)
    }
    return resolveHitl(id, resolved ?? true)
  })
  handle('hitl:remove', (_e, id: string, hostId?: string) => {
    if (hostId) {
      const ref = deps.remoteFromHostId(hostId)
      if (ref) return remoteHitl.remove(ref, id).catch(() => false)
    }
    return removeHitl(id)
  })
  // Mark-read routes to the owning host like resolve/remove (#14) — a remote
  // item's readAt must persist where the item lives, or the 15s remote fan-in
  // flips it back to unread. No hostId → local, as before.
  handle('hitl:mark-read', (_e, ids: string[], hostId?: string, read = true) => {
    if (hostId) {
      const ref = deps.remoteFromHostId(hostId)
      if (ref) return remoteHitl.markRead(ref, ids, read).catch(() => 0)
    }
    return markHitlRead(ids, read)
  })
  handle('hitl:mark-all-read', () => markAllHitlRead())
}
