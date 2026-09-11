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

import { formatBytes } from './model'
test('formats bytes and renders successful and unavailable measurements', async () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1024)).toBe('1.0 KiB')
  expect(formatBytes(1024 ** 3 * 1.5)).toBe('1.5 GiB')
  expect(formatBytes(NaN)).toBe('—')
  const gt = {
    tabContext: async () => ({}),
    repoDiskUsage: async () => ({ bytes: 1024 }),
  } as unknown as GtApi
  expect(renderToStaticMarkup(plugin.render(await plugin.poll(gt, null)))).toContain('1.0 KiB')
  expect(renderToStaticMarkup(plugin.render({ error: 'Repo path is unavailable.' }))).toContain(
    'unavailable',
  )
})
