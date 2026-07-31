// Merge-gate override IPC (ticket #0079).
//
// The gate itself lives in the renderer (src/renderer/src/lib/mergeGate.ts) and
// is computed from data the detail view already has. This module only persists
// the override so it is attributable after the fact.
//
// The human sees a yes/no confirm, not a form: recording is a side effect of
// answering yes, never a step the human pays for. So there is nothing to
// validate here and no way for this handler to refuse.

import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emitActivity } from '../events'
import { recordMergeOverride, readMergeOverrides } from '../merge-overrides'

const FILE = join(homedir(), '.config', 'TerMinal', 'merge-overrides.json')

export function registerMergeGateIpc(): void {
  ipcMain.handle(
    'merge-gate:override',
    (
      _e,
      input: { prIid: number; repoRoot: string; legs?: unknown; blockers?: string },
    ): { ok: boolean; error?: string } => {
      try {
        const rec = recordMergeOverride(FILE, input)
        emitActivity({
          kind: 'blocked',
          title: `Merge bar overridden · !${rec.prIid}`,
          detail: `${rec.who} merged past: ${rec.blockers || rec.legs.join(', ') || 'unspecified'}`,
          repoRoot: rec.repoRoot,
          ref: { pr: rec.prIid },
        })
        return { ok: true }
      } catch (e) {
        // Surfaced to the renderer but never blocking: a full disk or an
        // unreadable log must not stop a human from merging their own PR.
        return { ok: false, error: (e as Error).message || 'Could not record the override' }
      }
    },
  )

  ipcMain.handle('merge-gate:overrides', () => readMergeOverrides(FILE))
}
