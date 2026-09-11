import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GtApi } from '../../lib/types'
import { reconcileFreshPlugins } from '../../lib/pluginVisibility'
import plugin from './index'

test('optional widget remains off until enabled and preserves saved preference', () => {
  expect(plugin.defaultEnabled).toBe(false)
  expect(reconcileFreshPlugins([plugin], [], [])?.enabled).toEqual([])
  expect(
    reconcileFreshPlugins([plugin, { id: 'new', defaultEnabled: false }], [plugin.id], [plugin.id])
      ?.enabled,
  ).toEqual([plugin.id])
  expect(
    reconcileFreshPlugins([plugin, { id: 'new', defaultEnabled: false }], [plugin.id], [])?.enabled,
  ).toEqual([])
})
test('remote and failed reads produce explicit empty states', async () => {
  const gt = { tabContext: async () => ({ remote: true }) } as unknown as GtApi
  expect((await plugin.poll(gt, null)).error).toContain('remote')
  gt.tabContext = async () => {
    throw new Error('unavailable')
  }
  expect((await plugin.poll(gt, null)).error).toContain('Could not read')
})

test('renders unknown counts distinctly from zero and positive recorded counts', async () => {
  const gt = {
    tabContext: async () => ({}),
    harnessTdd: async () => ({ ok: false }),
  } as unknown as GtApi
  expect(renderToStaticMarkup(plugin.render(await plugin.poll(gt, null)))).toContain(
    'No recorded test count',
  )
  for (const count of [0, 3]) {
    const html = renderToStaticMarkup(
      plugin.render({ info: { ok: true, number: 347, failedTests: count } as any }),
    )
    expect(html).toContain('recorded failures')
    expect(html).toContain('Historical count')
    expect(html).toContain('Open test review')
    expect(html).toContain(String(count))
  }
})
