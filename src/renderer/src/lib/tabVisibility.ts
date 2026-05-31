export const DEFAULT_HIDDEN_TABS = ['docs', 'reports', 'notes', 'sessions'] as const

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem('gt.tabs.hidden')
    if (!raw) return [...DEFAULT_HIDDEN_TABS]
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [...DEFAULT_HIDDEN_TABS]
  } catch {
    return [...DEFAULT_HIDDEN_TABS]
  }
}
