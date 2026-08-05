import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { projectAreaCandidates, type ProjectArea } from './project-layout'
import { repoStateRoot, SIDECAR_AREAS } from './repo-state'

// One-time move of a repo's existing workflow state into its sidecar.
//
// This is the only step in the migration that touches a user's committed
// tickets and reviews, so it is deliberately conservative: it MOVES files (a
// rename, never a delete), refuses to overwrite anything already in the
// sidecar, leaves the repo copy in place when it refuses, and is idempotent.
// Repo config (template.json, tickets.json, widgets.json) and shared contracts
// (.agents, docs) are never touched — only the five state areas move.
//
// Moving tracked files leaves deletions staged in the user's working tree on
// purpose: committing that removal is what finally takes the state out of the
// shared repo, and it stays reviewable rather than happening behind their back.

export type MigrateResult = {
  moved: number
  /** Area-relative paths left in the repo because the sidecar already had them. */
  skipped: string[]
  error?: string
}

export type SidecarGitStatus = { isRepo: boolean; commits: number; path: string }

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'TerMinal',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'terminal@localhost',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'TerMinal',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'terminal@localhost',
    },
  }).trim()
}

/** Every file under dir, as paths relative to it. */
function* filesUnder(dir: string, prefix = ''): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    const rel = prefix ? join(prefix, entry) : entry
    if (statSync(abs).isDirectory()) yield* filesUnder(abs, rel)
    else yield rel
  }
}

/** Remove now-empty directories, bottom-up. Never removes a non-empty one. */
function pruneEmpty(dir: string, stopAt: string): void {
  let cur = dir
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      rmdirSync(cur) // throws if not empty — which is the guard we want
    } catch {
      return
    }
    cur = join(cur, '..')
  }
}

export function migrateRepoState(repoRoot: string): MigrateResult {
  const root = repoStateRoot(repoRoot)
  if (!repoRoot || !root) return { moved: 0, skipped: [], error: 'not a repo' }

  let moved = 0
  const skipped: string[] = []
  try {
    for (const area of SIDECAR_AREAS) {
      for (const rel of projectAreaCandidates(area as ProjectArea)) {
        const from = join(repoRoot, rel)
        if (!existsSync(from) || !statSync(from).isDirectory()) continue
        for (const file of filesUnder(from)) {
          const src = join(from, file)
          const dest = join(root, area, file)
          if (existsSync(dest)) {
            // Never clobber: leave the repo copy so the human can reconcile.
            skipped.push(join(area, file))
            continue
          }
          mkdirSync(join(dest, '..'), { recursive: true })
          renameSync(src, dest)
          moved++
        }
        pruneEmpty(from, repoRoot)
      }
    }
  } catch (e) {
    return { moved, skipped, error: e instanceof Error ? e.message : String(e) }
  }

  if (moved > 0) commitSidecar(root, `migrate: import ${moved} file(s) from ${repoRoot}`)
  return { moved, skipped }
}

/**
 * Keep the sidecar under version control from its first write. History is the
 * reason this lives in git rather than plain files: the same `git log`/`git
 * blame` story the tickets had inside the repo, plus a remote to sync a
 * second machine.
 */
export function commitSidecar(sidecarRoot: string, message: string): void {
  try {
    mkdirSync(sidecarRoot, { recursive: true })
    if (!existsSync(join(sidecarRoot, '.git'))) {
      git(sidecarRoot, ['init', '-q'])
    }
    git(sidecarRoot, ['add', '-A'])
    // `commit` exits non-zero with nothing staged; that is a no-op, not a failure.
    const staged = git(sidecarRoot, ['diff', '--cached', '--name-only'])
    if (staged) git(sidecarRoot, ['commit', '-q', '-m', message])
  } catch {
    /* best effort — a sidecar without history still works */
  }
}

export function sidecarGitStatus(repoRoot: string): SidecarGitStatus {
  const path = repoStateRoot(repoRoot)
  if (!path || !existsSync(join(path, '.git'))) return { isRepo: false, commits: 0, path }
  const count = Number(git(path, ['rev-list', '--count', 'HEAD']) || '0')
  return { isRepo: true, commits: Number.isFinite(count) ? count : 0, path }
}

/** Files still sitting in the repo that the sidecar should own. */
export function pendingMigration(repoRoot: string): number {
  if (!repoRoot) return 0
  let n = 0
  for (const area of SIDECAR_AREAS) {
    for (const rel of projectAreaCandidates(area as ProjectArea)) {
      const dir = join(repoRoot, rel)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
      for (const _ of filesUnder(dir)) n++
    }
  }
  return n
}
