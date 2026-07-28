import { describe, expect, test, beforeEach } from 'bun:test'
import { GIT_STATUS_TTL_MS, gitStatus, resetGitStatusCacheForTests } from './repo'

describe('gitStatus cache', () => {
  beforeEach(() => {
    resetGitStatusCacheForTests()
  })

  test('returns a promise', async () => {
    const deps = {
      now: () => 1_000,
      runGit: () => ['# branch.oid abc123', '# branch.head main'].join('\n'),
    }

    const status = gitStatus('/repo', deps)
    expect(status).toBeInstanceOf(Promise)
    expect(await status).toMatchObject({ ok: true, branch: 'main' })
  })

  test('coalesces interleaved cwd calls inside the TTL per repo', async () => {
    let now = 1_000
    const calls: string[] = []
    const deps = {
      now: () => now,
      runGit: (cwd: string, _args: string[]) => {
        calls.push(cwd)
        return [
          '# branch.oid abc123',
          `# branch.head ${cwd.endsWith('repo-a') ? 'main' : 'feature'}`,
        ].join('\n')
      },
    }

    expect((await gitStatus('/repo-a', deps)).branch).toBe('main')
    expect((await gitStatus('/repo-b', deps)).branch).toBe('feature')
    expect((await gitStatus('/repo-a', deps)).branch).toBe('main')
    expect((await gitStatus('/repo-b', deps)).branch).toBe('feature')

    expect(calls).toEqual(['/repo-a', '/repo-b'])
    now += GIT_STATUS_TTL_MS - 1
    expect((await gitStatus('/repo-a', deps)).branch).toBe('main')
    expect((await gitStatus('/repo-b', deps)).branch).toBe('feature')
    expect(calls).toEqual(['/repo-a', '/repo-b'])
  })

  test('coalesces back-to-back calls for the same cwd inside the TTL', async () => {
    let now = 1_000
    const calls: string[][] = []
    const deps = {
      now: () => now,
      runGit: (_cwd: string, args: string[]) => {
        calls.push(args)
        return [
          '# branch.oid abc123',
          '# branch.head main',
          '# branch.upstream origin/main',
          '# branch.ab +2 -1',
          '1 .M N... 100644 100644 100644 abc abc file.txt',
          '? new.txt',
        ].join('\n')
      },
    }

    for (let i = 0; i < 5; i++) {
      expect(await gitStatus('/repo', deps)).toMatchObject({
        ok: true,
        branch: 'main',
        ahead: 2,
        behind: 1,
        dirty: 2,
        upstream: true,
      })
    }
    expect(calls).toHaveLength(1)

    now += GIT_STATUS_TTL_MS - 1
    await gitStatus('/repo', deps)
    expect(calls).toHaveLength(1)

    now += 1
    await gitStatus('/repo', deps)
    expect(calls).toHaveLength(2)
  })

  test('reports detached HEAD as HEAD', async () => {
    const deps = {
      now: () => 1_000,
      runGit: () => ['# branch.oid abc123', '# branch.head (detached)'].join('\n'),
    }

    expect(await gitStatus('/repo', deps)).toMatchObject({ ok: true, branch: 'HEAD' })
  })

  test('returns ok false for non-git directories', async () => {
    const deps = {
      now: () => 1_000,
      runGit: () => {
        throw new Error('not a git repository')
      },
    }

    expect(await gitStatus('/not-git', deps)).toMatchObject({ ok: false })
  })
})
