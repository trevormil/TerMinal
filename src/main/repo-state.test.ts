import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  repoStateRoot,
  repoStateKey,
  repoStateAreaPath,
  repoStateEnv,
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

describe('repoStateEnv', () => {
  test('exports an absolute dir per area plus the root', () => {
    const repo = makeRepo('envrepo', 'https://github.com/o/env.git')
    const env = repoStateEnv(repo)
    expect(env.TERMINAL_STATE_DIR).toBe(repoStateRoot(repo))
    for (const area of SIDECAR_AREAS) {
      const v = env[`TERMINAL_${area.toUpperCase()}_DIR`]
      expect(v).toBe(join(repoStateRoot(repo), area))
      // Absolute — callers must never prefix these with the repo root.
      expect(v.startsWith('/')).toBe(true)
    }
  })

  test('is empty for a non-repo so callers fall back rather than write to /', () => {
    expect(repoStateEnv('')).toEqual({})
  })
})

describe('every spawn path receives the sidecar env', () => {
  // Three separate spawn sites were each missed in turn: interactive sessions,
  // in-process agent runs, then scheduled cron runs — every time by keeping a
  // hand-written list of files. So DISCOVER the spawn sites instead: anything
  // that builds a child env with TERMINAL_REPO must also inject repoStateEnv,
  // or a script told to write to $TERMINAL_REPORTS_DIR resolves an empty path.
  const ROOT = join(import.meta.dir, '..', '..')

  // The previous version of this guard claimed to discover spawn sites but
  // filtered a hand-written CANDIDATES list — so it could only ever find the
  // sites we already knew about. It missed loops.ts and digest-run.ts, both of
  // which spawn a model against a repo. Walk the tree instead.
  function* sources(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) yield* sources(abs)
      else if (/\.(ts|cjs)$/.test(e.name) || !e.name.includes('.')) yield abs
    }
  }

  const CANDIDATES = [...sources(join(ROOT, 'src', 'main')), ...sources(join(ROOT, 'bin'))]
    .map((abs) => abs.slice(ROOT.length + 1))
    .filter((rel) => !rel.includes('.test.'))
    .sort()

  // Comments are prose, not behaviour: index.ts merely MENTIONS `codex exec`
  // while describing a bug, and a guard that fires on that gets suppressed.
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  // Two shapes count as running a model against a repo. Both have shipped a
  // leak: the first missed loops.ts and bg-tasks.ts, the second digest-run.ts,
  // which spawns `codex exec` with the repo as cwd and a bare process.env.
  // `TERMINAL_REPO: ''` is deliberately excluded — terminal-monitor files a
  // repo-less Inbox item, so there is no sidecar to resolve.
  const NAMES_REPO_IN_CHILD_ENV = /TERMINAL_REPO:\s*(?!['"]{2})\S/
  const RUNS_ENGINE_IN_REPO = (s: string) =>
    /cwd:\s*repoRoot\b/.test(s) && /codex exec|cursor-agent|claude -p/.test(s)

  const spawnSites = CANDIDATES.filter((rel) => {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    return NAMES_REPO_IN_CHILD_ENV.test(src) || RUNS_ENGINE_IN_REPO(src)
  })

  test('the scan finds the known spawn sites (a guard matching nothing is not a guard)', () => {
    expect(spawnSites).toContain('src/main/agents.ts')
    expect(spawnSites).toContain('bin/terminal-cron')
    expect(spawnSites.length).toBeGreaterThanOrEqual(2)
  })

  for (const rel of ['src/main/session-registry.ts', ...spawnSites]) {
    test(`${rel} injects repoStateEnv into the child env`, () => {
      // Must USE the helper, not merely define it: the standalone scripts
      // carry their own copy in the inline block, so matching the bare name
      // passed even with the injection deleted — which it did, once. Strip the
      // definition, then require a remaining call.
      const src = readFileSync(join(ROOT, rel), 'utf8')
        .replace(/function repoStateEnv\(root\)[\s\S]*?\n\}/, '')
        .replace(/export function repoStateEnv\([\s\S]*?\n\}/, '')
      expect(src).toContain('repoStateEnv(')
    })
  }
})
