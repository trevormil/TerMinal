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
  stampAutoReviewArtifact,
  writeAutoReviewConfig,
  type AutoReviewConfig,
} from '../pr-auto-review'
import { projectAreaPathForWrite } from '../project-layout'
import { readSettings } from '../settings'
import { join } from 'node:path'

/** How often we look for PRs that appeared since the last check. There is no
 *  forge webhook here, so "on PR-open" is a poll — deliberately slow, since a
 *  pre-review is worth starting within minutes, not seconds. */
const SWEEP_INTERVAL_MS = 3 * 60 * 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

export function stopPrReviewWatcher(): void {
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
}

export function registerPrReviewIpc(deps: { repoRoot: () => string }): void {
  ipcMain.handle('pr-review:config', () => readAutoReviewConfig())

  ipcMain.handle('pr-review:set-config', (_e, patch: Partial<AutoReviewConfig>) =>
    writeAutoReviewConfig({ ...readAutoReviewConfig(), ...patch }),
  )

  const sweep = async () => {
    const root = deps.repoRoot()
    if (!root) return { started: [], errors: ['not a git repo'] }
    const engine = readSettings().defaultEngine || 'codex'
    const res = await runAutoReviewSweep(root, {
      listMrs,
      gate: () => gateSpawn('code-review'),
      // The SAME review agent a human fires by hand — same contract, same
      // artifacts. Auto-review only changes WHEN it runs.
      spawn: (pr) => runPrAgent(root, pr, 'review', engine),
      // ...and stamps the provenance, so the verdict this produces is
      // identifiable as machine-triggered rather than a human's review pass.
      stamp: (iid, headShort) =>
        stampAutoReviewArtifact(
          join(projectAreaPathForWrite(root, 'reviews'), String(iid)),
          headShort,
        ),
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
  }

  ipcMain.handle('pr-review:sweep', sweep)

  // The ticket's headline criterion is "a review pass triggered on PR-open".
  // No forge webhook exists locally, so this is a slow poll that notices new
  // heads. It is a no-op while `enabled` is false (the default), and every
  // sweep still passes through the budget gate and the per-sweep cap.
  stopPrReviewWatcher()
  sweepTimer = setInterval(() => {
    if (!readAutoReviewConfig().enabled) return
    sweep().catch(() => undefined)
  }, SWEEP_INTERVAL_MS)

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
