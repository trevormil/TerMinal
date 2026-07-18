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

// Splice a reordered visible sequence back into the full saved order. The
// current view can be a subset (engine-gated / remote-filtered plugins), so
// persisting just the visible ids would drop the rest — instead, visible slots
// in the saved order are rewritten in the new sequence while ids not currently
// visible stay anchored between the same neighbors. Visible ids never saved
// before are appended; staleness is handled on read by mergeWidgetOrder.
export function applyVisibleOrder(savedOrder: string[], newVisible: string[]): string[] {
  const visible = new Set(newVisible)
  const queue = [...newVisible]
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of savedOrder) {
    if (seen.has(id)) continue
    seen.add(id)
    if (visible.has(id)) {
      const next = queue.shift()
      if (next !== undefined) result.push(next)
    } else {
      result.push(id)
    }
  }
  return [...result, ...queue]
}
