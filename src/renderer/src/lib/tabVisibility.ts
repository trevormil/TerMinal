export const DEFAULT_HIDDEN_TABS = ['docs', 'reports', 'notes', 'sessions', 'workflow'] as const

const HIDDEN_TABS_KEY = 'gt.tabs.hidden'

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_KEY)
    if (!raw) return [...DEFAULT_HIDDEN_TABS]
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_HIDDEN_TABS]
    return v.filter((x) => typeof x === 'string')
  } catch {
    return [...DEFAULT_HIDDEN_TABS]
  }
}
