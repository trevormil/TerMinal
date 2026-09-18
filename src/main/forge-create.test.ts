import { test, expect, afterEach } from 'bun:test'
import { createForgeRequest, forgeCreateAvailability, forgeCreateArgs } from './forge-create'
import { setForgeRunForTests } from './forge'
afterEach(() => setForgeRunForTests(null))
test('missing and unsupported remotes have actionable empty states', () => {
  expect(forgeCreateAvailability(null, 'auto')).toContain('origin')
  expect(forgeCreateAvailability({ host: 'bitbucket.org', path: 'a/b' }, 'auto')).toContain(
    'unsupported',
  )
  expect(forgeCreateAvailability({ host: 'forge.example.org', path: 'a/b' }, 'gitlab')).toBe('')
  expect(forgeCreateAvailability({ host: 'github.com', path: 'a/b' }, 'auto')).toBe('')
})
const input = {
  title: 'TER-37: Create PR',
  body: 'Ticket context\nkept',
  head: 'custom/branch',
  base: 'develop',
}
test('GitHub and GitLab API requests keep editable branches and markdown', () => {
  expect(forgeCreateArgs('github', 'a/b', input)).toEqual([
    'api',
    '--method',
    'POST',
    'repos/a/b/pulls',
    '-f',
    'title=' + input.title,
    '-f',
    'body=' + input.body,
    '-f',
    'head=custom/branch',
    '-f',
    'base=develop',
  ])
  expect(forgeCreateArgs('gitlab', 'group/sub/repo', input)).toContain(
    'projects/group%2Fsub%2Frepo/merge_requests',
  )
  expect(forgeCreateArgs('gitlab', 'a/b', input)).toContain('source_branch=custom/branch')
})
test('successful forge create returns the actual URL; failures remain visible', async () => {
  const context = { host: 'github.com', path: 'a/b' }
  setForgeRunForTests(async () => ({
    err: null,
    stdout: '{"html_url":"https://github.com/a/b/pull/1"}',
    stderr: '',
  }))
  expect(await createForgeRequest('/tmp', context, 'github', input)).toEqual({
    url: 'https://github.com/a/b/pull/1',
  })
  setForgeRunForTests(async () => ({
    err: new Error('failed'),
    stdout: '',
    stderr: 'branch not pushed',
  }))
  expect((await createForgeRequest('/tmp', context, 'github', input)).error).toContain(
    'branch not pushed',
  )
})
test('rejects missing fields and identical source and target before forge calls', async () => {
  setForgeRunForTests(async () => {
    throw new Error('must not execute')
  })
  expect(
    (
      await createForgeRequest('/tmp', { host: 'github.com', path: 'a/b' }, 'github', {
        ...input,
        head: '',
      })
    ).error,
  ).toBeTruthy()
  expect(
    (
      await createForgeRequest('/tmp', { host: 'github.com', path: 'a/b' }, 'github', {
        ...input,
        head: input.base,
      })
    ).error,
  ).toBeTruthy()
})

test('GitLab creation returns its native MR URL', async () => {
  setForgeRunForTests(async (cli, args) => {
    expect(cli).toBe('glab')
    expect(args).toContain('source_branch=custom/branch')
    expect(args).toContain('gitlab.example.org')
    return {
      err: null,
      stdout: '{"web_url":"https://gitlab.example.org/a/b/-/merge_requests/1"}',
      stderr: '',
    }
  })
  expect(
    await createForgeRequest('/tmp', { host: 'gitlab.example.org', path: 'a/b' }, 'gitlab', input),
  ).toEqual({ url: 'https://gitlab.example.org/a/b/-/merge_requests/1' })
})
