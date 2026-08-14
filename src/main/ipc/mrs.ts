// MR / PR IPC (ticket 0122 index.ts decomposition) — the MRs tab's list, diff,
// CI and merge surface plus the AI digest that annotates it. Every handler
// delegates to the active workspace daemon (local forge CLI or SSH), injected
// via deps.
//
// `mrs:merge` sits behind the same human merge gate as the stacked-PR button —
// agents never reach it.

import { handle } from '../typed-ipc'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerMrsIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  handle('mrs:list', () => {
    return deps.activeDaemon().mrsList()
  })
  handle('mrs:get', (_e, iid: number) => {
    return deps.activeDaemon().mrGet(iid)
  })
  handle('mrs:diff', (_e, iid: number) => {
    return deps.activeDaemon().mrDiff(iid)
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
