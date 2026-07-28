export function orderFleetSnapshotEntries<T>(
  entries: [string, T][],
  activeKey: string,
): [string, T][] {
  if (!activeKey) return entries
  const activeIndex = entries.findIndex(([key]) => key === activeKey)
  if (activeIndex < 0 || activeIndex === entries.length - 1) return entries
  const activeEntry = entries[activeIndex]
  return [...entries.slice(0, activeIndex), ...entries.slice(activeIndex + 1), activeEntry]
}

export function restoreFleetSnapshotEntryOrder<T extends { key: string }>(
  out: T[],
  entries: [string, unknown][],
): T[] {
  const order = new Map(entries.map(([key], index) => [key, index]))
  return out.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
}
