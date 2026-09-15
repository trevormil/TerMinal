import { afterEach, expect, test } from 'bun:test'
import { setForgeRunForTests } from './forge'
import { postDiscussionComment } from './forge-comment'
afterEach(() => setForgeRunForTests(null))
for (const kind of ['github', 'gitlab'] as const) {
  test(`${kind} posts a general discussion comment with literal markdown`, async () => {
    setForgeRunForTests(async (cli, args) => {
      expect(cli).toBe(kind === 'github' ? 'gh' : 'glab')
      expect(args).toContain(
        kind === 'github'
          ? 'repos/group/repo/issues/347/comments'
          : 'projects/group%2Frepo/merge_requests/347/notes',
      )
      expect(args).toContain('body=Hello\n`code` $literal')
      expect(args).toContain('--hostname')
      return { err: null, stdout: '{}', stderr: '' }
    })
    expect(
      await postDiscussionComment(
        '/tmp',
        { host: `${kind}.com`, path: 'group/repo' },
        kind,
        347,
        'Hello\n`code` $literal',
      ),
    ).toEqual({ ok: true })
  })
}
test('comment failures surface auth errors and reject invalid requests without posting', async () => {
  let calls = 0
  setForgeRunForTests(async () => {
    calls++
    return { err: new Error('failed'), stdout: '', stderr: 'authentication required' }
  })
  const repo = { host: 'github.com', path: 'a/b' }
  expect(await postDiscussionComment('/tmp', repo, 'github', 1, 'hello')).toMatchObject({
    ok: false,
    error: expect.stringContaining('auth'),
  })
  expect(await postDiscussionComment('/tmp', repo, 'github', 1, '  ')).toMatchObject({ ok: false })
  expect(await postDiscussionComment('/tmp', repo, 'github', -1, 'hello')).toMatchObject({
    ok: false,
  })
  expect(calls).toBe(1)
})
