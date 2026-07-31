// IPC wiring for cross-engine bake-offs. This module owns every electron-facing
// dependency (runs registry, ticket provider, budget gate) so `bakeoff.ts`
// itself stays a pure, unit-testable core.
//
// Register from src/main/index.ts with:
//   registerBakeOffIpc({ repoRoot: () => repoRootOf(cur().cwd) })

import { ipcMain } from 'electron'
import { getRun, runTicketAgent, type Engine } from '../agents'
import { gateSpawn } from '../budgets'
import { getRepoTicket } from '../ticket-provider'
import {
  applyRunStatuses,
  deleteBakeOff,
  getBakeOff,
  judgeBakeOff,
  listBakeOffs,
  pickWinner,
  refreshBakeOff,
  refreshBakeOffStatus,
  startBakeOff,
  type BakeOff,
  type BakeOffEntrantSpec,
  type RunSnapshot,
} from '../bakeoff'

function runSnapshots(b: BakeOff): Record<string, RunSnapshot> {
  const out: Record<string, RunSnapshot> = {}
  for (const e of b.entrants) {
    const r = e.runId ? getRun(e.runId) : null
    if (r) out[r.id] = { status: r.status, branch: r.branch, worktree: r.worktree }
  }
  return out
}

/** Diffs every entrant worktree — user-initiated paths ONLY. */
async function refreshedWithDiffs(id: string): Promise<BakeOff | null> {
  const cur = getBakeOff(id)
  return cur ? refreshBakeOff(id, runSnapshots(cur)) : null
}

export function registerBakeOffIpc(deps: { repoRoot: () => string }): void {
  ipcMain.handle('bakeoff:list', (_e, repoRoot?: string) =>
    listBakeOffs(repoRoot ?? deps.repoRoot()),
  )

  // `withDiffs` is opt-in and user-initiated (the Refresh button, and once
  // before judging). The 10s poll while a bake-off is running passes nothing,
  // so it costs one status fold and no git at all.
  ipcMain.handle('bakeoff:get', async (_e, id: string, opts?: { withDiffs?: boolean }) => {
    if (!opts?.withDiffs) {
      const cur = getBakeOff(id)
      return cur ? refreshBakeOffStatus(id, runSnapshots(cur)) : null
    }
    return refreshedWithDiffs(id)
  })

  ipcMain.handle(
    'bakeoff:start',
    async (_e, ticketSlug: string, entrants: BakeOffEntrantSpec[]) => {
      const root = deps.repoRoot()
      if (!root) return { error: 'not a git repo' }
      const t = await getRepoTicket(root, ticketSlug)
      if (!t) return { error: 'ticket not found' }
      // Every entrant is one more real agent run — gate the fan-out on the same
      // budget check every other background spawn goes through.
      return startBakeOff(
        root,
        {
          slug: t.slug,
          id: t.id,
          title: t.title,
          body: t.body,
          externalKey: t.externalKey,
          url: t.url,
          comments: t.comments,
          agent: t.agent,
          modelTier: t.modelTier,
        },
        entrants,
        gateSpawn(t.agent?.id),
        (repoRoot, ticket, entrant, lane) =>
          runTicketAgent(
            repoRoot,
            ticket as Parameters<typeof runTicketAgent>[1],
            entrant.engine,
            entrant.personaId,
            undefined,
            entrant.model,
            lane,
          ),
      )
    },
  )

  ipcMain.handle(
    'bakeoff:judge',
    async (_e, id: string, opts?: { engine?: Engine; model?: string }) => {
      // Judge the freshest diffs, not whatever was cached at start time.
      if (!(await refreshedWithDiffs(id))) return { error: 'bake-off not found' }
      return judgeBakeOff(id, opts || {})
    },
  )

  ipcMain.handle('bakeoff:pick', (_e, id: string, entrantId: string, note?: string) =>
    pickWinner(id, entrantId, note),
  )

  ipcMain.handle('bakeoff:delete', (_e, id: string) => deleteBakeOff(id))

  // Badge: bake-offs whose entrants have all settled but that nobody has
  // decided yet. Status-only (no git diffing) — this is polled on a timer and
  // must stay cheap.
  ipcMain.handle('bakeoff:pending-count', () => {
    let n = 0
    for (const b of listBakeOffs(deps.repoRoot())) {
      if (applyRunStatuses(b, runSnapshots(b)).status === 'ready') n++
    }
    return n
  })
}
