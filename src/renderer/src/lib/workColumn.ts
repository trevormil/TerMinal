// Which plugins live in the work column's accordion instead of the cockpit.
//
// One host per plugin, always. The cockpit filters these ids out of its own
// plugin list, so a plugin can never mount in both places and poll twice —
// tickets polls every 5s, so a double-mount is a real recurring cost, not a
// cosmetic bug.
export const COLUMN_PLUGIN_IDS = ['tickets', 'mr-summary'] as const

export function isColumnPlugin(id: string): boolean {
  return (COLUMN_PLUGIN_IDS as readonly string[]).includes(id)
}

/**
 * Split the one plugin registry between its two hosts. The partition is what
 * guarantees single-host mounting: `cockpit` and `column` are disjoint by
 * construction, so there is no path where both render the same plugin.
 *
 * `column` follows COLUMN_PLUGIN_IDS order — the accordion is a fixed layout,
 * not the cockpit's user-reorderable stack — and silently omits an id with no
 * matching plugin so a stale entry can't crash the column.
 */
export function partitionPluginHosts<T extends { id: string }>(
  all: T[],
): { cockpit: T[]; column: T[] } {
  return {
    cockpit: all.filter((p) => !isColumnPlugin(p.id)),
    column: COLUMN_PLUGIN_IDS.map((id) => all.find((p) => p.id === id)).filter((p): p is T => !!p),
  }
}

/**
 * Initial open/closed state for a migrated section, derived from the cockpit
 * preferences the user already had.
 *
 * The migration is deliberately READ-ONLY: nothing rewrites `gt.enabled`,
 * `gt.known`, or `gt.widgetOrder`. Those arrays keep their stale entries for
 * the two moved plugins, which is harmless (the cockpit no longer offers them,
 * so they never render) and is the only way to guarantee the remaining
 * widgets' saved order survives untouched — `applyVisibleOrder` already keeps
 * ids it can't currently see anchored between the same neighbours.
 *
 * `known` is the exact signal for "has this user ever seen this widget":
 *   - known → they have an opinion; honour it (hidden in the cockpit stays
 *     collapsed in the accordion, and vice versa).
 *   - not known → fresh install; fall back to the plugin's `defaultEnabled`.
 *
 * The moment the user toggles a section, `panelCollapse` writes an explicit
 * '0'/'1' that wins over all of this forever — so this function only ever
 * decides the very first render after the upgrade.
 */
export function initialSectionCollapsed(
  pluginId: string,
  defaultEnabled: boolean,
  known: string[],
  enabled: string[],
): boolean {
  if (!known.includes(pluginId)) return !defaultEnabled
  return !enabled.includes(pluginId)
}
