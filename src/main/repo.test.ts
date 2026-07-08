import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRemote, getWorkingDiff } from './repo'

describe('parseRemote', () => {
  test('https URL → host + path, strips .git', () => {
    expect(parseRemote('https://gitlab.example.com/owner/project.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'owner/project',
    })
  })

  test('https without .git', () => {
    expect(parseRemote('https://github.com/owner/repo')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test('scp-like ssh URL', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test('ssh:// URL with nested group path', () => {
    expect(parseRemote('ssh://git@gitlab.example.com/group/sub/proj.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'group/sub/proj',
    })
  })

  test('https with embedded credentials', () => {
    expect(parseRemote('https://user:token@gitlab.example.com/a/b.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'a/b',
    })
  })

  test('garbage → null', () => {
    expect(parseRemote('not a url')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})

describe('getWorkingDiff', () => {
  let dir = ''
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wd-'))
    git('init', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 'T')
    write('base.txt', 'base\n')
    git('add', 'base.txt')
    git('commit', '-m', 'base')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('non-repo path → ok:false', () => {
    expect(getWorkingDiff('').ok).toBe(false)
  })

  test('on a feature branch: committed branch work + uncommitted + untracked all appear, base-only does not', () => {
    git('checkout', '-b', 'feature')
    // main advances after the fork (while feature's tree is still clean, so the
    // branch switch is safe) — this change is not on the branch and must be excluded
    git('checkout', 'main')
    write('base.txt', 'base\nmore-on-main\n')
    git('commit', '-am', 'main advances')
    git('checkout', 'feature')
    // committed on the branch
    write('committed.txt', 'branch commit\n')
    git('add', 'committed.txt')
    git('commit', '-m', 'branch work')
    // staged-but-uncommitted edit to a tracked file
    write('base.txt', 'base\nstaged-edit\n')
    git('add', 'base.txt')
    // untracked, never git-added
    write('untracked.txt', 'brand new\n')

    const r = getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.branch).toBe('feature')
    expect(r.diff).toContain('committed.txt') // committed branch work
    expect(r.diff).toContain('staged-edit') // uncommitted staged change
    expect(r.diff).toContain('untracked.txt') // untracked file as an addition
    expect(r.diff).not.toContain('more-on-main') // base-branch-only change excluded
  })

  test('on the base branch: only uncommitted/untracked changes appear', () => {
    write('base.txt', 'base\nlocal-edit\n')
    write('new.txt', 'new file\n')
    const r = getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.diff).toContain('local-edit')
    expect(r.diff).toContain('new.txt')
  })

  test('clean base branch → empty diff', () => {
    const r = getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.diff.trim()).toBe('')
  })
})
