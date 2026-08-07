import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateRepoState, sidecarGitStatus } from './repo-state-migrate'
import { clearRepoStateCache, repoStateRoot } from './repo-state'

// Moving a user's tickets and reviews is the one irreversible-feeling step in
// this migration, so it MOVES (never deletes), refuses to clobber, and is
// idempotent. Ticket 0279 shipped a bug where a sync deleted 34 real skills;
// these tests are the standing guard against a repeat.

let tmp: string
let repo: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  })

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'state-migrate-'))
  process.env.TERMINAL_REPO_STATE_DIR = join(tmp, 'state')
  clearRepoStateCache()
  repo = join(tmp, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/o/mig.git')
})

afterEach(() => {
  delete process.env.TERMINAL_REPO_STATE_DIR
  rmSync(tmp, { recursive: true, force: true })
})

const seed = (rel: string, body = 'x') => {
  const p = join(repo, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

describe('migrateRepoState', () => {
  test('moves each area out of the repo and reports what moved', () => {
    seed('.TerMinal/backlog/0001-a.md', 'ticket')
    seed('.TerMinal/reviews/12/abc.md', 'review')
    seed('.TerMinal/reports/dead-code/x.md', 'report')

    const res = migrateRepoState(repo)

    expect(res.moved).toBeGreaterThan(0)
    const root = repoStateRoot(repo)
    expect(readFileSync(join(root, 'backlog', '0001-a.md'), 'utf8')).toBe('ticket')
    expect(readFileSync(join(root, 'reviews', '12', 'abc.md'), 'utf8')).toBe('review')
    expect(existsSync(join(repo, '.TerMinal', 'backlog', '0001-a.md'))).toBe(false)
  })

  test('leaves repo config and shared contracts alone', () => {
    seed('.TerMinal/template.json', '{"version":2}')
    seed('.TerMinal/tickets.json', '{}')
    seed('.TerMinal/widgets.json', '[]')
    seed('.agents/code-review.md', 'contract')
    seed('docs/architecture.md', 'doc')

    migrateRepoState(repo)

    // tickets.json is deliberately ABSENT here: provider config + views are
    // personal state now, moved by the personal-state pass (tested below).
    for (const rel of [
      '.TerMinal/template.json',
      '.TerMinal/widgets.json',
      '.agents/code-review.md',
      'docs/architecture.md',
    ])
      expect(existsSync(join(repo, rel))).toBe(true)
  })

  test('never clobbers: a name already in the sidecar is kept and reported', () => {
    seed('.TerMinal/backlog/0001-a.md', 'from repo')
    const root = repoStateRoot(repo)
    mkdirSync(join(root, 'backlog'), { recursive: true })
    writeFileSync(join(root, 'backlog', '0001-a.md'), 'already in sidecar')

    const res = migrateRepoState(repo)

    expect(readFileSync(join(root, 'backlog', '0001-a.md'), 'utf8')).toBe('already in sidecar')
    // The repo copy survives so nothing is lost and the human can reconcile.
    expect(readFileSync(join(repo, '.TerMinal', 'backlog', '0001-a.md'), 'utf8')).toBe('from repo')
    expect(res.skipped).toContain(join('backlog', '0001-a.md'))
  })

  test('is idempotent — a second run moves nothing and reports nothing', () => {
    seed('.TerMinal/backlog/0001-a.md')
    migrateRepoState(repo)
    const second = migrateRepoState(repo)
    expect(second.moved).toBe(0)
    expect(second.skipped).toEqual([])
  })

  test('handles legacy v1 directories too', () => {
    seed('backlog/0002-legacy.md', 'v1 ticket')
    seed('.reviews/9/sha.md', 'v1 review')

    migrateRepoState(repo)

    const root = repoStateRoot(repo)
    expect(readFileSync(join(root, 'backlog', '0002-legacy.md'), 'utf8')).toBe('v1 ticket')
    expect(readFileSync(join(root, 'reviews', '9', 'sha.md'), 'utf8')).toBe('v1 review')
  })

  test('a repo with nothing to migrate is a no-op, not an error', () => {
    const res = migrateRepoState(repo)
    expect(res.moved).toBe(0)
    expect(res.error).toBeUndefined()
  })
})

describe('sidecar git history', () => {
  test('migration initialises the sidecar as a repo and commits what it moved', () => {
    seed('.TerMinal/backlog/0001-a.md', 'ticket')

    migrateRepoState(repo)

    const status = sidecarGitStatus(repo)
    expect(status.isRepo).toBe(true)
    expect(status.commits).toBeGreaterThan(0)
  })

  test('an existing sidecar repo is not re-initialised', () => {
    seed('.TerMinal/backlog/0001-a.md')
    migrateRepoState(repo)
    const first = sidecarGitStatus(repo)

    seed('.TerMinal/backlog/0002-b.md')
    migrateRepoState(repo)
    const second = sidecarGitStatus(repo)

    expect(second.isRepo).toBe(true)
    expect(second.commits).toBeGreaterThan(first.commits)
  })

  test('personal state files + runtime dirs move too (tickets/notes/knowledge/snippets/meta/loops/artifacts)', () => {
    seed('.TerMinal/tickets.json', '{"provider":"linear"}')
    seed('.TerMinal/notes.md', 'scratch')
    seed('.TerMinal/knowledge.json', '{}')
    seed('.TerMinal/snippets.json', '[]')
    seed('.TerMinal/meta.json', '{"lastBootstrapVersion":{}}')
    seed('.TerMinal/loops/abc/contract.md', 'c')
    seed('.TerMinal/agent-requests/run-1/report.md', 'r')

    const r = migrateRepoState(repo)
    expect(r.error).toBeUndefined()
    expect(r.moved).toBe(7)

    const root = repoStateRoot(repo)
    expect(readFileSync(join(root, 'tickets.json'), 'utf8')).toContain('linear')
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('scratch')
    expect(existsSync(join(root, 'loops', 'abc', 'contract.md'))).toBe(true)
    expect(existsSync(join(root, 'agent-requests', 'run-1', 'report.md'))).toBe(true)
    // moved, not copied — and empty dirs pruned
    expect(existsSync(join(repo, '.TerMinal', 'tickets.json'))).toBe(false)
    expect(existsSync(join(repo, '.TerMinal', 'loops'))).toBe(false)
  })

  test('a sidecar copy of a personal file is never clobbered — the repo copy is skipped', () => {
    const root = repoStateRoot(repo)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'notes.md'), 'sidecar wins')
    seed('.TerMinal/notes.md', 'repo copy')

    const r = migrateRepoState(repo)
    expect(r.skipped).toContain('notes.md')
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('sidecar wins')
    expect(readFileSync(join(repo, '.TerMinal', 'notes.md'), 'utf8')).toBe('repo copy')
  })

  test('template.json and widgets.json stay in the repo — they are repo-owned', () => {
    seed('.TerMinal/template.json', '{}')
    seed('.TerMinal/widgets.json', '[]')
    const r = migrateRepoState(repo)
    expect(r.moved).toBe(0)
    expect(existsSync(join(repo, '.TerMinal', 'template.json'))).toBe(true)
    expect(existsSync(join(repo, '.TerMinal', 'widgets.json'))).toBe(true)
  })
})
