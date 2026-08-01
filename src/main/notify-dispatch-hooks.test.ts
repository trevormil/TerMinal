import { afterEach, describe, expect, test } from 'bun:test'
import {
  dispatchAlert,
  resetNotifyHooks,
  setDeliveryRecorder,
  setSnoozeGate,
  type DeliveryOutcome,
  type NotifyChannel,
} from './notify-channels'

afterEach(resetNotifyHooks)

function recordingChannel(id: NotifyChannel['id'], behaviour: 'ok' | 'throw' | 'reject' = 'ok') {
  const titles: string[] = []
  const ch: NotifyChannel = {
    id,
    enabled: () => true,
    send: (_k, title) => {
      titles.push(title)
      if (behaviour === 'throw') throw new Error('sync boom')
      if (behaviour === 'reject') return Promise.reject(new Error('async boom'))
    },
  }
  return { ch, titles }
}

const blockedEv = (over: Record<string, unknown> = {}) => ({
  kind: 'blocked',
  title: 'Needs you',
  detail: 'a question',
  ...over,
})

describe('snooze gate', () => {
  test('a snoozed inbox item is silent on every channel', () => {
    const a = recordingChannel('telegram')
    const b = recordingChannel('desktop')
    setSnoozeGate((id) => id === 'h1')
    dispatchAlert([a.ch, b.ch], blockedEv({ hitlId: 'h1' }))
    expect(a.titles).toEqual([])
    expect(b.titles).toEqual([])
  })

  test('a different inbox item still delivers', () => {
    const a = recordingChannel('telegram')
    setSnoozeGate((id) => id === 'h1')
    dispatchAlert([a.ch], blockedEv({ hitlId: 'h2' }))
    expect(a.titles).toEqual(['Needs you'])
  })

  test('alerts with no hitlId are never gated', () => {
    const a = recordingChannel('telegram')
    setSnoozeGate(() => true)
    dispatchAlert([a.ch], blockedEv())
    expect(a.titles).toEqual(['Needs you'])
  })

  test('with no gate installed nothing is suppressed', () => {
    const a = recordingChannel('telegram')
    dispatchAlert([a.ch], blockedEv({ hitlId: 'h1' }))
    expect(a.titles).toEqual(['Needs you'])
  })
})

describe('delivery recorder', () => {
  // Successes resolve through a microtask (send may be async), so every
  // success assertion has to flush the queue first.
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  test('records a success per channel', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([recordingChannel('telegram').ch, recordingChannel('desktop').ch], blockedEv())
    await flush()
    expect(out.map((o) => `${o.channel}:${o.ok}`).sort()).toEqual(['desktop:true', 'telegram:true'])
    expect(out[0].title).toBe('Needs you')
  })

  test('records a synchronous throw with its reason', () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([recordingChannel('webhook', 'throw').ch], blockedEv())
    expect(out).toHaveLength(1)
    expect(out[0].ok).toBe(false)
    expect(out[0].error).toContain('sync boom')
  })

  test('records an async rejection with its reason', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([recordingChannel('webhook', 'reject').ch], blockedEv())
    await Promise.resolve()
    await Promise.resolve()
    expect(out).toHaveLength(1)
    expect(out[0].ok).toBe(false)
    expect(out[0].error).toContain('async boom')
  })

  test('one failing channel does not stop the others being recorded', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert(
      [recordingChannel('webhook', 'throw').ch, recordingChannel('desktop').ch],
      blockedEv(),
    )
    await flush()
    expect(out.some((o) => o.channel === 'webhook' && !o.ok)).toBe(true)
    expect(out.some((o) => o.channel === 'desktop' && o.ok)).toBe(true)
  })

  test('a disabled channel is not recorded as a delivery at all', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    const off: NotifyChannel = { id: 'webhook', enabled: () => false, send: () => {} }
    dispatchAlert([off], blockedEv())
    await flush()
    expect(out).toEqual([])
  })

  test('a snoozed alert records nothing — it was never attempted', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    setSnoozeGate(() => true)
    dispatchAlert([recordingChannel('telegram').ch], blockedEv({ hitlId: 'h1' }))
    await flush()
    expect(out).toEqual([])
  })
})

describe('HTTP-level delivery failures', () => {
  const httpChannel = (id: NotifyChannel['id'], status: number): NotifyChannel => ({
    id,
    enabled: () => true,
    // Mirrors the real channels: fetch resolves, assertDelivered decides.
    send: async () => {
      const res = new Response(status === 200 ? 'ok' : 'Unauthorized', { status })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    },
  })

  test('a revoked token (401) is recorded as a FAILURE, not a success', async () => {
    // The exact failure the delivery log was built to catch. `fetch` only
    // rejects on transport errors, so without an explicit res.ok check a 401
    // resolved and logged ok:true.
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([httpChannel('telegram', 401)], blockedEv())
    await Promise.resolve()
    await Promise.resolve()
    expect(out).toHaveLength(1)
    expect(out[0].ok).toBe(false)
    expect(out[0].error).toContain('401')
  })

  test('a dead webhook (404) is recorded as a failure with its status', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([httpChannel('webhook', 404)], blockedEv())
    await Promise.resolve()
    await Promise.resolve()
    expect(out[0].ok).toBe(false)
    expect(out[0].error).toContain('404')
  })

  test('a 200 still records a success', async () => {
    const out: DeliveryOutcome[] = []
    setDeliveryRecorder((o) => out.push(o))
    dispatchAlert([httpChannel('webhook', 200)], blockedEv())
    await Promise.resolve()
    await Promise.resolve()
    expect(out[0].ok).toBe(true)
  })
})
