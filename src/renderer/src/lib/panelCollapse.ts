// Persisted collapse state for the session view's work column and for each of
// its accordion sections. Panels reading localStorage with their own inline
// try/catch is exactly how they drift apart, so they all go through here.
// (The column's own key and its one-time migration live in columnLayout.ts.)

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

/**
 * Storage key for one work-column accordion section. Sections are keyed by
 * plugin id (or 'files'), so a section's state follows the plugin rather than
 * its position in the column.
 */
export function sectionCollapseKey(sectionId: string): string {
  return `gt.workColumn.${sectionId}.collapsed`
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
