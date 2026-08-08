import { describe, expect, test } from 'bun:test'
import { saveMonitors } from './index'
import type { Monitor, MonitorWithState } from '../../lib/types'

// The Monitoring tab writes optimistically: it paints the new list, then
// persists. The rejection used to be swallowed (`.catch(() => {})`), so a failed
// save left the UI showing a monitor that does not exist — silently disabled
// alerting until the 15s poll happened to overwrite it. These tests pin the
// rollback and the report.

const monitor = (id: string, enabled = true): MonitorWithState => ({
  id,
  name: id,
  type: 'http',
  target: 'https://example.com',
  intervalSec: 60,
  enabled,
  notify: {
    onFailure: 'normal',
    onRecovery: true,
    renotifyAfterSec: 3600,
    dailyDigest: false,
    digestHour: 9,
  },
  config: {},
  state: null,
})

function harness(save: (list: Monitor[]) => Promise<unknown>) {
  const painted: MonitorWithState[][] = []
  const flashed: string[] = []
  return {
    painted,
    flashed,
    io: {
      save,
      setMonitors: (list: MonitorWithState[]) => painted.push(list),
      flash: (m: string) => flashed.push(m),
    },
  }
}

describe('saveMonitors', () => {
  test('a successful save keeps the optimistic list and says nothing', async () => {
    const saved: Monitor[][] = []
    const h = harness(async (list) => {
      saved.push(list)
    })
    const next = [monitor('a'), monitor('b', false)]

    expect(await saveMonitors(next, [monitor('a')], h.io)).toBe(true)
    expect(h.painted).toEqual([next])
    expect(h.flashed).toEqual([])
    // The persisted payload must not carry the transient `state` field.
    expect(saved).toHaveLength(1)
    expect(saved[0]!.every((m) => !('state' in m))).toBe(true)
    expect(saved[0]!.map((m) => m.id)).toEqual(['a', 'b'])
  })

  test('a failed save rolls the list back to what was actually persisted', async () => {
    const prev = [monitor('a', true)]
    const next = [monitor('a', false)]
    const h = harness(() => Promise.reject(new Error('EROFS: read-only file system')))

    expect(await saveMonitors(next, prev, h.io)).toBe(false)
    // Painted optimistically first, then reverted — the LAST paint is what the
    // user is left looking at, and it must match the persisted truth.
    expect(h.painted).toEqual([next, prev])
    expect(h.painted.at(-1)).toBe(prev)
  })

  test('a failed save reports the reason instead of failing silently', async () => {
    const h = harness(() => Promise.reject(new Error('EROFS: read-only file system')))

    await saveMonitors([monitor('a')], [], h.io)

    expect(h.flashed).toHaveLength(1)
    expect(h.flashed[0]).toContain('EROFS: read-only file system')
    expect(h.flashed[0]!.toLowerCase()).toContain('save')
  })

  test('a non-Error rejection still produces a readable message', async () => {
    const h = harness(() => Promise.reject('nope'))

    await saveMonitors([monitor('a')], [], h.io)

    expect(h.flashed[0]).toContain('nope')
  })
})
