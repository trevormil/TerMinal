import { getRepoTicket, updateRepoTicket } from '../ticket-provider'
import { forgeCreateContext, createForgeRequest } from '../forge-create'
import { forgeFor } from '../forge'
import { repoForCwd } from '../repo'
import type { ForgeCreateInput } from '../../shared/forge-create'
// MR / PR IPC (ticket 0122 index.ts decomposition) — the MRs tab's list, diff,
// CI and merge surface plus the AI digest that annotates it. Every handler
// delegates to the active workspace daemon (local forge CLI or SSH), injected
// via deps.
//
// `mrs:merge` sits behind the same human merge gate as the stacked-PR button —
// agents never reach it.

import { handle } from '../typed-ipc'
import { type WorkspaceDaemon } from '../workspace-daemon'
import { analyzePrDiff } from '../../shared/pr-overview'

export function registerMrsIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  handle('mrs:create-context', () => {
    const daemon = deps.activeDaemon()
    if (daemon.remote)
      return {
        repoRoot: '',
        label: 'PR' as const,
        head: '',
        base: '',
        error: 'Open a local checkout to create a PR/MR.',
      }
    return forgeCreateContext(daemon.repoRoot())
  })
  handle(
    'mrs:create',
    async (_e, expectedRepo: string, ticketSlug: string, input: ForgeCreateInput) => {
      const daemon = deps.activeDaemon()
      if (daemon.remote || !expectedRepo || daemon.repoRoot() !== expectedRepo)
        return { error: 'The active checkout changed. Reopen Create PR/MR.' }
      const context = await forgeCreateContext(expectedRepo)
      if (context.error) return { error: context.error }
      const repo = repoForCwd(expectedRepo)
      if (!repo) return { error: 'No supported origin remote.' }
      const ticket = await getRepoTicket(expectedRepo, ticketSlug)
      if (!ticket) return { error: 'The ticket could not be resolved in this checkout.' }
      const result = await createForgeRequest(
        expectedRepo,
        repo,
        forgeFor(expectedRepo).kind,
        input,
      )
      if (!result.url) return result
      if (ticket.provider && ticket.provider !== 'local')
        return { ...result, warning: 'Copy the created URL into your ticket provider to link it.' }
      try {
        const current = await getRepoTicket(expectedRepo, ticketSlug)
        if (
          !current ||
          !(await updateRepoTicket(expectedRepo, ticketSlug, {
            prs: [...new Set([...current.prs, result.url])],
          }))
        )
          throw new Error('Link failed')
        return result
      } catch {
        return {
          ...result,
          warning:
            'PR/MR created, but the ticket link could not be saved. Copy its URL into the ticket.',
        }
      }
    },
  )
  handle('mrs:list', () => {
    return deps.activeDaemon().mrsList()
  })
  handle('mrs:get', (_e, iid: number) => {
    return deps.activeDaemon().mrGet(iid)
  })
  handle('mrs:diff', (_e, iid: number) => {
    return deps.activeDaemon().mrDiff(iid)
  })
  // Derived from the very diff `mrs:diff` returns, so it costs no extra forge
  // call and works identically for a local repo and an SSH workspace — the
  // daemon surface stays as it was.
  handle('mrs:overview', async (_e, iid: number) => {
    return analyzePrDiff(await deps.activeDaemon().mrDiff(iid))
  })
  handle('mrs:structural-diff', (_e, iid: number, path: string, width?: number) => {
    return deps.activeDaemon().mrStructuralDiff(iid, path, width)
  })
  handle('digest:get', (_e, iid: number, short?: string) => {
    return deps.activeDaemon().digestGet(iid, short)
  })
  handle('digest:run', (_e, iid: number) => {
    return deps.activeDaemon().digestRun(iid)
  })
  handle('digest:status', (_e, iid: number) => {
    return deps.activeDaemon().digestRunStatus(iid)
  })
  handle('mrs:ci', (_e, iid: number) => {
    return deps.activeDaemon().mrCi(iid)
  })
  handle('mrs:merge', (_e, iid: number) => {
    return deps.activeDaemon().mrMerge(iid)
  })
}
