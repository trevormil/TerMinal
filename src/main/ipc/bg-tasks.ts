// Background-task IPC (ticket 0122 index.ts decomposition).
//
// Only cancellation crosses this boundary. Background tasks are started and
// read back inside main itself (the Telegram bridge and the listener inbox call
// `spawnBgTask`; the Runs feed and the bridge read the log), so the
// list/get/log/spawn channels never had a renderer caller — ticket 0124 removed
// them rather than keep four handlers alive for a UI that was never built.

import { handle } from '../typed-ipc'
import { cancelBgTask } from '../bg-tasks'
import { type RemoteSessionRef } from '../remote'

export type BgTasksIpcDeps = {
  curRemote(): RemoteSessionRef | undefined
}

export function registerBgTasksIpc(deps: BgTasksIpcDeps): void {
  handle('bg:cancel', (_e, id: string) =>
    deps.curRemote() ? { ok: false, error: 'remote' } : cancelBgTask(id),
  )
}
