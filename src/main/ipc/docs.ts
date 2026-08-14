// Repo-context IPC (ticket 0122 index.ts decomposition) — the Docs tab plus
// the per-tab repo context header and the skills roster. All three read through
// the active workspace daemon; `tab:context` additionally needs the focused
// session id, so both arrive via deps.

import { handle } from '../typed-ipc'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerDocsIpc(deps: {
  activeDaemon(): WorkspaceDaemon
  sessionId(): string
}): void {
  handle('tab:context', async () => {
    return deps.activeDaemon().context(deps.sessionId())
  })
  handle('docs:list', () => {
    return deps.activeDaemon().docsList()
  })
  handle('docs:get', (_e, relPath: string) => {
    return deps.activeDaemon().docsGet(relPath)
  })
  handle('skills:list', () => deps.activeDaemon().skillsList())
}
