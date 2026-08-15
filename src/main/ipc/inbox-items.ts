// Inbox-item IPC (ticket 0123 — HITL became one category of a generic Inbox).
//
// The cross-repo Inbox plus the per-host fan-out. `inbox:*` is the canonical
// spelling; `hitl:*` is kept forever as an alias so an older renderer bundle,
// a remote host, or anything else still speaking the pre-rename channel names
// keeps working. Both families are bound to the SAME implementations below —
// src/main/ipc/inbox-alias.test.ts fails if a pair ever drifts apart.
//
// The state area on disk stays `hitl` (hitl.json, ADR-0020): only the CONCEPT
// was renamed. Renaming the file would strand every existing item and every
// out-of-app writer (terminal-cli, terminal-cron, terminal-mcp-server) for no
// user-visible gain.
//
// Resolve / remove / mark-read all route back to the host that OWNS the item:
// writing locally would let the 15s remote fan-in flip the state straight back.

import { handle } from '../typed-ipc'
import { readSettings } from '../settings'
import {
  hitlCounts,
  readHitl,
  readHitlArchive,
  resolveHitl,
  removeHitl,
  markHitlRead,
  markAllHitlRead,
} from '../hitl'
import { collectRemoteHitl } from '../remote-runs'
import { remoteHitl, type RemoteSessionRef } from '../remote'
import { createInboxWrites } from '../inbox-writes'

export type InboxItemsIpcDeps = {
  remoteFromHostId(hostId: string, cwd?: string): RemoteSessionRef | null
}

export function registerInboxItemsIpc(deps: InboxItemsIpcDeps): void {
  // Global Inbox (cross-repo). Filing fires a blocked notification (TG + macOS).
  const listItems = () => readHitl()

  // Fan out open items from every configured host (ADR-0002 #14), stamped with
  // hostId so the Inbox shows a host run's block alongside local ones. Best-effort:
  // an unreachable host contributes an error, not a failed view.
  const remoteAllItems = () => {
    const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
    return collectRemoteHitl(hosts, async (h) => {
      const ref = deps.remoteFromHostId(h.id)
      return ref ? remoteHitl.list(ref) : []
    })
  }

  // Resolve/remove/mark-read route to the item's host when it came from the
  // remote fan-out (#14). The routing itself lives in inbox-writes.ts, so the
  // phone bridge writes through the SAME policy instead of a second copy of it.
  const writes = createInboxWrites({
    remoteFromHostId: deps.remoteFromHostId,
    remote: remoteHitl,
    local: { resolve: resolveHitl, remove: removeHitl, markRead: markHitlRead },
  })
  const resolveItem = (id: string, resolved?: boolean, hostId?: string) =>
    writes.resolve(id, resolved ?? true, hostId)
  const removeItem = (id: string, hostId?: string) => writes.remove(id, hostId)
  const markItemsRead = (ids: string[], hostId?: string, read = true) =>
    writes.markRead(ids, hostId, read)

  const markAllItemsRead = () => markAllHitlRead()

  // `list` returns the LIVE items only — tens, not thousands. The two reads
  // below are what the rest of the inbox needs: a badge that costs one tiny
  // file, and history paged out of the append-only archive on demand.
  const counts = () => hitlCounts()
  const archive = (cursor?: string | null, limit?: number) => readHitlArchive(cursor, limit)

  // Canonical spelling.
  handle('inbox:list', () => listItems())
  handle('inbox:remote-all', () => remoteAllItems())
  handle('inbox:resolve', (_e, id: string, resolved?: boolean, hostId?: string) =>
    resolveItem(id, resolved, hostId),
  )
  handle('inbox:remove', (_e, id: string, hostId?: string) => removeItem(id, hostId))
  handle('inbox:mark-read', (_e, ids: string[], hostId?: string, read = true) =>
    markItemsRead(ids, hostId, read),
  )
  handle('inbox:mark-all-read', () => markAllItemsRead())
  handle('inbox:counts', () => counts())
  handle('inbox:archive', (_e, cursor?: string | null, limit?: number) => archive(cursor, limit))

  // Permanent aliases — the pre-rename spelling, same implementations.
  handle('hitl:list', () => listItems())
  handle('hitl:remote-all', () => remoteAllItems())
  handle('hitl:resolve', (_e, id: string, resolved?: boolean, hostId?: string) =>
    resolveItem(id, resolved, hostId),
  )
  handle('hitl:remove', (_e, id: string, hostId?: string) => removeItem(id, hostId))
  handle('hitl:mark-read', (_e, ids: string[], hostId?: string, read = true) =>
    markItemsRead(ids, hostId, read),
  )
  handle('hitl:mark-all-read', () => markAllItemsRead())
  handle('hitl:counts', () => counts())
  handle('hitl:archive', (_e, cursor?: string | null, limit?: number) => archive(cursor, limit))
}
