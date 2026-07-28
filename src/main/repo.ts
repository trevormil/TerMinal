import { execFileSync } from 'node:child_process'

export type RepoId = { host: string; path: string }

export function parseRemote(url: string): RepoId | null {
  const u = url.trim().replace(/\.git$/, '')
  let m = u.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/)
  if (m) return { host: m[1], path: m[2] }
  m = u.match(/^(?:ssh:\/\/)?[\w.-]+@([^:/]+)[:/](.+)$/) // scp-like or ssh://
  if (m) return { host: m[1], path: m[2] }
  return null
}

/** owner/repo + host for the git repo containing cwd (via origin remote). */
export function repoForCwd(cwd: string): RepoId | null {
  if (!cwd) return null
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseRemote(url)
  } catch {
    return null
  }
}

/** The repo root (git toplevel) for cwd, or '' if not a repo. */
export function repoRootOf(cwd: string): string {
  if (!cwd) return ''
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** The repo's base branch: origin/HEAD's target, else main, else master, else ''. */
function defaultBase(repoRoot: string): string {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '')
  } catch {
    /* no origin HEAD */
  }
  for (const b of ['main', 'master']) {
    try {
      git(['rev-parse', '--verify', b])
      return b
    } catch {
      /* not present */
    }
  }
  return ''
}

/** Raw `git status --porcelain` for per-file tree decorations ('' when not a repo). */
export function getStatusPorcelain(repoRoot: string): string {
  if (!repoRoot) return ''
  try {
    return execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

export type HeadFile = { ok: boolean; content: string; reason?: string }
/**
 * A file's content at HEAD, for a per-file working-tree diff ("Changes View").
 * A file that is new (not in HEAD) is not an error — it diffs against empty.
 */
export function getFileAtHead(repoRoot: string, rel: string): HeadFile {
  if (!repoRoot) return { ok: false, content: '', reason: 'Not a git repository.' }
  try {
    const content = execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${rel}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, content }
  } catch {
    // Untracked/new file — an empty original is the correct diff base.
    return { ok: true, content: '' }
  }
}

export type HeadFileBinary = { ok: boolean; base64: string; reason?: string }
/**
 * Raw bytes at HEAD as base64 — the image-diff original. A file absent from
 * HEAD (newly added) is not an error: it diffs against nothing.
 */
export function getFileAtHeadBinary(repoRoot: string, rel: string): HeadFileBinary {
  if (!repoRoot) return { ok: false, base64: '', reason: 'Not a git repository.' }
  try {
    const buf = execFileSync('git', ['-C', repoRoot, 'show', `HEAD:${rel}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 25_000_000,
    })
    return { ok: true, base64: Buffer.from(buf).toString('base64') }
  } catch {
    return { ok: true, base64: '' }
  }
}

export type WorkingDiff = {
  ok: boolean
  diff: string
  base: string
  branch: string
  error?: string
}

// The "pre-PR" diff: everything from the merge-base with the default branch to
// the working tree (committed branch work + staged + unstaged), plus untracked
// files rendered as full additions. On the base branch this collapses to just
// uncommitted changes. Read-only — never touches the index.
export function getWorkingDiff(repoRoot: string): WorkingDiff {
  if (!repoRoot)
    return { ok: false, diff: '', base: '', branch: '', error: 'Not a git repository.' }
  // Returns stdout even on a non-zero exit (git diff --no-index exits 1 when
  // files differ, which is the normal case for an untracked file).
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch (e) {
      return (e as { stdout?: string }).stdout ?? ''
    }
  }
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    const base = defaultBase(repoRoot)
    const mergeBase = base ? git(['merge-base', 'HEAD', base]).trim() : ''
    const tracked = mergeBase ? git(['diff', mergeBase]) : git(['diff', 'HEAD'])
    const untracked = git(['ls-files', '--others', '--exclude-standard'])
      .split('\n')
      .filter(Boolean)
      .slice(0, 200) // guardrail: don't fan out over a huge untracked tree
      .map((f) => git(['diff', '--no-index', '--', '/dev/null', f]))
      .join('')
    return { ok: true, diff: tracked + untracked, base: base || branch, branch }
  } catch (e) {
    return { ok: false, diff: '', base: '', branch: '', error: (e as Error).message || String(e) }
  }
}

export type GitStatus = {
  ok: boolean
  branch: string
  ahead: number
  behind: number
  dirty: number
  upstream: boolean
}

export const GIT_STATUS_TTL_MS = 1_000

type GitStatusDeps = {
  now: () => number
  runGit: (cwd: string, args: string[]) => string
}

const defaultGitStatusDeps: GitStatusDeps = {
  now: () => Date.now(),
  runGit: (cwd, args) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
}

const GIT_STATUS_CACHE_MAX_ENTRIES = 16

let gitStatusCache = new Map<string, { expiresAt: number; status: GitStatus }>()

function parseGitStatusPorcelain(stdout: string): GitStatus {
  const out: GitStatus = { ok: false, branch: '', ahead: 0, behind: 0, dirty: 0, upstream: false }
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      out.branch = line.slice('# branch.head '.length)
      out.ok = !!out.branch
    } else if (line.startsWith('# branch.upstream ')) {
      out.upstream = true
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/)
      if (m) {
        out.ahead = Number(m[1]) || 0
        out.behind = Number(m[2]) || 0
        out.upstream = true
      }
    } else if (!line.startsWith('#')) {
      out.dirty++
    }
  }
  if (out.branch === '(detached)') out.branch = 'HEAD'
  return out
}

export function gitStatus(cwd: string, deps = defaultGitStatusDeps): GitStatus {
  const out: GitStatus = { ok: false, branch: '', ahead: 0, behind: 0, dirty: 0, upstream: false }
  if (!cwd) return out
  const now = deps.now()
  const cached = gitStatusCache.get(cwd)
  if (cached && now < cached.expiresAt) {
    return cached.status
  }
  let status = out
  try {
    status = parseGitStatusPorcelain(deps.runGit(cwd, ['status', '--porcelain=v2', '--branch']))
  } catch {
    status = out
  }
  gitStatusCache.delete(cwd)
  gitStatusCache.set(cwd, { expiresAt: now + GIT_STATUS_TTL_MS, status })
  while (gitStatusCache.size > GIT_STATUS_CACHE_MAX_ENTRIES) {
    const oldest = gitStatusCache.keys().next().value
    if (!oldest) break
    gitStatusCache.delete(oldest)
  }
  return status
}

export function resetGitStatusCacheForTests(): void {
  gitStatusCache.clear()
}
