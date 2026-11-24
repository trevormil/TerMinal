import { expect, test } from 'bun:test'
import plugin from './index'
import type { GtApi } from '../../lib/types'

function api(context: object, result: object = { mrs: [] }) {
  let calls = 0
  return {
    gt: {
      tabContext: async () => context,
      listMrs: async () => {
        calls++
        return result
      },
    } as unknown as GtApi,
    calls: () => calls,
  }
}

test('disabled by default and avoids forge calls without a repo or supported remote', async () => {
  expect(plugin.defaultEnabled).toBe(false)
  for (const ctx of [
    {},
    { repoRoot: '/repo' },
    { repoRoot: '/repo', repoHost: 'example.com', forgeKind: 'unsupported' },
  ]) {
    const mock = api(ctx)
    expect((await plugin.poll(mock.gt, null)).error).toBeTruthy()
    expect(mock.calls()).toBe(0)
  }
})
test('GitHub and GitLab counts reuse the existing API and preserve auth errors', async () => {
  for (const forgeKind of ['github', 'gitlab']) {
    const result = { mrs: [], error: 'CLI not authenticated for this host' }
    const mock = api({ repoRoot: '/repo', repoHost: 'forge.example.com', forgeKind }, result)
    expect(await plugin.poll(mock.gt, null)).toEqual(result)
    expect(mock.calls()).toBe(1)
  }
})
test('rejected API calls produce an explicit empty state', async () => {
  const gt = {
    tabContext: async () => {
      throw new Error('offline')
    },
  } as unknown as GtApi
  expect((await plugin.poll(gt, null)).error).toContain('connection and authentication')
})
