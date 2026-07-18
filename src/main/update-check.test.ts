import { test, expect, describe } from 'bun:test'
import { parseBuildSha, checkForUpdate } from './update-check'
import type { GitRunner } from './update-check'

// A scripted git runner: maps a joined-args prefix to a stdout string, or to an
// Error to simulate a non-zero exit. Unmatched commands throw (fail loudly).
const gitFrom =
  (script: Record<string, string | Error>): GitRunner =>
  async (args) => {
    const key = Object.keys(script).find((k) => args.join(' ').startsWith(k))
    if (key === undefined) throw new Error(`unexpected git ${args.join(' ')}`)
    const v = script[key]
    if (v instanceof Error) throw v
    return v
  }

// The happy-path repo: origin/HEAD resolves, the build sha exists and is an
// ancestor of origin/main, which is 3 commits ahead.
const behindRepo = {
  fetch: '',
  'symbolic-ref': 'origin/main',
  'rev-parse --verify --quiet abc1234^{commit}': 'abc1234def',
  'rev-parse --short origin/main': 'fee1dea',
  'merge-base --is-ancestor abc1234 origin/main': '',
  'rev-list --count abc1234..origin/main': '3',
}

describe('parseBuildSha', () => {
  test('passes a clean short sha through', () => {
    expect(parseBuildSha('abc1234')).toEqual({ sha: 'abc1234', dirty: false })
  })
  test('strips the -dirty suffix and flags it', () => {
    expect(parseBuildSha('abc1234-dirty')).toEqual({ sha: 'abc1234', dirty: true })
  })
  test('treats unknown/empty stamps as uncomparable', () => {
    expect(parseBuildSha('unknown').sha).toBe('')
    expect(parseBuildSha('').sha).toBe('')
  })
})

describe('checkForUpdate — local git', () => {
  test('reports behind with the commit count and latest sha', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom(behindRepo),
    })
    expect(r.status).toBe('behind')
    expect(r.behindBy).toBe(3)
    expect(r.latestSha).toBe('fee1dea')
    expect(r.source).toBe('git')
    expect(r.buildDirty).toBe(false)
  })

  test('reports up-to-date when zero commits behind', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom({ ...behindRepo, 'rev-list --count abc1234..origin/main': '0' }),
    })
    expect(r.status).toBe('up-to-date')
    expect(r.behindBy).toBe(0)
  })

  test('a -dirty stamp still compares by sha but surfaces buildDirty', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234-dirty',
      repoPath: '/repo',
      runGit: gitFrom(behindRepo),
    })
    expect(r.status).toBe('behind')
    expect(r.buildDirty).toBe(true)
    expect(r.buildSha).toBe('abc1234')
  })

  test('reports diverged when the build sha is not an ancestor of origin/main', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom({
        ...behindRepo,
        'merge-base --is-ancestor abc1234 origin/main': new Error('exit 1'),
      }),
    })
    expect(r.status).toBe('diverged')
    expect(r.behindBy).toBe(0)
  })

  test('tolerates a failed fetch (offline) and compares against the stale ref', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom({ ...behindRepo, fetch: new Error('offline') }),
    })
    expect(r.status).toBe('behind')
  })

  test('falls back to origin/main when origin/HEAD is unset', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom({
        ...behindRepo,
        'symbolic-ref': new Error('no origin/HEAD'),
        'rev-parse --verify --quiet refs/remotes/origin/main': 'fee1deadbeef',
      }),
    })
    expect(r.status).toBe('behind')
  })

  test('surfaces checkout branch + dirty state so the UI can warn before updating', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      runGit: gitFrom({
        ...behindRepo,
        'branch --show-current': 'feat/x',
        'status --porcelain': ' M src/foo.ts',
      }),
    })
    expect(r.checkoutBranch).toBe('feat/x')
    expect(r.checkoutDirty).toBe(true)
  })
})

describe('checkForUpdate — GitHub fallback', () => {
  const fetchJson = (status: number, body: unknown): typeof fetch =>
    (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch

  test('uses the GitHub compare API when no repo path is given', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoSlug: 'trevormil/TerMinal',
      fetchImpl: fetchJson(200, {
        status: 'ahead',
        ahead_by: 5,
        commits: [{ sha: 'fee1deadbeef123' }],
      }),
    })
    expect(r.status).toBe('behind')
    expect(r.behindBy).toBe(5)
    expect(r.latestSha).toBe('fee1dea')
    expect(r.source).toBe('github')
  })

  test('falls back to GitHub when the local repo does not know the build sha', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoPath: '/repo',
      repoSlug: 'trevormil/TerMinal',
      runGit: gitFrom({
        ...behindRepo,
        'rev-parse --verify --quiet abc1234^{commit}': new Error('unknown sha'),
      }),
      fetchImpl: fetchJson(200, { status: 'identical', ahead_by: 0, commits: [] }),
    })
    expect(r.status).toBe('up-to-date')
    expect(r.source).toBe('github')
  })

  test('maps a compare status of behind/diverged to diverged', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoSlug: 'trevormil/TerMinal',
      fetchImpl: fetchJson(200, { status: 'diverged', ahead_by: 2, behind_by: 1, commits: [] }),
    })
    expect(r.status).toBe('diverged')
  })

  test('an API error yields unknown, never a throw', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoSlug: 'trevormil/TerMinal',
      fetchImpl: fetchJson(404, { message: 'Not Found' }),
    })
    expect(r.status).toBe('unknown')
    expect(r.error).toBeTruthy()
  })

  test('a network failure yields unknown, never a throw', async () => {
    const r = await checkForUpdate({
      buildStamp: 'abc1234',
      repoSlug: 'trevormil/TerMinal',
      fetchImpl: (async () => {
        throw new Error('ENOTFOUND api.github.com')
      }) as unknown as typeof fetch,
    })
    expect(r.status).toBe('unknown')
  })
})

describe('checkForUpdate — degenerate inputs', () => {
  test('an unknown build stamp is uncomparable', async () => {
    const r = await checkForUpdate({ buildStamp: 'unknown', repoSlug: 'trevormil/TerMinal' })
    expect(r.status).toBe('unknown')
    expect(r.source).toBe('none')
  })
  test('no repo path and no slug is uncomparable', async () => {
    const r = await checkForUpdate({ buildStamp: 'abc1234' })
    expect(r.status).toBe('unknown')
    expect(r.source).toBe('none')
  })
})
