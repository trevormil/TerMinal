// Tiny cross-tab navigation bus. Any tab can dispatch a `navigateTo()` and
// the SessionView listens to switch the active tab; receiving tabs listen for
// the same event to pre-select an item (a run id, a ticket slug, etc.).
//
// We keep this dirt-simple: a window-level CustomEvent. No global store, no
// React context — tabs that don't care never touch it, and tabs that do can
// subscribe with a one-line useEffect.

export type NavEvent = {
  tabId: string
  payload?: Record<string, unknown>
}

let pending: NavEvent | undefined

export function navigateTo(tabId: string, payload?: Record<string, unknown>): void {
  pending = { tabId, payload }
  window.dispatchEvent(new CustomEvent('gt:nav', { detail: pending }))
}

export function onNavigate(fn: (e: NavEvent) => void, receiveFor?: string): () => void {
  const receive = (event: NavEvent) => {
    if (receiveFor && event.tabId !== receiveFor) return
    if (receiveFor && pending === event) pending = undefined
    fn(event)
  }
  const handler = (e: Event) => receive((e as CustomEvent).detail as NavEvent)
  window.addEventListener('gt:nav', handler)
  // A cold tab subscribes after the event that mounted it; deliver its payload once.
  if (receiveFor && pending?.tabId === receiveFor) receive(pending)
  return () => window.removeEventListener('gt:nav', handler)
}
