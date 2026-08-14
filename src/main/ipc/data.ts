// Session-data IPC (ticket 0122 index.ts decomposition) — the plugin pollers.
// Every read is keyed to the attached session, so the focused session and the
// active workspace daemon are the whole dependency surface.

import { handle } from '../typed-ipc'
import { readTranscriptStats, readHarnessTdd, readSessionTasks } from '../data'
import { readUsage } from '../usage'
import { enginePath } from '../settings'
import { type Pinned } from '../session-registry'
import { type WorkspaceDaemon } from '../workspace-daemon'

export type DataIpcDeps = {
  cur(): Pinned
  activeDaemon(): WorkspaceDaemon
}

export function registerDataIpc(deps: DataIpcDeps): void {
  // ---- data IPC (plugin pollers; all keyed to the attached session) ----
  handle('data:transcript', () => readTranscriptStats(deps.cur().sessionId))
  handle('data:harness-tdd', () => readHarnessTdd(deps.cur().cwd))
  handle('data:usage', () => readUsage(deps.cur().sessionId))
  handle('data:git-status', () => {
    return deps.activeDaemon().gitStatus()
  })
  handle('data:session-tasks', () => readSessionTasks(deps.cur().sessionId))
  handle('data:meta', () => ({ ...deps.cur(), claude: enginePath('claude') }))
  // First-user-prompt for an arbitrary session id (not just the active one).
  // Used by the auto-naming flow in App.tsx — labels brand-new sessions with a
  // truncated version of what the user actually asked Claude to do, instead of
  // the bare "S1"/"S2" ordinal. The firstUserText is already extracted +
  // capped to 140 chars by parseTranscriptFile.
  handle('data:first-prompt', (_e, sessionId: string) => {
    if (!sessionId) return ''
    return readTranscriptStats(sessionId).firstUserText || ''
  })
}
