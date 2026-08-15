// Inbox writes routed back to the host that OWNS the item.
//
// Extracted from ipc/inbox-items.ts so the phone bridge writes the same way the
// desktop does. Writing a host item locally would let the 15s remote fan-in flip
// the state straight back — and resolving an id the local hitl.json has never
// seen just 404s. One implementation, two callers (IPC + bridge).
//
// Every side effect is injected: hitl.ts/remote.ts transitively import electron,
// which does not load under `bun test`, so the routing policy would otherwise be
// untestable without spawning the app.

import type { RemoteSessionRef } from './remote'

export type InboxWriteDeps = {
  remoteFromHostId(hostId: string): RemoteSessionRef | null
  remote: {
    resolve(ref: RemoteSessionRef, id: string, resolved: boolean): Promise<boolean>
    remove(ref: RemoteSessionRef, id: string): Promise<boolean>
    markRead(ref: RemoteSessionRef, ids: string[], read: boolean): Promise<number>
  }
  local: {
    resolve(id: string, resolved: boolean): boolean
    remove(id: string): boolean
    markRead(ids: string[], read: boolean): number
  }
}

export type InboxWrites = {
  resolve(id: string, resolved?: boolean, hostId?: string): boolean | Promise<boolean>
  remove(id: string, hostId?: string): boolean | Promise<boolean>
  markRead(ids: string[], hostId?: string, read?: boolean): number | Promise<number>
}

export function createInboxWrites(deps: InboxWriteDeps): InboxWrites {
  const { remote, local } = deps
  // A host we can't resolve falls back to local, exactly as before — but a host
  // we CAN resolve owns the write outright: an unreachable host is a failed
  // write, never a local one.
  const hostRef = (hostId?: string) => (hostId ? deps.remoteFromHostId(hostId) : null)

  return {
    resolve: (id, resolved = true, hostId) => {
      const ref = hostRef(hostId)
      if (ref) return remote.resolve(ref, id, resolved).catch(() => false)
      return local.resolve(id, resolved)
    },
    remove: (id, hostId) => {
      const ref = hostRef(hostId)
      if (ref) return remote.remove(ref, id).catch(() => false)
      return local.remove(id)
    },
    markRead: (ids, hostId, read = true) => {
      const ref = hostRef(hostId)
      if (ref) return remote.markRead(ref, ids, read).catch(() => 0)
      return local.markRead(ids, read)
    },
  }
}
