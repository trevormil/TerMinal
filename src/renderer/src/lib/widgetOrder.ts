// Pure merge of a user-defined cockpit widget order with plugin defaults.
// The saved order wins; widgets absent from it (new plugins, freshly added
// command widgets) slot in at their default `order` position relative to the
// already-ordered ones instead of being dumped at the end.

const DEFAULT_ORDER = 99

export function mergeWidgetOrder(
  savedOrder: string[],
  defaults: { id: string; order?: number }[],
): string[] {
  const orderOf = new Map(defaults.map((d) => [d.id, d.order ?? DEFAULT_ORDER]))

  const result: string[] = []
  for (const id of savedOrder) {
    if (orderOf.has(id) && !result.includes(id)) result.push(id)
  }

  const fresh = defaults
    .filter((d) => !result.includes(d.id))
    .sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
  for (const f of fresh) {
    const o = f.order ?? DEFAULT_ORDER
    const at = result.findIndex((id) => orderOf.get(id)! > o)
    result.splice(at === -1 ? result.length : at, 0, f.id)
  }
  return result
}
