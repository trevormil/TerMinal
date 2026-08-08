import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseRemote,
  repoForCwd,
  originUrlFor,
  getWorkingDiff,
  getStatusPorcelain,
  getFileAtHead,
  getFileAtHeadBinary,
} from './repo'

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

  // gh itself accepts every one of these; the parser is the weak link, and a
  // path with the port glued on ("443/owner/repo") is worse than no answer —
  // it mis-keys review dirs and pins gh to a repo that does not exist.
  test('an explicit port is not part of the host or the path', () => {
    expect(parseRemote('ssh://git@github.com:22/owner/repo.git')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
    expect(parseRemote('https://github.com:443/owner/repo.git')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test("GitHub's ssh-over-https workaround host", () => {
    expect(parseRemote('ssh://git@ssh.github.com:443/owner/repo.git')).toEqual({
      host: 'ssh.github.com',
      path: 'owner/repo',
    })
  })

  test('git:// protocol', () => {
    expect(parseRemote('git://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test('trailing slash is not part of the path', () => {
    expect(parseRemote('https://github.com/owner/repo/')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test('local paths name no forge → null', () => {
    expect(parseRemote('/Users/t/mirrors/repo.git')).toBeNull()
    expect(parseRemote('file:///Users/t/mirrors/repo.git')).toBeNull()
    expect(parseRemote('../sibling-repo')).toBeNull()
  })
})

describe('repoForCwd under url.<base>.insteadOf', () => {
  let dir = ''
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repoid-'))
    git('init', '-b', 'main')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('no rewrite → the configured origin', () => {
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    expect(repoForCwd(dir)).toEqual({ host: 'github.com', path: 'owner/repo' })
  })

  test('an ssh host alias rewrite still resolves to the real forge host', () => {
    // The multi-account pattern: ~/.ssh/config maps github-personal → github.com.
    // `git remote get-url` applies the rewrite, so the forge disappears behind
    // an alias that names no host we (or gh) know.
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    git('config', 'url.git@github-personal:.insteadOf', 'git@github.com:')
    expect(repoForCwd(dir)).toEqual({ host: 'github.com', path: 'owner/repo' })
  })

  test('a local mirror rewrite still resolves to the real forge host', () => {
    git('remote', 'add', 'origin', 'https://github.com/owner/repo.git')
    git('config', 'url./Users/t/mirrors/.insteadOf', 'https://github.com/')
    expect(repoForCwd(dir)).toEqual({ host: 'github.com', path: 'owner/repo' })
  })

  test('an unparseable alias origin falls back to its rewritten URL', () => {
    // The other direction: origin is stored as a short alias that only means
    // something once insteadOf expands it.
    git('remote', 'add', 'origin', 'gh:owner/repo.git')
    git('config', 'url.https://github.com/.insteadOf', 'gh:')
    expect(repoForCwd(dir)).toEqual({ host: 'github.com', path: 'owner/repo' })
  })

  test('no origin remote → null', () => {
    expect(repoForCwd(dir)).toBeNull()
  })

  test('originUrlFor hands out the clonable URL, not the machine-local rewrite', () => {
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    git('config', 'url.git@github-personal:.insteadOf', 'git@github.com:')
    expect(originUrlFor(dir)).toBe('git@github.com:owner/repo.git')
  })

  test('originUrlFor falls back to the rewritten URL for an alias origin', () => {
    git('remote', 'add', 'origin', 'gh:owner/repo.git')
    git('config', 'url.https://github.com/.insteadOf', 'gh:')
    expect(originUrlFor(dir)).toBe('https://github.com/owner/repo.git')
  })

  test('originUrlFor with no origin → empty', () => {
    expect(originUrlFor(dir)).toBe('')
  })
})

describe('getWorkingDiff', () => {
  let dir = ''
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
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

  test('non-repo path → ok:false', async () => {
    expect((await getWorkingDiff('')).ok).toBe(false)
  })

  test('on a feature branch: committed branch work + uncommitted + untracked all appear, base-only does not', async () => {
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

    const r = await getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.branch).toBe('feature')
    expect(r.diff).toContain('committed.txt') // committed branch work
    expect(r.diff).toContain('staged-edit') // uncommitted staged change
    expect(r.diff).toContain('untracked.txt') // untracked file as an addition
    expect(r.diff).not.toContain('more-on-main') // base-branch-only change excluded
  })

  test('on the base branch: only uncommitted/untracked changes appear', async () => {
    write('base.txt', 'base\nlocal-edit\n')
    write('new.txt', 'new file\n')
    const r = await getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.diff).toContain('local-edit')
    expect(r.diff).toContain('new.txt')
  })

  test('clean base branch → empty diff', async () => {
    const r = await getWorkingDiff(dir)
    expect(r.ok).toBe(true)
    expect(r.diff.trim()).toBe('')
  })

  test('git read helpers return promises', async () => {
    write('base.txt', 'base\nlocal-edit\n')

    const diff = getWorkingDiff(dir)
    const porcelain = getStatusPorcelain(dir)
    const head = getFileAtHead(dir, 'base.txt')
    const headBinary = getFileAtHeadBinary(dir, 'base.txt')

    expect(diff).toBeInstanceOf(Promise)
    expect(porcelain).toBeInstanceOf(Promise)
    expect(head).toBeInstanceOf(Promise)
    expect(headBinary).toBeInstanceOf(Promise)

    expect((await diff).diff).toContain('local-edit')
    expect(await porcelain).toContain(' M base.txt')
    expect(await head).toEqual({ ok: true, content: 'base\n' })
    expect(await headBinary).toEqual({
      ok: true,
      base64: Buffer.from('base\n').toString('base64'),
    })
  })
})
