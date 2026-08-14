// Checkpoint IPC (ticket 0122 index.ts decomposition) — the per-turn workspace
// snapshots the editor's review gutter and the undo affordance read from. All
// four are scoped to the active workspace's repo root, injected via deps.
//
// Creation is deliberately absent: checkpoints are written by the agent-turn
// hook in main (`createCheckpoint` in index.ts), never on the renderer's say-so,
// so ticket 0124 removed the unused `checkpoints:create` channel.

import { handle } from '../typed-ipc'
import {
  checkpointChangedRanges,
  listCheckpoints,
  restoreCheckpoint,
  reviewBaseFor,
} from '../checkpoints'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerCheckpointsIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  handle('checkpoints:list', () => listCheckpoints(deps.activeDaemon().repoRoot()))
  handle('checkpoints:restore', (_e, sha: string) =>
    restoreCheckpoint(deps.activeDaemon().repoRoot(), sha),
  )
  handle('checkpoints:ranges', (_e, sha: string) =>
    checkpointChangedRanges(deps.activeDaemon().repoRoot(), sha),
  )
  handle('checkpoints:review-base', (_e, rel: string, buffer: string) =>
    reviewBaseFor(deps.activeDaemon().repoRoot(), rel, buffer),
  )
}
