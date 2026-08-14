// Workspace-bootstrap IPC (ticket 0122 index.ts decomposition).
//
// "Bootstrapped" === the project-template repo data + Codex mirror are present
// (BOOTSTRAP_MARKERS in bootstrap.ts; Claude skills come from the global tm
// plugin, not the repo). Resolving the template source differs between the
// packaged app, a dev checkout and a tmp clone, so index.ts owns it.

import { spawn as cpSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { handle } from '../typed-ipc'
import { classifyBootstrapStatus } from '../bootstrap'
import { bakedTemplateSha, resolveTemplateSha, writeBootstrapStamp } from '../bootstrap-stamp'
import { resolvedTemplateRepo } from '../settings'
import { remoteProject, type RemoteSessionRef } from '../remote'
import { type TemplateSource } from '../template'

export type WorkspaceIpcDeps = {
  curRemote(): RemoteSessionRef | undefined
  projectTemplateSource(marker: string): TemplateSource | { error: string }
}

export function registerWorkspaceIpc(deps: WorkspaceIpcDeps): void {
  // Workspace bootstrap helpers.
  // "Bootstrapped" === the project-template repo data + Codex mirror are present
  // (BOOTSTRAP_MARKERS in bootstrap.ts; Claude skills come from the global tm
  // plugin, not the repo). Used by the in-session banner.

  handle('workspace:is-bootstrapped', (_e, repoRoot: string) => {
    const remote = deps.curRemote()
    if (remote)
      return remoteProject.bootstrapStatus(remote).catch((e) => ({
        state: 'none',
        bootstrapped: false,
        missing: [],
        message: (e as Error).message,
      }))
    if (!repoRoot) return { bootstrapped: true, state: 'full', missing: [], message: '' }
    return classifyBootstrapStatus(repoRoot, (rel) => existsSync(join(repoRoot, rel)))
  })
  // Run project-template/bootstrap.sh against a repo. The script is idempotent:
  // keeps repo data, writes `<name>.workflow` sidecars on conflict, and moves
  // legacy per-repo Claude machinery to .claude/pre-tm-backup/ (the tm plugin
  // serves it now). Streams nothing — we just wait and return ok/error.
  handle('workspace:bootstrap', async (_e, repoRoot: string) => {
    const remote = deps.curRemote()
    if (remote) {
      const templateRepo = remote.daemon?.templateRepo || resolvedTemplateRepo()
      return remoteProject
        .bootstrap(remote, templateRepo)
        .catch((e) => ({ error: (e as Error).message }))
    }
    if (!repoRoot) return { error: 'no repoRoot' }
    const src = deps.projectTemplateSource('bootstrap.sh')
    if ('error' in src) return { error: src.error }
    const script = join(src.dir, 'bootstrap.sh')
    // Template provenance (ticket 0045) — resolved BEFORE the spawn because
    // src.cleanup?.() may delete a tmp clone on exit.
    const templateSha = resolveTemplateSha(src.dir, bakedTemplateSha())
    return new Promise<{ ok: true; templateSha?: string } | { error: string }>((resolve) => {
      const p = cpSpawn('bash', [script, repoRoot], { stdio: 'pipe' })
      let stderr = ''
      p.stderr.on('data', (d) => (stderr += d.toString()))
      p.on('exit', (code) => {
        src.cleanup?.()
        if (code === 0) {
          // Best-effort: a stamp failure shouldn't fail a completed bootstrap.
          try {
            writeBootstrapStamp(repoRoot, { sha: templateSha, stampedAt: new Date().toISOString() })
          } catch {
            /* repo stays unstamped */
          }
          resolve({ ok: true, templateSha })
        } else
          resolve({ error: `bootstrap exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}` })
      })
      p.on('error', (e) => {
        src.cleanup?.()
        resolve({ error: e.message })
      })
    })
  })
}
