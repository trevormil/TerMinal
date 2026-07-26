// Legality + destination math for drag-and-drop moves in the file tree.
// Pure so the guard rules (no self-drops, no moving a folder into its own
// subtree, no same-parent no-ops) are testable without a DOM.

const base = (p: string) => p.split('/').pop() || p
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * Where dropping `fromRel` onto directory `toDirRel` ('' = repo root) would
 * land, or null when the move is illegal or a no-op.
 */
export function moveTargetFor(fromRel: string, toDirRel: string): string | null {
  if (!fromRel) return null
  const from = fromRel.replace(/\/+$/, '')
  const dir = toDirRel.replace(/\/+$/, '')
  if (from === dir) return null // dropping onto itself
  if (dir === from || dir.startsWith(from + '/')) return null // into own subtree
  if (parentOf(from) === dir) return null // already there
  return dir ? `${dir}/${base(from)}` : base(from)
}
