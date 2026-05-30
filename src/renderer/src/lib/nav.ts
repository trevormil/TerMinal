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

export function navigateTo(tabId: string, payload?: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('gt:nav', { detail: { tabId, payload } }))
}

export function onNavigate(fn: (e: NavEvent) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent).detail as NavEvent)
  window.addEventListener('gt:nav', handler)
  return () => window.removeEventListener('gt:nav', handler)
}
