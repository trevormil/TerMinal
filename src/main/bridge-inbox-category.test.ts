import { describe, expect, it, mock } from 'bun:test'

await mock.module('electron', () => ({
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
  shell: { openExternal: () => {} },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
}))

import type { BridgeDepsCtx } from './bridge-deps'

const { createBridgeDeps } = await import('./bridge-deps')
const { fileHitl } = await import('./hitl')

// The phone ships a full category sidebar (InboxCategories.swift) that keys off
// one field. The field existed on the desktop item and in the iOS model, but the
// bridge dropped it in the middle — so every item arrived Uncategorized, the
// sidebar's "is there more than one category?" gate never opened, and the whole
// surface was unreachable. Nothing failed loudly; it just never appeared.

const ctx: BridgeDepsCtx = {
  liveSessions: () => [],
  cliSrcPath: () => '/tmp/bin/terminal-cli',
  remoteFromHostId: () => null,
  hasWindow: () => true,
  openSessionInRenderer: () => true,
}

describe('inbox over the bridge', () => {
  it('carries the category the item was filed with', async () => {
    fileHitl({ title: 'cert expires in 3 days', source: 'monitor', category: 'Monitoring/Certs' })
    const items = await createBridgeDeps(ctx).hitl!()
    const item = items.find((h) => h.title === 'cert expires in 3 days')
    expect(item?.category).toBe('Monitoring/Certs')
  })

  it('leaves an uncategorised item uncategorised rather than inventing one', async () => {
    fileHitl({ title: 'plain item', source: 'agent' })
    const items = await createBridgeDeps(ctx).hitl!()
    expect(items.find((h) => h.title === 'plain item')?.category).toBeUndefined()
  })
})
