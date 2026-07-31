import { afterEach, describe, expect, test } from 'bun:test'
import { postThreadComment, setForgeRunForTests, type RunResult } from './forge'

// Every call goes through the injected run seam — no gh/glab process is ever
// spawned, and no real PR is ever commented on.
type Call = { cli: string; args: string[] }

function record(result: Partial<RunResult> = {}): { calls: Call[] } {
  const calls: Call[] = []
  setForgeRunForTests(async (cli, args) => {
    calls.push({ cli, args })
    return { err: null, stdout: '', stderr: '', ...result }
  })
  return { calls }
}

afterEach(() => setForgeRunForTests(null))

describe('postThreadComment', () => {
  test('github without a location posts a plain PR comment', async () => {
    const { calls } = record()
    const r = await postThreadComment('/repo', 12, 'hello', { kind: 'github', cli: 'gh' } as never)
    expect(r.ok).toBe(true)
    expect(calls[0].cli).toBe('gh')
    expect(calls[0].args.slice(0, 3)).toEqual(['pr', 'comment', '12'])
    expect(calls[0].args).toContain('hello')
  })

  test('gitlab without a location posts an MR note', async () => {
    const { calls } = record()
    await postThreadComment('/repo', 12, 'hello', { kind: 'gitlab', cli: 'glab' } as never)
    expect(calls[0].cli).toBe('glab')
    expect(calls[0].args.slice(0, 3)).toEqual(['mr', 'note', '12'])
  })

  test('github WITH a file/line/sha posts a true inline review comment via the API', async () => {
    const { calls } = record()
    await postThreadComment('/repo', 12, 'hello', { kind: 'github', cli: 'gh' } as never, {
      path: 'src/a.ts',
      line: 9,
      commitSha: 'deadbeef',
    })
    const a = calls[0].args
    expect(a[0]).toBe('api')
    expect(a.join(' ')).toContain('/pulls/12/comments')
    expect(a.join(' ')).toContain('path=src/a.ts')
    expect(a.join(' ')).toContain('line=9')
    expect(a.join(' ')).toContain('commit_id=deadbeef')
    // RIGHT = the post-change side; a finding is about the new code.
    expect(a.join(' ')).toContain('side=RIGHT')
  })

  test('an inline post that the API rejects falls back to a plain comment rather than vanishing', async () => {
    const calls: Call[] = []
    let n = 0
    setForgeRunForTests(async (cli, args) => {
      calls.push({ cli, args })
      return n++ === 0
        ? { err: new Error('422'), stdout: '', stderr: 'line must be part of the diff' }
        : { err: null, stdout: '', stderr: '' }
    })
    const r = await postThreadComment(
      '/repo',
      12,
      'hello',
      { kind: 'github', cli: 'gh' } as never,
      {
        path: 'src/a.ts',
        line: 9,
        commitSha: 'deadbeef',
      },
    )
    expect(r.ok).toBe(true)
    expect(r.inline).toBe(false)
    expect(calls).toHaveLength(2)
    expect(calls[1].args.slice(0, 2)).toEqual(['pr', 'comment'])
  })

  test('gitlab has no inline path here — it degrades to a note without pretending', async () => {
    const { calls } = record()
    const r = await postThreadComment(
      '/repo',
      12,
      'hello',
      { kind: 'gitlab', cli: 'glab' } as never,
      { path: 'src/a.ts', line: 9, commitSha: 'deadbeef' },
    )
    expect(r.inline).toBe(false)
    expect(calls[0].args.slice(0, 2)).toEqual(['mr', 'note'])
  })

  test('a hard failure surfaces the CLI stderr instead of reporting success', async () => {
    record({ err: new Error('boom'), stderr: 'not authenticated' })
    const r = await postThreadComment('/repo', 12, 'hi', { kind: 'github', cli: 'gh' } as never)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not authenticated')
  })
})
