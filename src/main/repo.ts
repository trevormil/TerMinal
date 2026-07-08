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

export type WorkingDiff = { ok: boolean; diff: string; base: string; branch: string; error?: string }

// The "pre-PR" diff: everything from the merge-base with the default branch to
// the working tree (committed branch work + staged + unstaged), plus untracked
// files rendered as full additions. On the base branch this collapses to just
// uncommitted changes. Read-only — never touches the index.
export function getWorkingDiff(repoRoot: string): WorkingDiff {
  if (!repoRoot) return { ok: false, diff: '', base: '', branch: '', error: 'Not a git repository.' }
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
      .split("\n")
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

export function gitStatus(cwd: string): GitStatus {
  const out: GitStatus = { ok: false, branch: '', ahead: 0, behind: 0, dirty: 0, upstream: false }
  if (!cwd) return out
  const run = (args: string[]) => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return ''
    }
  }
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch) return out
  out.ok = true
  out.branch = branch
  const ab = run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  if (ab) {
    const [behind, ahead] = ab.split(/\s+/).map(Number)
    out.behind = behind || 0
    out.ahead = ahead || 0
    out.upstream = true
  }
  const porcelain = run(['status', '--porcelain'])
  out.dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0
  return out
}
