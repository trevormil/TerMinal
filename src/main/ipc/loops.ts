// Loop IPC (ticket 0122 index.ts decomposition) — the long-running
// planner/generator/evaluator loops, plus the cheap one-shot LLM call that
// routes through the local coding-agent subscriptions.
//
// Loops are local-only: a remote session gets a plain `{ error: 'remote' }`
// rather than a silently-empty result.

import { execFileSync } from 'node:child_process'
import { handle } from '../typed-ipc'
import {
  listLoops,
  getLoop,
  readLoopState,
  createLoop,
  stepLoop,
  restartLoop,
  stopLoop,
  type CreateLoopInput,
} from '../loops'
import { type RemoteSessionRef } from '../remote'

export type LoopsIpcDeps = {
  cur(): { cwd: string; sessionId: string }
  curRemote(): RemoteSessionRef | undefined
}

export function registerLoopsIpc(deps: LoopsIpcDeps): void {
  // Loops — long-running planner/generator/evaluator loops (LOOPS.md pattern).
  handle('loops:list', () => (deps.curRemote() ? [] : listLoops()))
  handle('loops:get', (_e, id: string) => (deps.curRemote() ? null : getLoop(id) || null))
  handle('loops:state', (_e, id: string) =>
    deps.curRemote() ? { error: 'remote' } : readLoopState(id),
  )
  handle('loops:create', (_e, input: CreateLoopInput) => {
    if (deps.curRemote()) return { error: 'remote' }
    let repoRoot = input.repoRoot
    if (!repoRoot) {
      // default to the git top-level of the focused session's cwd
      const cwd = deps.cur().cwd
      if (!cwd) return { error: 'no active session — open a repo first' }
      try {
        repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: 'pipe' })
          .toString()
          .trim()
      } catch {
        return { error: `not a git repo: ${cwd}` }
      }
    }
    return createLoop({ ...input, repoRoot })
  })
  handle('loops:step', (_e, id: string) => (deps.curRemote() ? { error: 'remote' } : stepLoop(id)))
  handle('loops:restart', (_e, id: string) =>
    deps.curRemote() ? { error: 'remote' } : restartLoop(id),
  )
  handle('loops:stop', (_e, id: string) => (deps.curRemote() ? { error: 'remote' } : stopLoop(id)))

  // Cheap one-shot LLM call — routes through local coding-agent subscriptions.
  handle('llm:cheap', async (_e, opts: Parameters<typeof import('../cheap-llm').cheapCall>[0]) => {
    const { cheapCall } = await import('../cheap-llm')
    return cheapCall(opts)
  })
}
