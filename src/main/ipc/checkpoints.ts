// Checkpoint IPC (ticket 0122 index.ts decomposition) — the per-turn workspace
// snapshots the editor's review gutter and the undo affordance read from. All
// five are scoped to the active workspace's repo root, injected via deps.

import { handle } from '../typed-ipc'
import {
  checkpointChangedRanges,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  reviewBaseFor,
} from '../checkpoints'
import { type WorkspaceDaemon } from '../workspace-daemon'

export function registerCheckpointsIpc(deps: { activeDaemon(): WorkspaceDaemon }): void {
  handle('checkpoints:list', () => listCheckpoints(deps.activeDaemon().repoRoot()))
  handle('checkpoints:create', (_e, label: string) =>
    createCheckpoint(deps.activeDaemon().repoRoot(), label || 'manual checkpoint'),
  )
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
