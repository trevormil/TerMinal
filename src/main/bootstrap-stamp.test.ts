import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'

const STAMP = { sha: 'abc1234def5678', stampedAt: '2026-07-17T12:00:00.000Z' }

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'gt-stamp-'))
}

function readMeta(repo: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repo, '.TerMinal', 'meta.json'), 'utf8'))
}

describe('writeBootstrapStamp', () => {
  test('fresh bootstrap creates .TerMinal/meta.json with the stamp', () => {
    const repo = tmpRepo()
    writeBootstrapStamp(repo, STAMP)
    expect(readMeta(repo).lastBootstrapVersion).toEqual(STAMP)
  })

  test('creates the .TerMinal dir when missing', () => {
    const repo = tmpRepo()
    expect(existsSync(join(repo, '.TerMinal'))).toBe(false)
    writeBootstrapStamp(repo, STAMP)
    expect(existsSync(join(repo, '.TerMinal', 'meta.json'))).toBe(true)
  })

  test('re-bootstrap overwrites the previous stamp', () => {
    const repo = tmpRepo()
    writeBootstrapStamp(repo, { sha: 'old000', stampedAt: '2026-01-01T00:00:00.000Z' })
    writeBootstrapStamp(repo, STAMP)
    expect(readMeta(repo).lastBootstrapVersion).toEqual(STAMP)
  })

  test('preserves unrelated keys already in meta.json', () => {
    const repo = tmpRepo()
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'meta.json'), JSON.stringify({ other: { keep: true } }))
    writeBootstrapStamp(repo, STAMP)
    const meta = readMeta(repo)
    expect(meta.other).toEqual({ keep: true })
    expect(meta.lastBootstrapVersion).toEqual(STAMP)
  })

  test('malformed existing meta.json is replaced without crashing', () => {
    const repo = tmpRepo()
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'meta.json'), 'not json {{{')
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
