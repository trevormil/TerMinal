export const DEFAULT_HIDDEN_TABS = ['docs', 'reports', 'notes', 'sessions', 'marketplace'] as const

const HIDDEN_TABS_KEY = 'gt.tabs.hidden'
const MARKETPLACE_DEFAULT_MIGRATION_KEY = 'gt.tabs.hidden.marketplace-default-v1'

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_KEY)
    if (!raw) return [...DEFAULT_HIDDEN_TABS]
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_HIDDEN_TABS]
    const hidden = v.filter((x) => typeof x === 'string')
    if (!localStorage.getItem(MARKETPLACE_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(MARKETPLACE_DEFAULT_MIGRATION_KEY, '1')
      if (!hidden.includes('marketplace')) {
        const next = [...hidden, 'marketplace']
        localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next))
        return next
      }
    }
    return hidden
  } catch {
    return [...DEFAULT_HIDDEN_TABS]
  }
}
