import { describe, expect, test } from 'bun:test'
import { runUpdateBatch, type BatchHandlers } from './telegram-batch'

const collect = (over: Partial<BatchHandlers> = {}) => {
  const messages: string[] = []
  const callbacks: string[] = []
  const errors: { item: string; message: string }[] = []
  const offsets: number[] = []
  const handlers: BatchHandlers = {
    handleMessage: (t) => void messages.push(t),
    handleCallback: (d) => void callbacks.push(d),
    onError: (item, err) => void errors.push({ item, message: err.message }),
    commitOffset: (o) => void offsets.push(o),
    ...over,
  }
  return { handlers, messages, callbacks, errors, offsets }
}

// update_ids are 1-based and sequential here; callbacks continue the sequence.
const batch = (msgs: string[], cbs: string[] = []) => ({
  messages: msgs.map((text, i) => ({ updateId: i + 1, text })),
  callbacks: cbs.map((data, i) => ({
    updateId: msgs.length + i + 1,
    data,
    queryId: `q${i}`,
  })),
})

describe('runUpdateBatch', () => {
  test('dispatches every message and callback in order', async () => {
    const { handlers, messages, callbacks } = collect()
    const r = await runUpdateBatch(batch(['/runs', '/help'], ['run:tail:abc']), handlers)
    expect(messages).toEqual(['/runs', '/help'])
    expect(callbacks).toEqual(['run:tail:abc'])
    expect(r).toEqual({ handled: 3, failed: 0 })
  })

  // Finding C1: one throwing command used to abort the rest of the cycle —
  // permanently, because the offset had already been committed past them.
  test('one throwing message does not swallow the rest of the batch', async () => {
    const seen: string[] = []
    const { handlers, errors } = collect({
      handleMessage: async (t) => {
        if (t === '/boom') throw new Error('kaboom')
        seen.push(t)
      },
    })
    const r = await runUpdateBatch(batch(['/first', '/boom', '/third']), handlers)
    expect(seen).toEqual(['/first', '/third'])
    expect(r).toEqual({ handled: 2, failed: 1 })
    expect(errors).toEqual([{ item: '/boom', message: 'kaboom' }])
  })

  test('a throwing message does not drop the queued callback taps behind it', async () => {
    const { handlers, callbacks } = collect({
      handleMessage: () => {
        throw new Error('nope')
      },
    })
    await runUpdateBatch(batch(['/boom'], ['run:tail:1', 'run:cancel:2']), handlers)
    expect(callbacks).toEqual(['run:tail:1', 'run:cancel:2'])
  })

  test('a throwing callback is isolated the same way', async () => {
    const seen: string[] = []
    const { handlers, errors } = collect({
      handleCallback: (d) => {
        if (d === 'bad') throw new Error('cb failed')
        seen.push(d)
      },
    })
    const r = await runUpdateBatch(batch([], ['ok1', 'bad', 'ok2']), handlers)
    expect(seen).toEqual(['ok1', 'ok2'])
    expect(errors.map((e) => e.item)).toEqual(['bad'])
    expect(r.failed).toBe(1)
  })

  test('a rejected promise counts the same as a synchronous throw', async () => {
    const { handlers, errors } = collect({
      handleMessage: () => Promise.reject(new Error('async boom')),
    })
    const r = await runUpdateBatch(batch(['/x']), handlers)
    expect(r).toEqual({ handled: 0, failed: 1 })
    expect(errors[0].message).toBe('async boom')
  })

  // The reporter runs inside the loop; if IT throws (Telegram send fails while
  // reporting a failure), the batch must still finish — otherwise the exact bug
  // being fixed comes straight back.
  test('a failing error reporter does not abort the batch', async () => {
    const seen: string[] = []
    const r = await runUpdateBatch(batch(['/boom', '/after']), {
      handleMessage: (t) => {
        if (t === '/boom') throw new Error('kaboom')
        seen.push(t)
      },
      handleCallback: () => {},
      onError: () => {
        throw new Error('reply failed too')
      },
      commitOffset: () => {},
    })
    expect(seen).toEqual(['/after'])
    expect(r).toEqual({ handled: 1, failed: 1 })
  })

  test('an empty cycle is a no-op', async () => {
    const { handlers } = collect()
    expect(await runUpdateBatch(batch([]), handlers)).toEqual({ handled: 0, failed: 0 })
  })

  test('messages are processed sequentially, not raced', async () => {
    const order: string[] = []
    const { handlers } = collect({
      handleMessage: async (t) => {
        order.push(`start:${t}`)
        await new Promise((r) => setTimeout(r, t === '/slow' ? 20 : 1))
        order.push(`end:${t}`)
      },
    })
    await runUpdateBatch(batch(['/slow', '/fast']), handlers)
    expect(order).toEqual(['start:/slow', 'end:/slow', 'start:/fast', 'end:/fast'])
  })
})

// Finding: committing the cursor only at the END of a batch means a crash or
// quit mid-batch redelivers the WHOLE batch next launch — and a replayed
// Telegram command launches a duplicate agent run.
describe('offset commits', () => {
  test('commits after each item settles, not once at the end', async () => {
    const { handlers, offsets } = collect()
    await runUpdateBatch(batch(['/a', '/b'], ['cb']), handlers)
    expect(offsets).toEqual([2, 3, 4]) // updateId + 1, per item
  })

  test('a failed item still advances the cursor — no infinite redelivery', async () => {
    const { handlers, offsets } = collect({
      handleMessage: (t) => {
        if (t === '/boom') throw new Error('kaboom')
      },
    })
    await runUpdateBatch(batch(['/boom', '/ok']), handlers)
    expect(offsets).toEqual([2, 3])
  })

  // The replay window: whatever has been committed by the time the process dies
  // is not redelivered. Observing the cursor from INSIDE a later handler proves
  // earlier items were already durable, which is the property a crash relies on.
  test('earlier items are committed before later ones run', async () => {
    const seenWhileHandling: number[][] = []
    const offsets: number[] = []
    await runUpdateBatch(batch(['/first', '/second', '/third']), {
      handleMessage: () => void seenWhileHandling.push([...offsets]),
      handleCallback: () => {},
      onError: () => {},
      commitOffset: (o) => void offsets.push(o),
    })
    expect(seenWhileHandling).toEqual([[], [2], [2, 3]])
  })

  test('a failing offset write does not abort the batch', async () => {
    const seen: string[] = []
    const r = await runUpdateBatch(batch(['/a', '/b']), {
      handleMessage: (t) => void seen.push(t),
      handleCallback: () => {},
      onError: () => {},
      commitOffset: () => {
        throw new Error('disk full')
      },
    })
    expect(seen).toEqual(['/a', '/b'])
    expect(r.handled).toBe(2)
  })

  test('an update with no id is never committed', async () => {
    const { handlers, offsets } = collect()
    await runUpdateBatch({ messages: [{ updateId: 0, text: '/x' }], callbacks: [] }, handlers)
    expect(offsets).toEqual([])
  })
})
