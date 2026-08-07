import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

export type RepoId = { host: string; path: string }

const execFileAsync = promisify(execFile)

// Any scheme git speaks (https, ssh, git, ...) with optional credentials and an
// optional port. The port must be split off explicitly: without that,
// `ssh://git@ssh.github.com:443/owner/repo` — GitHub's own ssh-over-https
// workaround — yields the path "443/owner/repo".
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i
const SCP_LIKE = /^[\w.-]+@([^:/]+)[:/](.+)$/

export function parseRemote(url: string): RepoId | null {
  const u = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  const m = u.match(SCHEME_URL) || u.match(SCP_LIKE)
  return m ? { host: m[1], path: m[2] } : null
}

function gitLine(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

/**
 * owner/repo + host for the git repo containing cwd (via origin remote).
 *
 * `git remote get-url` applies `url.<base>.insteadOf`, which routinely rewrites
 * a real forge URL into something that names no forge — an ssh host alias
 * (`git@github-personal:owner/repo`, the multi-account pattern) or a local
 * mirror path. That hid the forge and left the PRs tab empty, so the raw
 * configured URL is the better identity whenever it parses; the rewritten form
 * stays as the fallback for the opposite setup, where origin is a short alias
 * (`gh:owner/repo`) that only names a repo once insteadOf expands it.
 */
export function repoForCwd(cwd: string): RepoId | null {
  return parseRemote(originUrlFor(cwd))
}

/**
 * The origin URL that names the forge — the configured value when it parses,
 * else the insteadOf-rewritten one. Also the URL to hand to another machine:
 * an insteadOf rewrite (ssh alias, local mirror) is local to this one, so the
 * rewritten form is not clonable anywhere else.
 */
export function originUrlFor(cwd: string): string {
  if (!cwd) return ''
  const raw = gitLine(cwd, ['config', '--get', 'remote.origin.url'])
  if (parseRemote(raw)) return raw.trim()
  return gitLine(cwd, ['remote', 'get-url', 'origin']).trim()
}

/**
 * Environment for a `gh` invocation in cwd (undefined = inherit unchanged).
 *
 * `gh` resolves the repo from the git remote itself, applying the same
 * insteadOf rewrite, and then refuses with "none of the git remotes ... point to
 * a known GitHub host". Pinning GH_REPO to the repo we resolved canonically
 * keeps every gh call working under insteadOf. An explicit GH_REPO already in
 * the environment wins.
 */
export function ghEnvFor(cwd: string): NodeJS.ProcessEnv | undefined {
  if (process.env.GH_REPO) return undefined
  const repo = repoForCwd(cwd)
  if (!repo) return undefined
  return {
    ...process.env,
    GH_REPO: /(^|\.)github\.com$/i.test(repo.host) ? repo.path : `${repo.host}/${repo.path}`,
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
async function gitText(
  repoRoot: string,
  args: string[],
  maxBuffer = 8 * 1024 * 1024,
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer,
  })
  return stdout.toString()
}

function errorStdout(e: unknown): string {
  const stdout = (e as { stdout?: string | Buffer }).stdout
  if (!stdout) return ''
  return Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout
}

async function defaultBase(repoRoot: string): Promise<string> {
  try {
    return (await gitText(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))
      .trim()
      .replace(/^origin\//, '')
  } catch {
    /* no origin HEAD */
  }
  for (const b of ['main', 'master']) {
    try {
      await gitText(repoRoot, ['rev-parse', '--verify', b])
      return b
    } catch {
      /* not present */
    }
  }
  return ''
}

/** Raw `git status --porcelain` for per-file tree decorations ('' when not a repo). */
export async function getStatusPorcelain(repoRoot: string): Promise<string> {
  if (!repoRoot) return ''
  try {
    return await gitText(repoRoot, ['status', '--porcelain'])
  } catch {
    return ''
  }
}

export type HeadFile = { ok: boolean; content: string; reason?: string }
/**
 * A file's content at HEAD, for a per-file working-tree diff ("Changes View").
 * A file that is new (not in HEAD) is not an error — it diffs against empty.
 */
export async function getFileAtHead(repoRoot: string, rel: string): Promise<HeadFile> {
  if (!repoRoot) return { ok: false, content: '', reason: 'Not a git repository.' }
  try {
    const content = await gitText(repoRoot, ['show', `HEAD:${rel}`], 16 * 1024 * 1024)
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
export async function getFileAtHeadBinary(repoRoot: string, rel: string): Promise<HeadFileBinary> {
  if (!repoRoot) return { ok: false, base64: '', reason: 'Not a git repository.' }
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'show', `HEAD:${rel}`], {
      maxBuffer: 25_000_000,
    })
    return {
      ok: true,
      base64: Buffer.isBuffer(stdout)
        ? stdout.toString('base64')
        : Buffer.from(stdout).toString('base64'),
    }
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
export async function getWorkingDiff(repoRoot: string): Promise<WorkingDiff> {
  if (!repoRoot)
    return { ok: false, diff: '', base: '', branch: '', error: 'Not a git repository.' }
  // Returns stdout even on a non-zero exit (git diff --no-index exits 1 when
  // files differ, which is the normal case for an untracked file).
  const git = async (args: string[]): Promise<string> => {
    try {
      return await gitText(repoRoot, args, 64 * 1024 * 1024)
    } catch (e) {
      return errorStdout(e)
    }
  }
  try {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const base = await defaultBase(repoRoot)
    const mergeBase = base ? (await git(['merge-base', 'HEAD', base])).trim() : ''
    const tracked = mergeBase ? await git(['diff', mergeBase]) : await git(['diff', 'HEAD'])
    let untracked = ''
    for (const f of (await git(['ls-files', '--others', '--exclude-standard']))
      .split('\n')
      .filter(Boolean)
      .slice(0, 200)) {
      untracked += await git(['diff', '--no-index', '--', '/dev/null', f])
    }
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
  runGit: (cwd: string, args: string[]) => Promise<string> | string
}

const defaultGitStatusDeps: GitStatusDeps = {
  now: () => Date.now(),
  runGit: (cwd, args) => gitText(cwd, args).then((out) => out.trim()),
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

export async function gitStatus(cwd: string, deps = defaultGitStatusDeps): Promise<GitStatus> {
  const out: GitStatus = { ok: false, branch: '', ahead: 0, behind: 0, dirty: 0, upstream: false }
  if (!cwd) return out
  const now = deps.now()
  const cached = gitStatusCache.get(cwd)
  if (cached && now < cached.expiresAt) {
    return cached.status
  }
  let status = out
  try {
    status = parseGitStatusPorcelain(
      await deps.runGit(cwd, ['status', '--porcelain=v2', '--branch']),
    )
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
