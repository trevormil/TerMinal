import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'
import { clearRepoStateCache, repoStateRoot } from './repo-state'

const STAMP = { sha: 'abc1234def5678', stampedAt: '2026-07-17T12:00:00.000Z' }

// The stamp is machine-local bookkeeping, so it lives in the repo's SIDECAR —
// never in the repo (a collaborator must not receive "when the maintainer last
// bootstrapped"). Legacy in-repo .TerMinal/meta.json stays readable so
// unrelated keys survive the move.

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gt-stamp-'))
  process.env.TERMINAL_REPO_STATE_DIR = join(tmp, 'state')
  clearRepoStateCache()
})

afterEach(() => {
  delete process.env.TERMINAL_REPO_STATE_DIR
  rmSync(tmp, { recursive: true, force: true })
})

function tmpRepo(): string {
  return mkdtempSync(join(tmp, 'repo-'))
}

function readMeta(repo: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoStateRoot(repo), 'meta.json'), 'utf8'))
}

describe('writeBootstrapStamp', () => {
  test('fresh bootstrap writes the stamp into the SIDECAR meta.json, not the repo', () => {
    const repo = tmpRepo()
    writeBootstrapStamp(repo, STAMP)
    expect(readMeta(repo).lastBootstrapVersion).toEqual(STAMP)
    expect(existsSync(join(repo, '.TerMinal', 'meta.json'))).toBe(false)
  })

  test('re-bootstrap overwrites the previous stamp', () => {
    const repo = tmpRepo()
    writeBootstrapStamp(repo, { sha: 'old000', stampedAt: '2026-01-01T00:00:00.000Z' })
    writeBootstrapStamp(repo, STAMP)
    expect(readMeta(repo).lastBootstrapVersion).toEqual(STAMP)
  })

  test('preserves unrelated keys from a LEGACY in-repo meta.json', () => {
    const repo = tmpRepo()
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'meta.json'), JSON.stringify({ other: { keep: true } }))
    writeBootstrapStamp(repo, STAMP)
    const meta = readMeta(repo)
    expect(meta.other).toEqual({ keep: true })
    expect(meta.lastBootstrapVersion).toEqual(STAMP)
  })

  test('preserves unrelated keys already in the sidecar meta.json', () => {
    const repo = tmpRepo()
    const root = repoStateRoot(repo)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'meta.json'), JSON.stringify({ other: 1 }))
    writeBootstrapStamp(repo, STAMP)
    const meta = readMeta(repo)
    expect(meta.other).toBe(1)
    expect(meta.lastBootstrapVersion).toEqual(STAMP)
  })

  test('malformed existing meta.json is replaced without crashing', () => {
    const repo = tmpRepo()
    const root = repoStateRoot(repo)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'meta.json'), 'not json {{{')
    expect(() => writeBootstrapStamp(repo, STAMP)).not.toThrow()
    expect(readMeta(repo).lastBootstrapVersion).toEqual(STAMP)
  })

  test('empty repoRoot throws instead of writing to cwd', () => {
    expect(() => writeBootstrapStamp('', STAMP)).toThrow()
  })
})

describe('resolveTemplateSha', () => {
  test('returns HEAD sha of a real git checkout', () => {
    const dir = tmpRepo()
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      })
    git('init', '-q')
    writeFileSync(join(dir, 'f'), 'x')
    git('add', '-A')
    git('commit', '-qm', 'c')
    const head = git('rev-parse', 'HEAD').toString().trim()
    expect(resolveTemplateSha(dir, 'fallback')).toBe(head)
  })

  test('falls back when the dir is not a git repo', () => {
    expect(resolveTemplateSha(tmpRepo(), 'baked123')).toBe('baked123')
  })

  test('falls back when the dir is empty string', () => {
    expect(resolveTemplateSha('', 'baked123')).toBe('baked123')
  })
})
