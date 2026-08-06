import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gitBranches,
  gitCheckout,
  gitCompareFilesPatch,
  gitCreateBranch,
  gitLog,
  gitShow,
  gitStashes,
  gitTags,
  gitWorkingFilePatch,
} from './git-views'

// Real git in a temp repo — these functions are thin parsers over git plumbing,
// and the parsing (field/record separators, decorations, numstat) is exactly
// what a mock would hide.

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

const git = (root: string, args: string[]) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tm-gitviews-'))
  made.push(dir)
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test User'])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'first commit'])
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'b.txt'), 'bee\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'second commit\n\nwith a body line'])
  return dir
}

describe('gitLog', () => {
  test('lists commits newest-first with author, date, and subject', () => {
    const root = repo()
    const r = gitLog(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.commits.length).toBe(2)
    expect(r.commits[0].subject).toBe('second commit')
    expect(r.commits[1].subject).toBe('first commit')
    expect(r.commits[0].author).toBe('Test User')
    expect(r.commits[0].sha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.commits[0].shortSha.length).toBeGreaterThanOrEqual(7)
    expect(r.commits[0].date).toBeGreaterThan(0)
    expect(r.commits[0].parents).toEqual([r.commits[1].sha])
  })

  test('HEAD commit carries its ref decorations', () => {
    const root = repo()
    const r = gitLog(root)
    if (!r.ok) throw new Error('log failed')
    expect(r.commits[0].refs.join(' ')).toContain('main')
  })

  test('limit + skip page through history; ref filters to a branch', () => {
    const root = repo()
    const page = gitLog(root, { limit: 1, skip: 1 })
    if (!page.ok) throw new Error('log failed')
    expect(page.commits.length).toBe(1)
    expect(page.commits[0].subject).toBe('first commit')
    // A branch pinned at the first commit only sees one commit.
    const first = gitLog(root, { limit: 1, skip: 1 })
    if (!first.ok) throw new Error('log failed')
    git(root, ['branch', 'old', first.commits[0].sha])
    const scoped = gitLog(root, { ref: 'old' })
    if (!scoped.ok) throw new Error('log failed')
    expect(scoped.commits.length).toBe(1)
  })

  test('not a repo → ok:false with an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-gitviews-norepo-'))
    made.push(dir)
    const r = gitLog(dir)
    expect(r.ok).toBe(false)
  })
})

describe('gitShow', () => {
  test('returns meta, per-file numstat, and the patch', () => {
    const root = repo()
    const log = gitLog(root)
    if (!log.ok) throw new Error('log failed')
    const r = gitShow(root, log.commits[0].sha)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.subject).toBe('second commit')
    expect(r.body).toContain('with a body line')
    expect(r.author).toBe('Test User')
    const paths = r.files.map((f) => f.path).sort()
    expect(paths).toEqual(['a.txt', 'b.txt'])
    const b = r.files.find((f) => f.path === 'b.txt')
    expect(b?.insertions).toBe(1)
    expect(r.patch).toContain('+two')
    expect(r.patch).toContain('+bee')
  })

  test('unknown ref → ok:false', () => {
    const root = repo()
    expect(gitShow(root, 'deadbeef').ok).toBe(false)
  })
})

describe('gitBranches', () => {
  test('lists local branches with the current one flagged', () => {
    const root = repo()
    git(root, ['branch', 'feature/x'])
    const r = gitBranches(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const names = r.branches.map((b) => b.name)
    expect(names).toContain('main')
    expect(names).toContain('feature/x')
    expect(r.branches.find((b) => b.name === 'main')?.current).toBe(true)
    expect(r.branches.find((b) => b.name === 'feature/x')?.current).toBe(false)
    expect(r.branches.every((b) => !b.remote)).toBe(true)
    expect(r.branches[0].sha).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('gitCheckout + gitCreateBranch', () => {
  test('create switches to the new branch; checkout switches back', () => {
    const root = repo()
    const created = gitCreateBranch(root, 'feat/new-thing')
    expect(created.ok).toBe(true)
    expect(git(root, ['branch', '--show-current']).trim()).toBe('feat/new-thing')
    const back = gitCheckout(root, 'main')
    expect(back.ok).toBe(true)
    expect(git(root, ['branch', '--show-current']).trim()).toBe('main')
  })

  test('bad branch names surface git errors instead of throwing', () => {
    const root = repo()
    expect(gitCheckout(root, 'does-not-exist').ok).toBe(false)
    expect(gitCreateBranch(root, 'bad name with spaces').ok).toBe(false)
  })
})

describe('gitStashes + gitTags', () => {
  test('stash list parses ref, branch, and subject', () => {
    const root = repo()
    writeFileSync(join(root, 'a.txt'), 'stashed change\n')
    git(root, ['stash', 'push', '-m', 'wip: a change'])
    const r = gitStashes(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stashes.length).toBe(1)
    expect(r.stashes[0].ref).toBe('stash@{0}')
    expect(r.stashes[0].subject).toContain('wip: a change')
    // A stash ref renders through gitShow like any commit.
    expect(gitShow(root, r.stashes[0].ref).ok).toBe(true)
  })

  test('empty stash list is ok, not an error', () => {
    const root = repo()
    const r = gitStashes(root)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.stashes).toEqual([])
  })

  test('working-file patch: modified tracked file diffs vs HEAD', () => {
    const root = repo()
    writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    const r = gitWorkingFilePatch(root, 'a.txt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch).toContain('+three')
    expect(r.patch).toContain('a.txt')
  })

  test('working-file patch: untracked file renders as a whole-file addition', () => {
    const root = repo()
    writeFileSync(join(root, 'new.txt'), 'brand new\n')
    const r = gitWorkingFilePatch(root, 'new.txt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch).toContain('+brand new')
  })

  test('working-file patch: unchanged file → ok with an empty patch', () => {
    const root = repo()
    const r = gitWorkingFilePatch(root, 'a.txt')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch.trim()).toBe('')
  })

  test('compare-files patch diffs two working-tree files', () => {
    const root = repo()
    const r = gitCompareFilesPatch(root, 'a.txt', 'b.txt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch).toContain('-one')
    expect(r.patch).toContain('+bee')
  })

  test('tags list name, target sha, and subject, newest first', () => {
    const root = repo()
    git(root, ['tag', '-a', 'v1.0.0', '-m', 'release one'])
    const r = gitTags(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tags.length).toBe(1)
    expect(r.tags[0].name).toBe('v1.0.0')
    expect(r.tags[0].sha).toMatch(/^[0-9a-f]{40}$/)
    expect(gitShow(root, r.tags[0].name).ok).toBe(true)
  })
})
