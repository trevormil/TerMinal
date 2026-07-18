// Pure drop-index math for drag-and-drop row reordering. The UI translates a
// pointer position into (row index, top/bottom half); these helpers turn that
// into the resulting visible id order, which then flows through the same
// applyVisibleOrder persistence path as the chevron buttons.

export type DropHalf = 'top' | 'bottom'

// Insertion index for a drop over row `targetIndex`: before it when hovering
// the top half, after it when hovering the bottom half. The result indexes
// into the rendered list *including* the dragged row (0..length).
export function dropIndex(targetIndex: number, half: DropHalf): number {
  return half === 'top' ? targetIndex : targetIndex + 1
}

// Move `draggedId` so it lands at insertion index `insertAt`. Returns the new
// id order, or null when the drop wouldn't change anything (unknown id, or a
// drop onto the dragged row's own slot).
export function reorderOnDrop(ids: string[], draggedId: string, insertAt: number): string[] | null {
  const from = ids.indexOf(draggedId)
  if (from < 0) return null
  const rest = ids.filter((id) => id !== draggedId)
  const at = Math.max(0, Math.min(insertAt > from ? insertAt - 1 : insertAt, rest.length))
  if (at === from) return null
  rest.splice(at, 0, draggedId)
  return rest
}
