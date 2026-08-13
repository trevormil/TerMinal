import { describe, expect, test } from 'bun:test'
import { createPoller, type PollState, type PollerEnv } from './usePolled'

/**
 * Manual clock + visibility source. `usePolled` takes its timer and its
 * document-visibility source as injectable env precisely so the scheduling
 * rules below are testable without a DOM or real wall-clock waits.
 */
function fakeEnv() {
  let nextId = 1
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let hidden = false
  const listeners = new Set<() => void>()
  const env: PollerEnv = {
    setInterval: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, ms })
      return id
    },
    clearInterval: (id) => {
      timers.delete(id)
    },
    isHidden: () => hidden,
    onVisibilityChange: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return {
    env,
    timerCount: () => timers.size,
    intervals: () => [...timers.values()].map((t) => t.ms),
    /** Fire every registered interval once. */
    tick: () => {
      for (const t of [...timers.values()]) t.fn()
    },
    setHidden: (v: boolean) => {
      hidden = v
      for (const cb of [...listeners]) cb()
    },
    listenerCount: () => listeners.size,
  }
}

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function recorder<T>() {
  const states: PollState<T>[] = []
  return { states, onState: (s: PollState<T>) => void states.push(s), last: () => states.at(-1)! }
}

describe('createPoller', () => {
  test('fetches immediately and reports loading then data', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 1000,
      onState: rec.onState,
      env: f.env,
    })

    expect(calls).toBe(1)
    expect(rec.states[0]).toEqual({ data: null, error: null, loading: true })
    await flush()
    expect(rec.last()).toEqual({ data: 1, error: null, loading: false })
    poller.stop()
  })

  test('re-fetches on each interval tick', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 1500,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    expect(f.intervals()).toEqual([1500])

    f.tick()
    await flush()
    f.tick()
    await flush()

    expect(calls).toBe(3)
    expect(rec.last().data).toBe(3)
    poller.stop()
  })

  test('skips a tick while the previous fetch is still in flight', async () => {
    const f = fakeEnv()
    const rec = recorder<string>()
    const gate = deferred<string>()
    let calls = 0
    const poller = createPoller(
      async () => {
        calls++
        return gate.promise
      },
      { intervalMs: 100, onState: rec.onState, env: f.env },
    )
    expect(calls).toBe(1)

    f.tick()
    f.tick()
    await flush()
    expect(calls).toBe(1) // both ticks skipped — one request at a time

    gate.resolve('done')
    await flush()
    expect(rec.last().data).toBe('done')

    f.tick() // in-flight cleared, so this one runs
    await flush()
    expect(calls).toBe(2)
    poller.stop()
  })

  test('aborts the in-flight request and stops emitting after stop()', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    const gate = deferred<number>()
    let signal: AbortSignal | null = null
    const poller = createPoller(
      async (s) => {
        signal = s
        return gate.promise
      },
      { intervalMs: 100, onState: rec.onState, env: f.env },
    )

    expect(signal!.aborted).toBe(false)
    poller.stop()
    expect(signal!.aborted).toBe(true)
    expect(f.timerCount()).toBe(0)
    expect(f.listenerCount()).toBe(0)

    const before = rec.states.length
    gate.resolve(42)
    await flush()
    expect(rec.states.length).toBe(before) // late resolution is discarded
  })

  test('does not poll while the document is hidden', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    expect(calls).toBe(1)

    f.setHidden(true)
    f.tick()
    f.tick()
    await flush()
    expect(calls).toBe(1)
    poller.stop()
  })

  test('fetches immediately when the document becomes visible again', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    f.setHidden(true)
    f.tick()
    await flush()
    expect(calls).toBe(1)

    f.setHidden(false)
    await flush()
    expect(calls).toBe(2)
    expect(rec.last().data).toBe(2)
    poller.stop()
  })

  test('skips the first fetch when created while hidden, then catches up', async () => {
    const f = fakeEnv()
    f.setHidden(true)
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    expect(calls).toBe(0)

    f.setHidden(false)
    await flush()
    expect(calls).toBe(1)
    poller.stop()
  })

  test('surfaces a rejection as error and keeps the last good data', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(
      async () => {
        calls++
        if (calls === 2) throw new Error('boom')
        return calls
      },
      { intervalMs: 100, onState: rec.onState, env: f.env },
    )
    await flush()
    expect(rec.last()).toEqual({ data: 1, error: null, loading: false })

    f.tick()
    await flush()
    expect(rec.last().data).toBe(1)
    expect((rec.last().error as Error).message).toBe('boom')

    f.tick()
    await flush()
    expect(rec.last()).toEqual({ data: 3, error: null, loading: false })
    poller.stop()
  })

  test('refresh() aborts any in-flight request and starts a fresh one', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    const signals: AbortSignal[] = []
    const gates = [deferred<number>(), deferred<number>()]
    let calls = 0
    const poller = createPoller(
      async (s) => {
        signals.push(s)
        return gates[calls++].promise
      },
      { intervalMs: 100, onState: rec.onState, env: f.env },
    )
    expect(calls).toBe(1)

    poller.refresh()
    expect(calls).toBe(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    gates[0].resolve(1) // the abandoned request must not land
    gates[1].resolve(2)
    await flush()
    expect(rec.last().data).toBe(2)
    poller.stop()
  })

  test('an aborted fetch that rejects is not reported as an error', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    const gate = deferred<number>()
    const poller = createPoller(async () => gate.promise, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    poller.refresh()
    gate.reject(new DOMException('aborted', 'AbortError'))
    await flush()
    expect(rec.states.every((s) => s.error === null)).toBe(true)
    poller.stop()
  })

  test('intervalMs of 0 fetches once and registers no timer', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 0,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    expect(calls).toBe(1)
    expect(f.timerCount()).toBe(0)

    // A one-shot must not quietly re-fetch when the window regains focus.
    f.setHidden(true)
    f.setHidden(false)
    await flush()
    expect(calls).toBe(1)

    poller.refresh() // explicit refresh still works
    await flush()
    expect(calls).toBe(2)
    poller.stop()
  })

  test('a one-shot still fetches while the document is hidden', async () => {
    const f = fakeEnv()
    f.setHidden(true)
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 0,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    expect(calls).toBe(1)
    poller.stop()
  })

  test('stop() is idempotent', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    const poller = createPoller(async () => 1, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    poller.stop()
    poller.stop()
    expect(f.timerCount()).toBe(0)
  })

  test('refresh() after stop() is a no-op', async () => {
    const f = fakeEnv()
    const rec = recorder<number>()
    let calls = 0
    const poller = createPoller(async () => ++calls, {
      intervalMs: 100,
      onState: rec.onState,
      env: f.env,
    })
    await flush()
    poller.stop()
    poller.refresh()
    await flush()
    expect(calls).toBe(1)
  })
})
