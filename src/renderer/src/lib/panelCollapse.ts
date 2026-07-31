// Persisted collapse state for the session view's side panels (the cockpit and
// the Files column). Two panels reading localStorage with their own inline
// try/catch is exactly how the two drift apart, so both go through here.

type MiniStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): MiniStorage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/**
 * '1' = collapsed, '0' = expanded. Anything else — never set, or storage
 * unavailable — means the user has no opinion yet, so `whenUnset` decides.
 * That distinction is the whole point: a panel that defaults open and one that
 * defaults closed must still both honour an explicit '0'.
 */
export function readCollapsed(
  key: string,
  whenUnset: boolean,
  storage: MiniStorage | null = defaultStorage(),
): boolean {
  try {
    const raw = storage?.getItem(key)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* storage disabled */
  }
  return whenUnset
}

export function writeCollapsed(
  key: string,
  collapsed: boolean,
  storage: MiniStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(key, collapsed ? '1' : '0')
  } catch {
    /* storage disabled */
  }
}
