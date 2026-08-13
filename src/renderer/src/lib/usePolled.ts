import { useEffect, useRef, useState } from 'react'

// One polling implementation for the whole renderer. Every tab that wanted a
// live list grew its own `setInterval` + `let alive` pair, and each copy got a
// different subset of the four things that actually matter: aborting on
// unmount, not stacking overlapping requests, not burning IPC while the window
// is hidden, and fetching once immediately instead of waiting a full interval.
// This gets all four right once.
//
// The scheduling core is `createPoller` — a plain function with its timer and
// visibility source injected, so the rules above are unit-testable without a
// DOM. `usePolled` is the thin React binding.

export type PollState<T> = {
  data: T | null
  error: unknown
  loading: boolean
}

export type PollerEnv = {
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
  isHidden: () => boolean
  onVisibilityChange: (cb: () => void) => () => void
}

function browserEnv(): PollerEnv {
  return {
    setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
    clearInterval: (id) => clearInterval(id),
    isHidden: () => (typeof document === 'undefined' ? false : document.hidden),
    onVisibilityChange: (cb) => {
      if (typeof document === 'undefined') return () => {}
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
  }
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError'
}

export type Poller = {
  /** Abandon any in-flight request and fetch again right now. */
  refresh: () => void
  /** Tear down: clear the interval, abort in flight, stop emitting. */
  stop: () => void
}

export function createPoller<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: {
    intervalMs: number
    onState: (state: PollState<T>) => void
    env?: PollerEnv
  },
): Poller {
  const env = opts.env ?? browserEnv()
  // `intervalMs <= 0` means one-shot: fetch now, never on a timer. Callers use
  // it for data that only changes when a dep does (a finished run's log). A
  // one-shot ignores visibility entirely — it has no catch-up to schedule, so
  // skipping it while hidden would just lose the only fetch it ever makes.
  const repeating = opts.intervalMs > 0
  let state: PollState<T> = { data: null, error: null, loading: true }
  let stopped = false
  let inFlight: AbortController | null = null

  const emit = (patch: Partial<PollState<T>>) => {
    if (stopped) return
    state = { ...state, ...patch }
    opts.onState(state)
  }

  const run = () => {
    if (stopped || (repeating && env.isHidden())) return
    const controller = new AbortController()
    inFlight = controller
    void (async () => {
      try {
        const data = await fetcher(controller.signal)
        if (controller.signal.aborted) return
        emit({ data, error: null, loading: false })
      } catch (error) {
        // An abort is our own doing (unmount, refresh, dep change) — never a
        // failure the user should see.
        if (controller.signal.aborted || isAbortError(error)) return
        emit({ error, loading: false })
      } finally {
        if (inFlight === controller) inFlight = null
      }
    })()
  }

  const tick = () => {
    if (inFlight) return // one request at a time; a slow backend must not stack
    run()
  }

  const abortInFlight = () => {
    inFlight?.abort()
    inFlight = null
  }

  opts.onState(state)
  run()

  const timerId = repeating ? env.setInterval(tick, opts.intervalMs) : null
  const offVisibility = repeating
    ? env.onVisibilityChange(() => {
        // Coming back to a stale list is the whole reason to poll, so catch up
        // at once rather than waiting out the interval that elapsed while hidden.
        if (!env.isHidden()) tick()
      })
    : () => {}

  return {
    refresh: () => {
      if (stopped) return
      abortInFlight()
      run()
    },
    stop: () => {
      if (stopped) return
      stopped = true
      if (timerId !== null) env.clearInterval(timerId)
      offVisibility()
      abortInFlight()
    },
  }
}

export type UsePolledOptions = {
  intervalMs: number
  /** Restart the poll when any of these change (same role as a useEffect dep array). */
  deps?: unknown[]
  /** When false, nothing is fetched and no timer runs. Defaults to true. */
  enabled?: boolean
}

export type UsePolledResult<T> = PollState<T> & { refresh: () => void }

/**
 * Poll `fetch` every `intervalMs`. The callback is read through a ref, so an
 * inline arrow (the normal case) does not restart the poll on every render —
 * only `deps`, `intervalMs` and `enabled` do.
 */
export function usePolled<T>(
  fetch: (signal: AbortSignal) => Promise<T>,
  opts: UsePolledOptions,
): UsePolledResult<T> {
  const { intervalMs, enabled = true } = opts
  const deps = opts.deps ?? []
  const fetchRef = useRef(fetch)
  fetchRef.current = fetch
  const pollerRef = useRef<Poller | null>(null)
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: enabled })

  useEffect(() => {
    if (!enabled) {
      pollerRef.current = null
      setState({ data: null, error: null, loading: false })
      return
    }
    const poller = createPoller<T>((signal) => fetchRef.current(signal), {
      intervalMs,
      onState: setState,
    })
    pollerRef.current = poller
    return () => {
      pollerRef.current = null
      poller.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps])

  const refresh = useRef(() => pollerRef.current?.refresh()).current
  return { ...state, refresh }
}
