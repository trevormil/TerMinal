// Capability probing for IPC that may not be registered yet.
//
// A tab folder auto-registers via `import.meta.glob` in tabs/registry.ts, but
// its main-process handlers are wired by hand in src/main/index.ts. Those two
// can land in different commits, and `ipcRenderer.invoke` on an unregistered
// channel REJECTS ("No handler registered for ..."). Without this, a tab whose
// IPC hasn't landed still shows in the tab bar, its badge poll rejects on every
// tick, and opening it hangs on a promise that never resolves.
//
// So: probe once, cache the answer, hide the tab when the answer is "no", and
// let the component render an explicit unavailable state either way.

type State = 'unknown' | 'available' | 'missing'

const state = new Map<string, State>()
const inflight = new Map<string, Promise<boolean>>()

/** Has this capability been probed and found missing? `appliesTo` is sync, so
 *  it reads the cached answer; an unprobed capability is optimistically shown
 *  and hidden on the next tab-context recompute if the probe fails. */
export function capabilityMissing(key: string): boolean {
  return state.get(key) === 'missing'
}

/** Run the probe once per key. Safe to call from render — repeated calls join
 *  the in-flight promise instead of re-invoking. */
export function probeCapability(key: string, probe: () => Promise<unknown>): Promise<boolean> {
  const known = state.get(key)
  if (known === 'available') return Promise.resolve(true)
  if (known === 'missing') return Promise.resolve(false)
  const existing = inflight.get(key)
  if (existing) return existing
  const p = probe()
    .then(() => {
      state.set(key, 'available')
      return true
    })
    .catch(() => {
      state.set(key, 'missing')
      return false
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export function resetCapabilitiesForTests(): void {
  state.clear()
  inflight.clear()
}
