import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { projectAreaCandidates, TERMINAL_DIR, type ProjectArea } from './project-layout'
import { legacyStatePath, repoStateRoot, SIDECAR_AREAS, MIGRATED_STATE_RELS } from './repo-state'

// One-time move of a repo's existing workflow state into its sidecar.
//
// This is the only step in the migration that touches a user's committed
// tickets and reviews, so it is deliberately conservative: it MOVES files (a
// rename, never a delete), refuses to overwrite anything already in the
// sidecar, leaves the repo copy in place when it refuses, and is idempotent.
// It moves the five state areas plus the personal files/dirs in
// MIGRATED_STATE_RELS; repo-owned config (template.json, widgets.json,
// tabs.json), shared contracts (.agents, docs), and knowledge-rag stores
// (whose config.yaml embeds absolute paths) are never touched.
//
// Moving tracked files leaves their deletions visible (unstaged) in the
// user's working tree on purpose: committing that removal is what finally
// takes the state out of the shared repo, and it stays reviewable rather
// than happening behind their back.

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

/** Every file under dir, as paths relative to it. lstat on purpose: a symlink
 *  is moved AS a link (never followed — following one would recurse into, and
 *  drain, a directory possibly outside the repo), and a broken link can't
 *  abort the whole migration the way statSync would. */
function* filesUnder(dir: string, prefix = ''): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    const rel = prefix ? join(prefix, entry) : entry
    if (lstatSync(abs).isDirectory()) yield* filesUnder(abs, rel)
    else yield rel
  }
}

/** rename, with a copy+delete fallback for EXDEV — a repo on an external
 *  volume can never rename() into ~/.config, and "this repo can never
 *  migrate" is a worse failure than a slower move. */
function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(src, dest, { verbatimSymlinks: true })
    rmSync(src)
  }
}

/** Depth-first removal of now-empty subdirectories (then the dir itself).
 *  A move leaves the tree of dirs behind; rmdir refuses non-empty ones, which
 *  is exactly the guard we want — anything skipped stays visible. */
function pruneEmptyDeep(dir: string): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) if (e.isDirectory()) pruneEmptyDeep(join(dir, e.name))
  try {
    rmdirSync(dir)
  } catch {
    /* not empty — the no-clobber skips live here */
  }
}

// Bare v1 dir names (`backlog/`, `sessions/`, `reports/`) are common in repos
// that have nothing to do with TerMinal — a data-science repo's reports/, an
// Express app's sessions/. Counting them unconditionally meant one click
// relocated a repo's real data into the sidecar. A bare v1 dir is treated as
// workflow state only on POSITIVE evidence of the TerMinal shape; the dotted
// dirs (.reviews/.checks) and everything under .TerMinal/ stay unconditional.
const TICKET_FILE = /^\d{4}-[\w.-]+\.md$/
const SESSION_DIR = /^\d{4}-[\w.-]+$/

function v1DirIsState(repoRoot: string, area: string, dir: string): boolean {
  try {
    const entries = readdirSync(dir)
    if (area === 'backlog')
      return entries.includes('.next-id') || entries.some((e) => TICKET_FILE.test(e))
    if (area === 'sessions')
      return (
        entries.includes('.next-id') ||
        entries.some((e) => SESSION_DIR.test(e) && statSync(join(dir, e)).isDirectory())
      )
    if (area === 'reports') {
      // reports/ content has no distinctive shape — trust it only when the
      // repo shows OTHER TerMinal v1/v2 evidence alongside it.
      return (
        existsSync(join(repoRoot, '.reviews')) ||
        existsSync(join(repoRoot, '.checks')) ||
        existsSync(join(repoRoot, TERMINAL_DIR)) ||
        v1DirIsState(repoRoot, 'backlog', join(repoRoot, 'backlog')) ||
        v1DirIsState(repoRoot, 'sessions', join(repoRoot, 'sessions'))
      )
    }
    return true // .reviews / .checks — dotted, unambiguous
  } catch {
    return false
  }
}

/** All candidate dirs for an area that actually hold TerMinal state. */
function stateDirsFor(repoRoot: string, area: ProjectArea): string[] {
  const out: string[] = []
  for (const rel of projectAreaCandidates(area)) {
    const dir = join(repoRoot, rel)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    if (!rel.startsWith(TERMINAL_DIR) && !v1DirIsState(repoRoot, area, dir)) continue
    out.push(dir)
  }
  return out
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
    // Resolve every area's dirs BEFORE moving anything: reports/'s evidence
    // check looks at backlog/ and sessions/, which the move itself empties.
    const areaDirs = SIDECAR_AREAS.map(
      (area) => [area, stateDirsFor(repoRoot, area as ProjectArea)] as const,
    )
    for (const [area, dirs] of areaDirs) {
      for (const from of dirs) {
        for (const file of filesUnder(from)) {
          const src = join(from, file)
          const dest = join(root, area, file)
          if (existsSync(dest)) {
            // Never clobber: leave the repo copy so the human can reconcile.
            skipped.push(join(area, file))
            continue
          }
          mkdirSync(join(dest, '..'), { recursive: true })
          moveFile(src, dest)
          moved++
        }
        pruneEmptyDeep(from)
        pruneEmpty(join(from, '..'), repoRoot)
      }
    }
    // Personal state files/dirs that lived directly under .TerMinal/ (tickets
    // config+views, notes, knowledge, snippets, stamp, loop + artifact runtime
    // state). Same rules: move, never overwrite, leave the repo copy on refusal.
    for (const rel of MIGRATED_STATE_RELS) {
      const from = legacyStatePath(repoRoot, rel)
      if (!existsSync(from)) continue
      if (statSync(from).isDirectory()) {
        for (const file of filesUnder(from)) {
          const src = join(from, file)
          const dest = join(root, rel, file)
          if (existsSync(dest)) {
            skipped.push(join(rel, file))
            continue
          }
          mkdirSync(join(dest, '..'), { recursive: true })
          moveFile(src, dest)
          moved++
        }
        pruneEmptyDeep(from)
        pruneEmpty(join(from, '..'), repoRoot)
      } else {
        const dest = join(root, rel)
        if (existsSync(dest)) {
          skipped.push(rel)
          continue
        }
        mkdirSync(root, { recursive: true })
        moveFile(from, dest)
        moved++
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
    for (const dir of stateDirsFor(repoRoot, area as ProjectArea)) {
      for (const _ of filesUnder(dir)) n++
    }
  }
  for (const rel of MIGRATED_STATE_RELS) {
    const p = legacyStatePath(repoRoot, rel)
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      for (const _ of filesUnder(p)) n++
    } else {
      n++
    }
  }
  return n
}
