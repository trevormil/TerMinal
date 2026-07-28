type Timer = ReturnType<typeof setTimeout>

type TickCoalescerOptions = {
  intervalMs?: number
  now?: () => number
  setTimeout?: (run: () => void, delay: number) => Timer | number
  clearTimeout?: (timer: Timer | number) => void
}

export function createTickCoalescer(run: () => void, options: TickCoalescerOptions = {}) {
  const intervalMs = options.intervalMs ?? 1_000
  const now = options.now ?? (() => Date.now())
  const schedule = options.setTimeout ?? ((cb, delay) => setTimeout(cb, delay))
  const clear = options.clearTimeout ?? ((timer) => clearTimeout(timer as Timer))
  let lastRunAt = -intervalMs
  let pending: Timer | number | null = null

  const fire = () => {
    pending = null
    lastRunAt = now()
    run()
  }

  return {
    trigger() {
      const elapsed = now() - lastRunAt
      if (elapsed >= intervalMs) {
        if (pending) {
          clear(pending)
          pending = null
        }
        fire()
        return
      }
      if (!pending) pending = schedule(fire, intervalMs - elapsed)
    },
    cancel() {
      if (!pending) return
      clear(pending)
      pending = null
    },
  }
}
