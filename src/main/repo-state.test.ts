import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  repoStateRoot,
  repoStateKey,
  repoStateAreaPath,
  repoStateEnv,
  repoStatePathForRead,
  repoStatePathForWrite,
  clearRepoStateCache,
  SIDECAR_AREAS,
  SIDECAR_STATE_RELS,
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

  test('a PORT in an ssh origin does not fork the key (GitHub ssh-over-443)', () => {
    // The two clone forms of the SAME repo must share one sidecar.
    const plain = makeRepo('port-a', 'git@ssh.github.com:trevormil/TerMinal.git')
    const port = makeRepo('port-b', 'ssh://git@ssh.github.com:443/trevormil/TerMinal.git')
    expect(repoStateKey(port)).toBe(repoStateKey(plain))
    expect(repoStateKey(port)).toBe('ssh.github.com/trevormil/TerMinal')
  })

  test('a crafted traversal origin cannot escape the state root', () => {
    const evil = makeRepo('evil', 'https://host.example/a/../../../../tmp/x.git')
    const key = repoStateKey(evil)
    // Rejected to the hashed fallback — never a path with dot segments.
    expect(key).toStartWith('local/')
    expect(repoStateRoot(evil).startsWith(stateDir)).toBe(true)
  })

  test('worktrees of a NO-ORIGIN repo share the main checkout sidecar', () => {
    const main = makeRepo('local-main')
    writeFileSync(join(main, 'f'), 'x')
    execFileSync('git', ['-C', main, 'add', '-A'], { stdio: 'ignore' })
    execFileSync(
      'git',
      ['-C', main, '-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'c'],
      { stdio: 'ignore' },
    )
    const wt = join(tmp, 'local-wt')
    execFileSync('git', ['-C', main, 'worktree', 'add', wt, '-b', 'w'], { stdio: 'ignore' })
    clearRepoStateCache()
    expect(repoStateKey(wt)).toBe(repoStateKey(main))
  })

  test('a local-path origin (unparseable URL) falls back to the hash, like the app', () => {
    const repo = makeRepo('pathy', '/Users/somebody/other-repo')
    expect(repoStateKey(repo)).toStartWith('local/')
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
  // The remote runner builds a SHELL SCRIPT instead of a child-env object —
  // 'export TERMINAL_REPO=' + sq(root). That shape escaped the first two
  // regexes, and the file defined repoStateEnv without ever calling it.
  const EXPORTS_REPO_IN_SHELL = /export TERMINAL_REPO=/
  const RUNS_ENGINE_IN_REPO = (s: string) =>
    /cwd:\s*repoRoot\b/.test(s) && /codex exec|cursor-agent|claude -p/.test(s)

  const spawnSites = CANDIDATES.filter((rel) => {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    return (
      NAMES_REPO_IN_CHILD_ENV.test(src) ||
      EXPORTS_REPO_IN_SHELL.test(src) ||
      RUNS_ENGINE_IN_REPO(src)
    )
  })

  test('the scan finds the known spawn sites (a guard matching nothing is not a guard)', () => {
    expect(spawnSites).toContain('src/main/agents.ts')
    expect(spawnSites).toContain('bin/terminal-cron')
    expect(spawnSites).toContain('src/main/remote-host-script.cjs')
    expect(spawnSites.length).toBeGreaterThanOrEqual(3)
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

describe('personal state files (SIDECAR_STATE_RELS)', () => {
  test('writes always target the sidecar, even when a legacy in-repo copy exists', () => {
    const repo = makeRepo('files', 'git@github.com:acme/files.git')
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'tickets.json'), '{"provider":"linear"}')
    const write = repoStatePathForWrite(repo, 'tickets.json')
    expect(write).toBe(join(stateDir, 'github.com/acme/files', 'tickets.json'))
  })

  test('reads prefer the sidecar, fall back to the legacy in-repo copy, else point at the sidecar', () => {
    const repo = makeRepo('reads', 'git@github.com:acme/reads.git')
    const sidecar = join(stateDir, 'github.com/acme/reads')
    // nothing anywhere → the (missing) sidecar path, where a write would land
    expect(repoStatePathForRead(repo, 'notes.md')).toBe(join(sidecar, 'notes.md'))
    // legacy only → legacy (committed state stays visible, no migration needed)
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'notes.md'), 'old')
    expect(repoStatePathForRead(repo, 'notes.md')).toBe(join(repo, '.TerMinal', 'notes.md'))
    // both → sidecar wins (writes went there; it is the live copy)
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'notes.md'), 'new')
    expect(repoStatePathForRead(repo, 'notes.md')).toBe(join(sidecar, 'notes.md'))
  })

  test('dir rels resolve the same way as file rels', () => {
    const repo = makeRepo('dirs', 'git@github.com:acme/dirs.git')
    mkdirSync(join(repo, '.TerMinal', 'loops', 'abc'), { recursive: true })
    expect(repoStatePathForRead(repo, 'loops')).toBe(join(repo, '.TerMinal', 'loops'))
    const sidecarLoops = join(stateDir, 'github.com/acme/dirs', 'loops')
    mkdirSync(sidecarLoops, { recursive: true })
    expect(repoStatePathForRead(repo, 'loops')).toBe(sidecarLoops)
    expect(repoStatePathForWrite(repo, 'loops')).toBe(sidecarLoops)
  })

  test('no repo → empty write path (callers guard)', () => {
    expect(repoStatePathForWrite('', 'tickets.json')).toBe('')
  })

  test('the catalog covers exactly the personal rels — repo-owned files stay out', () => {
    expect([...SIDECAR_STATE_RELS].sort() as string[]).toEqual(
      [
        'agent-requests',
        'knowledge-rag',
        'knowledge.json',
        'loops',
        'meta.json',
        'notes.md',
        'snippets.json',
        'tickets.json',
      ].sort(),
    )
    // Deliberate exclusions — the repo owns these on purpose.
    for (const repoOwned of ['template.json', 'widgets.json', 'tabs.json']) {
      expect(SIDECAR_STATE_RELS as readonly string[]).not.toContain(repoOwned)
    }
  })
})
