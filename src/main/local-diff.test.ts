import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localDiff, resolveBaseBranch } from './local-diff'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

let repo: string

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'localdiff-test-'))
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  writeFileSync(join(repo, 'a.txt'), 'line1\nline2\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'init'])
})

afterAll(() => {
  try {
    rmSync(repo, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('resolveBaseBranch', () => {
  test('defaults to main when it exists', () => {
    expect(resolveBaseBranch(repo)).toBe('main')
  })
  test('honors an explicit existing branch', () => {
    expect(resolveBaseBranch(repo, 'main')).toBe('main')
  })
  test('falls back to main when the requested branch is absent', () => {
    expect(resolveBaseBranch(repo, 'does-not-exist')).toBe('main')
  })
})

describe('localDiff', () => {
  test('working mode shows uncommitted changes vs HEAD, empty when clean', () => {
    writeFileSync(join(repo, 'a.txt'), 'line1\nline2\nline3\n')
    const d = localDiff(repo, 'working')
    expect(d).toContain('a.txt')
    expect(d).toContain('+line3')
    git(repo, ['checkout', '--', 'a.txt']) // reset working tree
    expect(localDiff(repo, 'working')).toBe('')
  })

  test('branch mode shows committed branch changes vs the base branch', () => {
    git(repo, ['checkout', '-q', '-b', 'feat'])
    writeFileSync(join(repo, 'b.txt'), 'new file\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'add b'])
    const d = localDiff(repo, 'branch')
    expect(d).toContain('b.txt')
    expect(d).toContain('+new file')
    git(repo, ['checkout', '-q', 'main'])
  })

  test('returns empty string for a path that is not a git repo', () => {
    expect(localDiff('/nonexistent/path/xyz', 'working')).toBe('')
  })
})
