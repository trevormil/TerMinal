// Which plugins get their OWN accordion section in the work column, and which
// fall through to the Vitals section that holds the rest.
//
// The partition used to mean "which column"; with one column it means "which
// section". The invariant it exists to protect is unchanged: one host per
// plugin, always. `sections` and `vitals` are disjoint by construction, so no
// plugin can render — and poll — twice. Tickets polls every 5s, so a double
// mount is a real recurring cost, not a cosmetic bug.
//
// Adding a fifth top-level section is one line here: move an id into
// SECTION_PLUGIN_IDS and it leaves Vitals for a section of its own.
export const SECTION_PLUGIN_IDS = ['tickets', 'mr-summary'] as const

export function isSectionPlugin(id: string): boolean {
  return (SECTION_PLUGIN_IDS as readonly string[]).includes(id)
}

/**
 * Split the one plugin registry between its two section kinds. The partition
 * is what guarantees single-host mounting: `sections` and `vitals` are
 * disjoint by construction, so there is no path where both render the same
 * plugin.
 *
 * `sections` follows SECTION_PLUGIN_IDS order — the top-level sections are a
 * fixed layout, not the user-reorderable widget stack — and silently omits an
 * id with no matching plugin so a stale entry can't crash the column.
 * `vitals` keeps registry order; the user's own widget order is applied later.
 */
export function partitionPluginHosts<T extends { id: string }>(
  all: T[],
): { vitals: T[]; sections: T[] } {
  return {
    vitals: all.filter((p) => !isSectionPlugin(p.id)),
    sections: SECTION_PLUGIN_IDS.map((id) => all.find((p) => p.id === id)).filter(
      (p): p is T => !!p,
    ),
  }
}

/**
 * Initial open/closed state for a plugin promoted out of the widget stack into
 * its own section, derived from the widget preferences the user already had.
 *
 * The migration is deliberately READ-ONLY: nothing rewrites `gt.enabled`,
 * `gt.known`, or `gt.widgetOrder`. Those arrays keep their stale entries for
 * the promoted plugins, which is harmless (Vitals no longer offers them, so
 * they never render there) and is the only way to guarantee the remaining
 * widgets' saved order survives untouched — `applyVisibleOrder` already keeps
 * ids it can't currently see anchored between the same neighbours.
 *
 * `known` is the exact signal for "has this user ever seen this widget":
 *   - known → they have an opinion; honour it (a widget they had hidden opens
 *     collapsed as a section, and vice versa).
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
