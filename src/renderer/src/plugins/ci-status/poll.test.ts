import { expect, test } from 'bun:test'
import plugin from './index'
import { latestCiRun } from './model'
import type { GtApi, CiRun } from '../../lib/types'

test('CI widget is opt-in and skips unsupported contexts', async () => {
  expect(plugin.defaultEnabled).toBe(false)
  for (const ctx of [{}, { repoRoot: '/repo', forgeKind: 'unsupported' }]) {
    const gt = {
      tabContext: async () => ctx,
      ci: {
        list: () => {
          throw new Error('must not call')
        },
      },
    } as unknown as GtApi
    expect((await plugin.poll(gt, null)).error).toMatch(/repo|remote/)
  }
})
test('both forges use the existing CI API with the current repo', async () => {
  for (const forgeKind of ['github', 'gitlab']) {
    const result = { runs: [], error: 'CLI not authenticated' }
    const gt = {
      tabContext: async () => ({ repoRoot: '/repo', repoHost: 'forge.test', forgeKind }),
      ci: {
        list: async (repo: string, limit: number) => {
          expect(repo).toBe('/repo')
          expect(limit).toBe(20)
          return result
        },
      },
    } as unknown as GtApi
    expect(await plugin.poll(gt, null)).toEqual(result)
  }
})
test('rejected calls show connection and authentication guidance', async () => {
  const gt = {
    tabContext: async () => {
      throw new Error('offline')
    },
  } as unknown as GtApi
  expect((await plugin.poll(gt, null)).error).toContain('authentication')
})
test('latest means creation time, not response order or an old run updated recently', () => {
  const runs = [
    { id: 'old', createdAt: 1, updatedAt: 100 },
    { id: 'new', createdAt: 2, updatedAt: 2 },
  ] as CiRun[]
  expect(latestCiRun(runs)?.id).toBe('new')
  expect(runs[0].id).toBe('old')
  expect(latestCiRun([])).toBeNull()
})
