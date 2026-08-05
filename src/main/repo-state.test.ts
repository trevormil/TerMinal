import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  repoStateRoot,
  repoStateKey,
  repoStateAreaPath,
  clearRepoStateCache,
  SIDECAR_AREAS,
} from './repo-state'

// The sidecar keeps personal workflow state (tickets, reviews, sessions) out of
// a repo that may be shared with collaborators. The key must be stable across
// machines and across worktrees of the same repo, because the sidecar is itself
// a git repo synced between the Mac and the remote workstation.

let tmp: string
let stateDir: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })

function makeRepo(name: string, origin?: string): string {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  if (origin) git(dir, 'remote', 'add', 'origin', origin)
  return dir
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'repo-state-'))
  stateDir = join(tmp, 'state')
  process.env.TERMINAL_REPO_STATE_DIR = stateDir
  clearRepoStateCache()
})

afterEach(() => {
  delete process.env.TERMINAL_REPO_STATE_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe('repoStateKey', () => {
  test('derives host/owner/repo from an https origin', () => {
    const repo = makeRepo('a', 'https://github.com/trevormil/TerMinal.git')
    expect(repoStateKey(repo)).toBe('github.com/trevormil/TerMinal')
  })

  test('derives the same key from an ssh origin for the same repo', () => {
    const https = makeRepo('b', 'https://github.com/trevormil/TerMinal.git')
    const ssh = makeRepo('c', 'git@github.com:trevormil/TerMinal.git')
    expect(repoStateKey(ssh)).toBe(repoStateKey(https))
  })

  test('falls back to a deterministic local key with no origin', () => {
    const repo = makeRepo('no-origin')
    const key = repoStateKey(repo)
    expect(key).toStartWith('local/no-origin-')
    expect(repoStateKey(repo)).toBe(key) // deterministic
  })

  test('distinct no-origin repos with the same basename do not collide', () => {
    mkdirSync(join(tmp, 'x'), { recursive: true })
    mkdirSync(join(tmp, 'y'), { recursive: true })
    const a = makeRepo(join('x', 'proj'))
    const b = makeRepo(join('y', 'proj'))
    expect(repoStateKey(a)).not.toBe(repoStateKey(b))
  })

  test('a worktree resolves to the same key as its main checkout', () => {
    const repo = makeRepo('main-checkout', 'https://github.com/trevormil/TerMinal.git')
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@e',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@e',
      },
    })
    const wt = join(tmp, 'wt')
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', wt], {
      stdio: 'ignore',
    })
    expect(repoStateKey(wt)).toBe(repoStateKey(repo))
  })

  test('empty repo root yields no key', () => {
    expect(repoStateKey('')).toBe('')
  })

  test('memoises per repo root, and the cache can be cleared', () => {
    const repo = makeRepo('cached', 'https://github.com/o/before.git')
    expect(repoStateKey(repo)).toBe('github.com/o/before')

    // Changing origin without clearing must return the cached value — that is
    // what proves the git call is not repeated on every path resolution.
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/o/after.git')
    expect(repoStateKey(repo)).toBe('github.com/o/before')

    clearRepoStateCache()
    expect(repoStateKey(repo)).toBe('github.com/o/after')
  })
})

describe('repoStateRoot', () => {
  test('lives under the configured state dir, keyed by repo', () => {
    const repo = makeRepo('d', 'https://github.com/trevormil/TerMinal.git')
    expect(repoStateRoot(repo)).toBe(join(stateDir, 'github.com/trevormil/TerMinal'))
  })

  test('honours the env override (the seam tests rely on)', () => {
    const repo = makeRepo('e', 'https://github.com/o/r.git')
    const other = join(tmp, 'elsewhere')
    process.env.TERMINAL_REPO_STATE_DIR = other
    expect(repoStateRoot(repo)).toBe(join(other, 'github.com/o/r'))
  })

  test('is empty for a non-repo so callers can fall back', () => {
    expect(repoStateRoot('')).toBe('')
  })
})

describe('repoStateAreaPath', () => {
  test('maps each migrated area under the sidecar root', () => {
    const repo = makeRepo('f', 'https://github.com/o/r.git')
    const root = repoStateRoot(repo)
    expect(repoStateAreaPath(repo, 'backlog')).toBe(join(root, 'backlog'))
    expect(repoStateAreaPath(repo, 'reviews')).toBe(join(root, 'reviews'))
    expect(repoStateAreaPath(repo, 'sessions')).toBe(join(root, 'sessions'))
    expect(repoStateAreaPath(repo, 'checks')).toBe(join(root, 'checks'))
    expect(repoStateAreaPath(repo, 'reports')).toBe(join(root, 'reports'))
  })

  test('agents stays in the repo — it is a shared contract, not personal state', () => {
    const repo = makeRepo('g', 'https://github.com/o/r.git')
    expect(SIDECAR_AREAS).not.toContain('agents')
    expect(repoStateAreaPath(repo, 'agents')).toBe('')
  })
})
