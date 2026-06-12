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
