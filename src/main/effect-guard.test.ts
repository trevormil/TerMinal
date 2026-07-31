import { afterEach, describe, expect, test } from 'bun:test'
import {
  blockEffect,
  blockedEffects,
  effectsBlocked,
  guardedFetch,
  guardedSpawn,
  resetBlockedEffects,
} from './effect-guard'

// Run `fn` as production would see it: no test signals in the environment. The
// guard reads process.env on every call, which is what makes this possible —
// and is deliberately the ONLY way to observe the unguarded path, because an
// opt-out env var is exactly how test traffic reached a real phone.
async function asProduction<T>(fn: () => T | Promise<T>): Promise<T> {
  const node = process.env.NODE_ENV
  const block = process.env.TERMINAL_BLOCK_EFFECTS
  process.env.NODE_ENV = 'production'
  delete process.env.TERMINAL_BLOCK_EFFECTS
  try {
    return await fn()
  } finally {
    if (node === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = node
    if (block === undefined) delete process.env.TERMINAL_BLOCK_EFFECTS
    else process.env.TERMINAL_BLOCK_EFFECTS = block
  }
}

afterEach(() => resetBlockedEffects())

describe('effectsBlocked', () => {
  test('blocks under the suite we are running in', () => {
    expect(effectsBlocked()).toBe(true)
  })

  test('production is untouched — no test signal, no block', () => {
    expect(effectsBlocked({ NODE_ENV: 'production' })).toBe(false)
    expect(effectsBlocked({})).toBe(false)
  })

  test('NODE_ENV and TERMINAL_BLOCK_EFFECTS are independent signals', () => {
    // A test that clobbers NODE_ENV must not disarm the guard: the preload sets
    // the second one, and either alone is enough.
    expect(effectsBlocked({ NODE_ENV: 'test' })).toBe(true)
    expect(effectsBlocked({ NODE_ENV: 'production', TERMINAL_BLOCK_EFFECTS: '1' })).toBe(true)
  })
})

describe('blockEffect', () => {
  test('records what it stopped so a canary can prove it would have escaped', () => {
    expect(blockEffect('notify', 'hitl-telegram')).toBe(true)
    expect(blockEffect('activity', 'blocked')).toBe(true)
    expect(blockedEffects().map((b) => `${b.kind}:${b.label}`)).toEqual([
      'notify:hitl-telegram',
      'activity:blocked',
    ])
  })

  test('records nothing and permits the effect in production', async () => {
    await asProduction(() => {
      expect(blockEffect('notify', 'hitl-telegram')).toBe(false)
    })
    expect(blockedEffects()).toEqual([])
  })
})

describe('guardedFetch', () => {
  test('never reaches the network under test', async () => {
    const calls: unknown[] = []
    const real = globalThis.fetch
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve(new Response('should not happen'))
    }) as typeof fetch
    try {
      const res = await guardedFetch('telegram')('https://api.telegram.org/botX/sendMessage', {
        method: 'POST',
      })
      expect(calls).toEqual([])
      expect(res.status).toBe(204)
    } finally {
      globalThis.fetch = real
    }
    expect(blockedEffects().map((b) => b.label)).toEqual(['telegram'])
  })

  test('is plain fetch in production — the byte-identical path', async () => {
    const calls: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = ((input: string) => {
      calls.push(input)
      return Promise.resolve(new Response('ok'))
    }) as unknown as typeof fetch
    try {
      await asProduction(async () => {
        const res = await guardedFetch('telegram')('https://api.telegram.org/botX/sendMessage')
        expect(await res.text()).toBe('ok')
      })
    } finally {
      globalThis.fetch = real
    }
    expect(calls).toEqual(['https://api.telegram.org/botX/sendMessage'])
    expect(blockedEffects()).toEqual([])
  })
})

describe('guardedSpawn', () => {
  test('starts no process under test but is still fire-and-forget shaped', () => {
    // The notify callers do `spawn(...).unref()` and `.on('error', …)`; the
    // inert child has to survive both without launching anything.
    const child = guardedSpawn('telegram')('/bin/echo', ['pinged'], { stdio: 'ignore' })
    expect(child.pid).toBeUndefined()
    expect(() => child.on('error', () => {})).not.toThrow()
    expect(() => child.unref()).not.toThrow()
    expect(blockedEffects().map((b) => b.label)).toEqual(['telegram'])
  })

  test('really spawns in production', async () => {
    const pid = await asProduction(() => {
      const child = guardedSpawn('telegram')('/bin/echo', ['pinged'], { stdio: 'ignore' })
      const p = child.pid
      child.unref()
      return p
    })
    expect(typeof pid).toBe('number')
    expect(blockedEffects()).toEqual([])
  })
})
