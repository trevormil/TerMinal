// IPC for agentic pre-review: the auto-review sweep, the normalized findings the
// diff viewer renders inline, and per-finding posting to a real forge thread.
//
// Register from src/main/index.ts with:
//   registerPrReviewIpc({ repoRoot: () => repoRootOf(cur().cwd) })

import { ipcMain } from 'electron'
import { runPrAgent } from '../agents'
import { gateSpawn } from '../budgets'
import { emitActivity } from '../events'
import { findingsByLocation, formatFindingComment, normalizeFinding } from '../findings'
import { forgeFor, headSha, postThreadComment } from '../forge'
import { getMr, listMrs } from '../mrs'
import {
  readAutoReviewConfig,
  runAutoReviewSweep,
  writeAutoReviewConfig,
  type AutoReviewConfig,
} from '../pr-auto-review'
import { readSettings } from '../settings'

export function registerPrReviewIpc(deps: { repoRoot: () => string }): void {
  ipcMain.handle('pr-review:config', () => readAutoReviewConfig())

  ipcMain.handle('pr-review:set-config', (_e, patch: Partial<AutoReviewConfig>) =>
    writeAutoReviewConfig({ ...readAutoReviewConfig(), ...patch }),
  )

  ipcMain.handle('pr-review:sweep', async () => {
    const root = deps.repoRoot()
    if (!root) return { started: [], errors: ['not a git repo'] }
    const engine = readSettings().defaultEngine || 'codex'
    const res = await runAutoReviewSweep(root, {
      listMrs,
      gate: () => gateSpawn('code-review'),
      // The SAME review agent a human fires by hand — same contract, same
      // artifacts. Auto-review only changes WHEN it runs.
      spawn: (pr) => runPrAgent(root, pr, 'review', engine),
    })
    for (const s of res.started) {
      emitActivity({
        kind: 'agent-run',
        title: `Pre-review started on ${forgeFor(root).sym}${s.iid}`,
        detail: 'Automatic triage pass — findings will appear inline in the diff.',
        repoRoot: root,
        ref: { pr: s.iid },
        runId: s.runId,
        runSource: 'agent',
      })
    }
    return res
  })

  /** Normalized, severity-tagged findings for a PR, plus the file:line index the
   *  diff viewer uses to place them inline. */
  ipcMain.handle('pr-review:findings', async (_e, iid: number) => {
    const root = deps.repoRoot()
    const mr = root ? await getMr(root, iid) : null
    if (!mr) return { findings: [], byLocation: {}, stale: false }
    return {
      findings: mr.findings.map(normalizeFinding),
      byLocation: findingsByLocation(mr.findings),
      stale: !!mr.reviewMeta?.stale,
    }
  })

  ipcMain.handle('pr-review:post-finding', async (_e, iid: number, findingId: string) => {
    const root = deps.repoRoot()
    const mr = root ? await getMr(root, iid) : null
    if (!mr) return { ok: false, inline: false, error: 'PR not found' }
    const f = mr.findings.map(normalizeFinding).find((x) => x.id === findingId)
    if (!f) return { ok: false, inline: false, error: 'finding not found' }
    const sha = f.file && f.line ? await headSha(root, iid) : ''
    const loc = f.file && f.line && sha ? { path: f.file, line: f.line, commitSha: sha } : undefined
    return postThreadComment(
      root,
      iid,
      formatFindingComment(f, { inline: !!loc }),
      forgeFor(root),
      loc,
    )
  })
}
