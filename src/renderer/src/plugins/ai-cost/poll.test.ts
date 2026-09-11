import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GtApi } from '../../lib/types'
import plugin from './index'

test('cost widget is disabled by default and avoids local ledger on remote sessions', async () => {
  expect(plugin.defaultEnabled).toBe(false)
  const gt = {
    tabContext: async () => ({ remote: true }),
    observability: {
      runs: () => {
        throw new Error('must not read')
      },
    },
  } as unknown as GtApi
  expect((await plugin.poll(gt, null)).error).toContain('remote')
})
test('empty, error, and capped ledger results remain explicit', async () => {
  const gt = {
    tabContext: async () => ({}),
    observability: { runs: async () => [] },
  } as unknown as GtApi
  expect(renderToStaticMarkup(plugin.render(await plugin.poll(gt, null)))).toContain(
    'No local AI usage',
  )
  gt.observability.runs = async () => {
    throw new Error('read failed')
  }
  expect((await plugin.poll(gt, null)).error).toContain('Could not read')
  const html = renderToStaticMarkup(
    plugin.render({ todayUsd: 0, weekUsd: 2, todayRuns: 0, weekRuns: 1, capped: true }),
  )
  expect(html).toContain('No usage recorded today')
  expect(html).toContain('Partial window')
  expect(html).toContain('$2.00')
})
