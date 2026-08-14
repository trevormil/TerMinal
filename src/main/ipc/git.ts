// Git IPC (ticket 0122 index.ts decomposition) — the Files tab's history,
// branch, stash and diff views. Every handler delegates to the active
// workspace daemon (local git or SSH), which is the one piece of session state,
// injected via deps.

import { handle } from '../typed-ipc'
import { difftOnPath } from '../forge'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerGitIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  handle('git:working-diff', () => {
    return deps.activeDaemon().workingDiff()
  })
  handle('git:file-at-head', (_e, rel: string) => {
    return deps.activeDaemon().fileAtHead(rel)
  })
  handle('git:file-at-head-binary', (_e, rel: string) => {
    return deps.activeDaemon().fileAtHeadBinary(rel)
  })
  handle('git:status-porcelain', () => {
    return deps.activeDaemon().statusPorcelain()
  })
  // Git views for the Files tab (history / branches / stashes / tags).
  handle('git:log', (_e, opts?: { limit?: number; skip?: number; ref?: string }) => {
    return deps.activeDaemon().gitLog(opts)
  })
  handle('git:show', (_e, ref: string) => {
    return deps.activeDaemon().gitShow(ref)
  })
  handle('git:branches', () => {
    return deps.activeDaemon().gitBranches()
  })
  handle('git:checkout', (_e, branch: string) => {
    return deps.activeDaemon().gitCheckout(branch)
  })
  handle('git:create-branch', (_e, name: string, from?: string) => {
    return deps.activeDaemon().gitCreateBranch(name, from)
  })
  handle('git:stashes', () => {
    return deps.activeDaemon().gitStashes()
  })
  handle('git:tags', () => {
    return deps.activeDaemon().gitTags()
  })
  handle('git:working-file-patch', (_e, rel: string) => {
    return deps.activeDaemon().gitWorkingFilePatch(rel)
  })
  handle('git:compare-files-patch', (_e, a: string, b: string) => {
    return deps.activeDaemon().gitCompareFilesPatch(a, b)
  })
  handle('git:working-structural-diff', (_e, path: string, width?: number) => {
    return deps.activeDaemon().workingStructuralDiff(path, width)
  })
  handle('difft:available', () => difftOnPath())
}
