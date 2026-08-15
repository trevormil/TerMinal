import { describe, expect, it } from 'bun:test'
import { createInboxWrites, type InboxWriteDeps } from './inbox-writes'
import type { RemoteSessionRef } from './remote'

const ref = (hostId: string): RemoteSessionRef => ({
  hostId,
  label: hostId.toUpperCase(),
  sshTarget: `user@${hostId}`,
})

type Call = [string, ...unknown[]]

function harness(opts: { hosts?: string[]; remoteFails?: boolean } = {}) {
  const calls: Call[] = []
  const known = new Set(opts.hosts ?? ['tm'])
  const fail = () => (opts.remoteFails ? Promise.reject(new Error('ssh down')) : null)
  const deps: InboxWriteDeps = {
    remoteFromHostId: (hostId) => (known.has(hostId) ? ref(hostId) : null),
    remote: {
      resolve: (r, id, resolved) => {
        calls.push(['remote.resolve', r.hostId, id, resolved])
        return fail() ?? Promise.resolve(true)
      },
      remove: (r, id) => {
        calls.push(['remote.remove', r.hostId, id])
        return fail() ?? Promise.resolve(true)
      },
      markRead: (r, ids, read) => {
        calls.push(['remote.markRead', r.hostId, ids, read])
        return fail() ?? Promise.resolve(ids.length)
      },
    },
    local: {
      resolve: (id, resolved) => {
        calls.push(['local.resolve', id, resolved])
        return true
      },
      remove: (id) => {
        calls.push(['local.remove', id])
        return true
      },
      markRead: (ids, read) => {
        calls.push(['local.markRead', ids, read])
        return ids.length
      },
    },
  }
  return { calls, writes: createInboxWrites(deps) }
}

describe('createInboxWrites', () => {
  it('writes locally when the item carries no hostId', async () => {
    const { calls, writes } = harness()
    expect(await writes.resolve('a')).toBe(true)
    expect(await writes.remove('a')).toBe(true)
    expect(await writes.markRead(['a', 'b'])).toBe(2)
    expect(calls).toEqual([
      ['local.resolve', 'a', true],
      ['local.remove', 'a'],
      ['local.markRead', ['a', 'b'], true],
    ])
  })

  it('routes every write to the host that owns the item', async () => {
    const { calls, writes } = harness()
    expect(await writes.resolve('a', false, 'tm')).toBe(true)
    expect(await writes.remove('a', 'tm')).toBe(true)
    expect(await writes.markRead(['a'], 'tm', false)).toBe(1)
    expect(calls).toEqual([
      ['remote.resolve', 'tm', 'a', false],
      ['remote.remove', 'tm', 'a'],
      ['remote.markRead', 'tm', ['a'], false],
    ])
    // Never ALSO written locally — the local file has no such item, and a
    // local readAt would be flipped back by the next remote fan-in anyway.
    expect(calls.some(([c]) => c.startsWith('local.'))).toBe(false)
  })

  it('falls back to the local write when the hostId is unknown', async () => {
    const { calls, writes } = harness({ hosts: [] })
    expect(await writes.resolve('a', true, 'ghost')).toBe(true)
    expect(calls).toEqual([['local.resolve', 'a', true]])
  })

  it('reports failure instead of throwing when the host is unreachable', async () => {
    const { writes } = harness({ remoteFails: true })
    expect(await writes.resolve('a', true, 'tm')).toBe(false)
    expect(await writes.remove('a', 'tm')).toBe(false)
    expect(await writes.markRead(['a'], 'tm')).toBe(0)
  })
})
