// Reflow policy for the Structural (difftastic) diff view. difft bakes its
// side-by-side layout to a fixed --width, so a pane resize needs difft re-run at
// the new column count — but only when the change is worth it. These are the
// pure decisions; the effect that owns the xterm + ResizeObserver lives in
// MrDetail.tsx (StructuralFileDiff).

// Debounce window for resize-driven re-runs, so dragging the pane doesn't fire a
// difft run per animation frame.
export const RESIZE_DEBOUNCE_MS = 250

// Minimum column delta before a re-run is worthwhile. Sub-threshold jitter
// (font metrics, scrollbar toggling) should not trigger a difft run.
export const COL_THRESHOLD = 2

// Re-run difft only when the column delta clears the threshold. oldCols === 0
// means nothing has rendered yet (pre-mount / first measure), so never re-run
// on that — the initial run handles it.
export function shouldRerun(oldCols: number, newCols: number, threshold = COL_THRESHOLD): boolean {
  return oldCols > 0 && Math.abs(newCols - oldCols) >= threshold
}
