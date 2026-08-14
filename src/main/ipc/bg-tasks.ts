// Background-task IPC (ticket 0122 index.ts decomposition). `/bg <prompt>`
// fires a detached run locally, or dispatches it to the focused session's host.
//
// The remote prompt is enriched with the MR/DONE/FAILED reporting contract the
// bg watcher parses back out, so a host run reports the same way a local one does.

import { handle } from '../typed-ipc'
import { spawnBgTask, listBgTasks, getBgTask, cancelBgTask, readBgTaskLog } from '../bg-tasks'
import { type Engine } from '../agents'
import { remoteRuns, type RemoteSessionRef } from '../remote'

export type BgTasksIpcDeps = {
  curRemote(): RemoteSessionRef | undefined
  /** OpenRouter/Hermes runs only exist locally — map to the remote's engine. */
  localOnlyToRemote(engine: Engine): Engine
  remoteEngineModel(remote: RemoteSessionRef, engine: Engine, model?: string): string | undefined
}

export function registerBgTasksIpc(deps: BgTasksIpcDeps): void {
  // Background tasks IPCs. /bg <prompt> fires a detached run.
  handle('bg:list', () => (deps.curRemote() ? [] : listBgTasks()))
  handle('bg:get', (_e, id: string) => (deps.curRemote() ? null : getBgTask(id)))
  handle('bg:log', (_e, id: string) => (deps.curRemote() ? '' : readBgTaskLog(id)))
  handle(
    'bg:spawn',
    (_e, input: { repoRoot: string; prompt: string; engine?: Engine; model?: string }) => {
      const remote = deps.curRemote()
      if (!remote) return spawnBgTask(input)
      const prompt = input.prompt?.trim()
      if (!prompt) return { error: 'empty prompt' }
      const engine = deps.localOnlyToRemote(
        input.engine || remote.daemon?.defaultEngine || 'claude',
      )
      const enrichedPrompt =
        prompt +
        `\n\n---\n` +
        `When you're done, if you opened a PR/MR include its URL on a line by itself in the format:\nMR: <url>\n` +
        `If you completed the task without opening a PR/MR, say so on a line starting with:\nDONE: <one-line summary>\n` +
        `If you couldn't complete the task, say so on a line starting with:\nFAILED: <one-line reason>`
      return remoteRuns.start(remote, {
        agentId: 'background-task',
        agentTitle: 'Background task',
        engine,
        model: deps.remoteEngineModel(remote, engine, input.model),
        steps: [{ label: 'background task', prompt: enrichedPrompt }],
      })
    },
  )
  handle('bg:cancel', (_e, id: string) =>
    deps.curRemote() ? { ok: false, error: 'remote' } : cancelBgTask(id),
  )
}
