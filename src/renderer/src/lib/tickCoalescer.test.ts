import { describe, expect, test } from 'bun:test'
import { createTickCoalescer } from './tickCoalescer'

describe('createTickCoalescer', () => {
  test('runs immediately once, then coalesces burst ticks to one trailing run per interval', () => {
    let now = 0
    let calls = 0
    let pendingDelay = 0
    let pendingRun: () => void = () => {
      throw new Error('tick was not scheduled')
    }
    const coalescer = createTickCoalescer(
      () => {
        calls++
      },
      {
        intervalMs: 1_000,
        now: () => now,
        setTimeout: (run, delay) => {
          pendingDelay = delay
          pendingRun = run
          return 1
        },
        clearTimeout: () => {
          pendingRun = () => {}
        },
      },
    )

    coalescer.trigger()
    expect(calls).toBe(1)

    now = 100
    coalescer.trigger()
    coalescer.trigger()
    expect(calls).toBe(1)
    expect(pendingDelay).toBe(900)

    now = 1_000
    pendingRun()
    expect(calls).toBe(2)

    coalescer.cancel()
  })
})
