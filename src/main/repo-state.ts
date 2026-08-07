import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { configPath } from './config-dir'
import { repoForCwd, repoRootOf } from './repo'
import type { ProjectArea } from './project-layout'

// Personal workflow state (tickets, reviews, sessions, checks, reports) used to
// live inside the target repo, which meant it got committed to repos shared
// with collaborators. It now lives in a per-project SIDECAR directory outside
// the repo: <config>/repos/<host>/<owner>/<repo>/. That directory is itself a
// git repo, so history survives and one backlog can be shared between this Mac
// and the remote workstation through a private remote.
//
// `.agents/` deliberately stays in the repo: agent contracts are shared with
// the team the same way CI config is, and skills reference ../../../.agents by
// relative path.

/** Areas that live in the sidecar. Anything absent stays repo-relative. */
export const SIDECAR_AREAS: readonly ProjectArea[] = [
  'backlog',
  'sessions',
  'reviews',
  'checks',
  'reports',
]

export function isSidecarArea(area: ProjectArea): boolean {
  return SIDECAR_AREAS.includes(area)
}

/**
 * Personal per-repo state that lived at `<repo>/.TerMinal/<rel>` and now lives
 * at the sidecar ROOT under the same relative name. Unlike SIDECAR_AREAS these
 * never had a v1 layout — the one legacy location is always `.TerMinal/<rel>`.
 *
 * Deliberately NOT here: `template.json` (the layout marker is ABOUT the repo),
 * and `widgets.json`/`tabs.json` (repo-provided extension surfaces a project
 * ships on purpose, gated by Settings → Security).
 */
export const SIDECAR_STATE_RELS = [
  'tickets.json', // ticket provider config + custom/saved views
  'notes.md', // repo notes
  'knowledge.json', // knowledge base entries
  'snippets.json', // repo prompt snippets
  'meta.json', // bootstrap stamp
  'loops', // loop-driver runtime state
  'agent-requests', // delegated-artifact runtime state
  'knowledge-rag', // knowledge-RAG stores
] as const

/** The legacy in-repo location of a sidecar state rel. */
export function legacyStatePath(repoRoot: string, rel: string): string {
  return join(repoRoot, '.TerMinal', rel)
}

/**
 * Where NEW content for a personal state file/dir goes: always the sidecar
 * (same write-one rule as areas). '' only when there is no repo at all.
 */
export function repoStatePathForWrite(repoRoot: string, rel: string): string {
  const root = repoStateRoot(repoRoot)
  return root ? join(root, rel) : ''
}

/**
 * Where to READ a personal state file/dir: the sidecar copy when it exists,
 * else the legacy in-repo copy when THAT exists (state already committed stays
 * visible with no migration), else the sidecar path (i.e. "missing", and where
 * a subsequent write will land). Mirrors projectAreaPathForRead's asymmetry.
 */
export function repoStatePathForRead(repoRoot: string, rel: string): string {
  const sidecar = repoStatePathForWrite(repoRoot, rel)
  if (sidecar && existsSync(sidecar)) return sidecar
  const legacy = legacyStatePath(repoRoot, rel)
  if (existsSync(legacy)) return legacy
  return sidecar || legacy
}

/** Root holding every project's sidecar. Env-overridable like terminalConfigDir(). */
export function repoStateDir(): string {
  return process.env.TERMINAL_REPO_STATE_DIR?.trim() || configPath('repos')
}

/**
 * Stable identity for a repo's state, shared across machines and worktrees.
 *
 * The origin remote is the only key that survives a different checkout path,
 * so it wins; `host/owner/repo` matches the scheme `settings.harnessDir`
 * already uses for cross-repo review artifacts. Repos with no origin fall back
 * to a hashed path — deterministic, and distinct for two repos that merely
 * share a basename.
 */
// Resolution shells out to git, and area paths are resolved on every ticket
// list / review read in a polling UI — ~6ms each uncached. A repo's origin
// effectively never changes mid-session, so memoise for the process lifetime.
const keyCache = new Map<string, string>()

/** Drop memoised keys (tests, or after a remote actually changes). */
export function clearRepoStateCache(): void {
  keyCache.clear()
}

export function repoStateKey(repoRoot: string): string {
  if (!repoRoot) return ''
  const cached = keyCache.get(repoRoot)
  if (cached !== undefined) return cached
  // A worktree's origin resolves to the same remote as its main checkout, so
  // worktrees share one backlog — which is what you want when a worktree is
  // just another branch of the same project.
  const id = repoForCwd(repoRoot)
  const key = id
    ? `${id.host}/${id.path}`
    : (() => {
        const canonical = repoRootOf(repoRoot) || repoRoot
        const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12)
        return `local/${basename(canonical)}-${hash}`
      })()
  keyCache.set(repoRoot, key)
  return key
}

/** Absolute sidecar root for a repo, or '' when there is no repo. */
export function repoStateRoot(repoRoot: string): string {
  const key = repoStateKey(repoRoot)
  return key ? join(repoStateDir(), key) : ''
}

/** Absolute sidecar path for an area, or '' when the area is not migrated. */
export function repoStateAreaPath(repoRoot: string, area: ProjectArea): string {
  if (!isSidecarArea(area)) return ''
  const root = repoStateRoot(repoRoot)
  return root ? join(root, area) : ''
}

/**
 * Resolved paths to hand to a spawned session or agent. Skills and prompts
 * reference these instead of literal `.TerMinal/...` paths, so an artifact an
 * agent writes by hand lands in the sidecar rather than the shared repo.
 */
export function repoStateEnv(repoRoot: string): Record<string, string> {
  const root = repoStateRoot(repoRoot)
  if (!root) return {}
  const env: Record<string, string> = { TERMINAL_STATE_DIR: root }
  for (const area of SIDECAR_AREAS) {
    env[`TERMINAL_${area.toUpperCase()}_DIR`] = join(root, area)
  }
  return env
}
