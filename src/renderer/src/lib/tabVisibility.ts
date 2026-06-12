export const DEFAULT_HIDDEN_TABS = [
  'activity',
  'agentview',
  'docs',
  'help',
  'notes',
  'reports',
  'sessions',
  'workflow',
] as const

const HIDDEN_TABS_KEY = 'gt.tabs.hidden'
const HIDDEN_TABS_VERSION_KEY = 'gt.tabs.hidden.version'
const HIDDEN_TABS_VERSION = 3
const PRIMARY_TABS = ['browser', 'ci'] as const

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_KEY)
    if (!raw) {
      localStorage.setItem(HIDDEN_TABS_VERSION_KEY, String(HIDDEN_TABS_VERSION))
      return [...DEFAULT_HIDDEN_TABS]
    }
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_HIDDEN_TABS]
    const hidden = v.filter((x) => typeof x === 'string')
    const version = Number(localStorage.getItem(HIDDEN_TABS_VERSION_KEY) || '1')
    if (version < HIDDEN_TABS_VERSION) {
      const migrated = Array.from(new Set([...hidden, ...DEFAULT_HIDDEN_TABS])).filter(
        (tab) => !(PRIMARY_TABS as readonly string[]).includes(tab),
      )
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(migrated))
      localStorage.setItem(HIDDEN_TABS_VERSION_KEY, String(HIDDEN_TABS_VERSION))
      return migrated
    }
    return hidden
  } catch {
    return [...DEFAULT_HIDDEN_TABS]
  }
}
