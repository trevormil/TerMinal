import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { worktreeOwnerRepo } from './run-retention'

// The cron-worktrees entries are REGISTERED git worktrees. Deleting the
// directory without pruning leaves `.git/worktrees/<name>` behind, and git then
// treats the branch as still checked out. These tests pin the resolution step
// that makes the prune possible — everything runs in a temp dir.

const made: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'gt-wt-'))
  made.push(d)
  return d
}
const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

describe('worktreeOwnerRepo', () => {
  test('resolves the owning repo of a registered worktree, so it can be pruned after removal', () => {
    const repo = tmp()
    git(repo, ['init', '--quiet', '-b', 'main'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'T'])
    writeFileSync(join(repo, 'f.txt'), 'x')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'init'])

    const wt = join(tmp(), 'wt')
    git(repo, ['worktree', 'add', '-q', '-b', 'cron/x', wt])
    expect(existsSync(wt)).toBe(true)

    const owner = worktreeOwnerRepo(wt)
    expect(owner).not.toBe('')
    // Must point at the ORIGINAL repo's git dir, not the worktree's own stub.
    // realpath both sides: on macOS /var is a symlink to /private/var.
    expect(realpathSync(owner)).toBe(realpathSync(join(repo, '.git')))

    // The whole point: deleting the dir alone leaves a stale registration, and
    // pruning against the resolved owner is what clears it.
    rmSync(wt, { recursive: true, force: true })
    expect(git(repo, ['worktree', 'list'])).toContain('prunable')
    execFileSync('git', ['--git-dir', owner, 'worktree', 'prune'], { stdio: 'ignore' })
    expect(git(repo, ['worktree', 'list'])).not.toContain('cron/x')
  })

  test('returns empty for a plain directory that was never a worktree', () => {
    expect(worktreeOwnerRepo(tmp())).toBe('')
  })
})
