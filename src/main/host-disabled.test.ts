import { describe, expect, test, beforeEach } from 'bun:test'
import {
  hostBreakerState,
  invalidateHostBreaker,
  parseHostDisabled,
  setHostDisabled,
  type HostDisabledDeps,
} from './host-disabled'
import type { RemoteSessionRef } from './remote'

// The host-side circuit breaker writes the HOST's agents/disabled.json. Reading
// only the Mac's copy is why a tripped schedule kept rendering enabled/healthy.
// These tests pin the read path (parse + per-host fetch + cache) and the
// re-enable write path over the same SSH seam, with the SSH boundary mocked.

const ref = (hostId: string): RemoteSessionRef => ({
  hostId,
  label: `${hostId} box`,
  sshTarget: hostId,
})

const deps = (
  over: Partial<HostDisabledDeps> & { fetch?: HostDisabledDeps['fetch'] } = {},
): HostDisabledDeps => ({
  fetch: async () => ({ scheduleIds: [], reasons: {} }),
  setDisabled: async () => true,
  now: () => 1_000,
  ttlMs: 15_000,
  ...over,
})

beforeEach(() => invalidateHostBreaker())

describe('parseHostDisabled', () => {
  test('reads the { scheduleIds, reasons } shape the runner writes', () => {
    const entries = parseHostDisabled(
      {
        scheduleIds: ['a', 'b'],
        reasons: { a: { reason: 'auto-disabled after 3 consecutive failures', at: 42 } },
      },
      ref('tm'),
    )
    expect(entries).toEqual([
      {
        id: 'a',
        host: 'tm',
        hostLabel: 'tm box',
        reason: 'auto-disabled after 3 consecutive failures',
        disabledAt: 42,
      },
      { id: 'b', host: 'tm', hostLabel: 'tm box', reason: undefined, disabledAt: 0 },
    ])
  })

  test('tolerates the legacy bare-array file and junk', () => {
    expect(parseHostDisabled(['x'], ref('tm')).map((e) => e.id)).toEqual(['x'])
    expect(parseHostDisabled(null, ref('tm'))).toEqual([])
    expect(parseHostDisabled({ scheduleIds: [1, 'y'] }, ref('tm')).map((e) => e.id)).toEqual(['y'])
  })
})

describe('hostBreakerState', () => {
  test('fetches each host once and flattens the entries', async () => {
    let calls = 0
    const snap = await hostBreakerState(
      [ref('tm'), ref('box2')],
      deps({
        fetch: async (r) => {
          calls++
          return { scheduleIds: [`${r.hostId}-sched`], reasons: {} }
        },
      }),
    )
    expect(calls).toBe(2)
    expect(snap.entries.map((e) => e.id).sort()).toEqual(['box2-sched', 'tm-sched'])
    expect(snap.errors).toEqual([])
  })

  test('an unreachable host is reported, never silently empty', async () => {
    const snap = await hostBreakerState(
      [ref('tm')],
      deps({
        fetch: async () => {
          throw new Error('ssh: connect timed out')
        },
      }),
    )
    expect(snap.entries).toEqual([])
    expect(snap.errors).toEqual([
      { host: 'tm', hostLabel: 'tm box', error: 'ssh: connect timed out' },
    ])
  })

  test('caches within the TTL so a re-render does not SSH per row', async () => {
    let calls = 0
    let clock = 1_000
    const d = deps({
      fetch: async () => {
        calls++
        return { scheduleIds: ['a'], reasons: {} }
      },
      now: () => clock,
      ttlMs: 10_000,
    })
    await hostBreakerState([ref('tm')], d)
    await hostBreakerState([ref('tm')], d)
    expect(calls).toBe(1)
    clock += 10_001
    await hostBreakerState([ref('tm')], d)
    expect(calls).toBe(2)
  })

  test('a mutation invalidates the cache, so the chip clears immediately', async () => {
    let ids = ['a']
    let calls = 0
    const d = deps({
      fetch: async () => {
        calls++
        return { scheduleIds: ids, reasons: {} }
      },
    })
    expect((await hostBreakerState([ref('tm')], d)).entries.map((e) => e.id)).toEqual(['a'])
    ids = []
    expect(await setHostDisabled(ref('tm'), 'a', false, d)).toEqual({ ok: true })
    expect((await hostBreakerState([ref('tm')], d)).entries).toEqual([])
    expect(calls).toBe(2)
  })
})

describe('setHostDisabled', () => {
  test('a host that says no is a refusal, not a network failure', async () => {
    const r = await setHostDisabled(
      ref('tm'),
      'nope',
      false,
      deps({ setDisabled: async () => false }),
    )
    expect(r).toEqual({
      ok: false,
      reason: 'refused',
      error: expect.stringContaining('tm box') as unknown as string,
    })
  })

  test('an SSH failure comes back unreachable with the ssh message', async () => {
    const r = await setHostDisabled(
      ref('tm'),
      'a',
      false,
      deps({
        setDisabled: async () => {
          throw new Error('Permission denied (publickey)')
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('unreachable')
    expect(r.error).toContain('publickey')
  })
})
