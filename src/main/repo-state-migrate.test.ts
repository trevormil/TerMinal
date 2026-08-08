import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateRepoState, pendingMigration, sidecarGitStatus } from './repo-state-migrate'
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

  // `backlog/`, `sessions/`, `reports/` are common names in repos that have
  // nothing to do with TerMinal (a data-science repo's reports/, an Express
  // app's sessions/). Bare v1 dirs count as migratable state only on positive
  // evidence of the TerMinal shape — otherwise one click relocated a repo's
  // real data into the sidecar. Dot-dirs (.reviews/.checks) and .TerMinal/*
  // are unambiguous and stay unconditional.
  test('bare dirs that are not TerMinal-shaped are neither counted nor moved', () => {
    seed('reports/q3-analysis.csv', 'data')
    seed('sessions/user-session.log', 'log')
    seed('backlog/roadmap.txt', 'notes')

    expect(pendingMigration(repo)).toBe(0)
    const res = migrateRepoState(repo)
    expect(res.moved).toBe(0)
    expect(readFileSync(join(repo, 'reports', 'q3-analysis.csv'), 'utf8')).toBe('data')
    expect(readFileSync(join(repo, 'sessions', 'user-session.log'), 'utf8')).toBe('log')
    expect(readFileSync(join(repo, 'backlog', 'roadmap.txt'), 'utf8')).toBe('notes')
  })

  test('TerMinal-shaped bare v1 dirs still count and move', () => {
    seed('backlog/.next-id', '3')
    seed('backlog/0002-legacy.md', 'v1 ticket')
    seed('sessions/0001-demo/session.md', 'doc')

    expect(pendingMigration(repo)).toBeGreaterThan(0)
    const res = migrateRepoState(repo)
    expect(res.moved).toBeGreaterThan(0)
    const root = repoStateRoot(repo)
    expect(readFileSync(join(root, 'backlog', '0002-legacy.md'), 'utf8')).toBe('v1 ticket')
    expect(readFileSync(join(root, 'sessions', '0001-demo', 'session.md'), 'utf8')).toBe('doc')
  })

  test('a bare reports/ moves only alongside other TerMinal evidence', () => {
    seed('reports/dead-code/abc1234.md', 'artifact')
    // Alone: ambiguous — leave it.
    expect(pendingMigration(repo)).toBe(0)
    // With a TerMinal-shaped backlog beside it: clearly a v1 workflow repo.
    seed('backlog/.next-id', '1')
    expect(pendingMigration(repo)).toBeGreaterThan(1)
    migrateRepoState(repo)
    expect(existsSync(join(repo, 'reports'))).toBe(false)
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

  test('knowledge-rag stores are NEVER moved — their config.yaml embeds absolute paths', () => {
    seed('.TerMinal/knowledge-rag/docs/config.yaml', 'documents_dir: /abs/path')
    const r = migrateRepoState(repo)
    expect(r.moved).toBe(0)
    expect(existsSync(join(repo, '.TerMinal', 'knowledge-rag', 'docs', 'config.yaml'))).toBe(true)
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
