import { afterEach, expect, test } from 'bun:test'
import { setForgeRunForTests } from './forge'
import {
  gitlabDiscussions,
  postGitlabReply,
  setGitlabDiscussionResolved,
} from './gitlab-discussions'
const repo = { host: 'gitlab.example.com', path: 'group/repo' }
afterEach(() => setForgeRunForTests(null))
test('loads discussions and replies through the configured host', async () => {
  setForgeRunForTests(async (cli, args) => {
    expect(cli).toBe('glab')
    expect(args).toContain(repo.host)
    return {
      err: null,
      stderr: '',
      stdout: JSON.stringify([
        {
          id: 'abc123',
          individual_note: false,
          notes: [
            {
              id: 7,
              body: 'Review this',
              author: { username: 'reviewer' },
              position: { new_path: 'a.ts', new_line: 4 },
            },
          ],
        },
      ]),
    }
  })
  const result = await gitlabDiscussions('/tmp', repo, 1)
  expect(result).toMatchObject({
    supported: true,
    threads: [
      { discussionId: 'abc123', path: 'a.ts', line: 4, comments: [{ body: 'Review this' }] },
    ],
  })
  setForgeRunForTests(async (_cli, args) => {
    expect(args).toContain('projects/group%2Frepo/merge_requests/1/discussions/abc123/notes')
    expect(args).toContain('body=Literal `reply`\n$hello')
    return { err: null, stderr: '', stdout: '{}' }
  })
  expect(await postGitlabReply('/tmp', repo, 1, 'abc123', 'Literal `reply`\n$hello')).toEqual({
    ok: true,
  })
})
test('empty, malformed and authentication failures are surfaced', async () => {
  setForgeRunForTests(async () => ({ err: null, stderr: '', stdout: '[]' }))
  expect(await gitlabDiscussions('/tmp', repo, 1)).toMatchObject({ supported: true, threads: [] })
  setForgeRunForTests(async () => ({ err: null, stderr: '', stdout: 'oops' }))
  expect(await gitlabDiscussions('/tmp', repo, 1)).toMatchObject({ supported: false })
  setForgeRunForTests(async () => ({
    err: new Error('failed'),
    stderr: 'authentication required',
    stdout: '',
  }))
  expect(await gitlabDiscussions('/tmp', repo, 1)).toMatchObject({
    supported: false,
    reason: expect.stringContaining('auth'),
  })
  expect(await postGitlabReply('/tmp', repo, 1, 'abc', 'reply')).toMatchObject({
    ok: false,
    error: expect.stringContaining('auth'),
  })
  expect(await postGitlabReply('/tmp', repo, 1, '../bad', '')).toMatchObject({ ok: false })
})

test('loads subsequent pages and keeps individual notes non-replyable', async () => {
  let calls = 0
  setForgeRunForTests(async (_cli, args) => {
    calls++
    expect(args).toContain(
      `projects/group%2Frepo/merge_requests/1/discussions?per_page=100&page=${calls}`,
    )
    const count = calls === 1 ? 100 : 1
    return {
      err: null,
      stderr: '',
      stdout: JSON.stringify(
        Array.from({ length: count }, (_, index) => ({
          id: `${calls}-${index}`,
          individual_note: calls === 2,
          notes: [{ id: index, body: 'note' }],
        })),
      ),
    }
  })
  const result = await gitlabDiscussions('/tmp', repo, 1)
  expect(calls).toBe(2)
  expect(result.supported).toBe(true)
  if (result.supported) {
    expect(result.threads).toHaveLength(101)
    expect(result.threads[100].discussionId).toBeUndefined()
  }
})

for (const resolved of [true, false]) {
  test(`explicit GitLab discussion resolved=${resolved} uses PUT and a typed boolean`, async () => {
    setForgeRunForTests(async (cli, args) => {
      expect(cli).toBe('glab')
      expect(args).toEqual([
        'api',
        '--method',
        'PUT',
        'projects/group%2Frepo/merge_requests/1/discussions/abc',
        '--hostname',
        repo.host,
        '-F',
        `resolved=${resolved}`,
      ])
      return { err: null, stderr: '', stdout: '{}' }
    })
    expect(await setGitlabDiscussionResolved('/tmp', repo, 1, 'abc', resolved)).toEqual({
      ok: true,
    })
  })
}
test('resolution validates input and surfaces authentication/mutation failure', async () => {
  let calls = 0
  setForgeRunForTests(async () => {
    calls++
    return { err: new Error('failed'), stderr: 'authentication required', stdout: '' }
  })
  for (const [iid, id, resolved] of [
    [0, 'abc', true],
    [1, '../bad', false],
    [1, 'abc', 'true'],
  ] as const) {
    expect(
      await setGitlabDiscussionResolved('/tmp', repo, iid, id, resolved as boolean),
    ).toMatchObject({ ok: false })
  }
  expect(calls).toBe(0)
  expect(await setGitlabDiscussionResolved('/tmp', repo, 1, 'abc', true)).toMatchObject({
    ok: false,
    error: expect.stringContaining('auth'),
  })
})
test('only non-individual resolvable discussions offer resolution', async () => {
  setForgeRunForTests(async () => ({
    err: null,
    stderr: '',
    stdout: JSON.stringify([
      { id: 'a', notes: [{ id: 1, body: 'one', resolvable: true, resolved: false }] },
      { id: 'b', individual_note: true, notes: [{ id: 2, body: 'two', resolvable: true }] },
      { id: 'c', notes: [{ id: 3, body: 'three' }] },
    ]),
  }))
  const result = await gitlabDiscussions('/tmp', repo, 1)
  if (!result.supported) throw new Error(result.reason)
  expect(result.threads.map((t) => t.resolvable)).toEqual([true, false, false])
})
