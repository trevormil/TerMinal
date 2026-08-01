// The unified work column's persisted layout, and the one-time migration that
// folds the two panels it replaced into one set of keys.
//
// Before this there were two panels with two layouts: the cockpit on the right
// (`gt.cockpitWidth` / `gt.cockpitCollapsed`, 320px, open by default) and the
// Files column on the left (`gt.filesWidth` / `gt.filesCollapsed`, 260px,
// closed by default). One column now does both jobs, so one pair of keys has
// to win.
//
// The COCKPIT keys are canonical. The surviving column inherits the cockpit's
// edge, its contents and its open-by-default behaviour, and those keys carry
// the longer history of deliberate user values — so the common case ("I had my
// cockpit at 480") needs no migration at all and cannot regress.
//
// The Files keys are folded in rather than dropped:
//   width    → the WIDER of the two, clamped to the merged range. The column
//              now carries a file tree AND every widget, so it needs at least
//              as much room as either panel had; nobody's column gets narrower.
//   collapse → collapsed only if BOTH panels were collapsed. Anything the user
//              could see before the merge is still visible after it.
// The legacy keys are then removed, which is what makes this safe to repeat: a
// stale `gt.filesCollapsed` left behind would silently re-open the column on
// the next launch after the user collapsed it.

type MiniStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const COLUMN_WIDTH_KEY = 'gt.cockpitWidth'
export const COLUMN_COLLAPSED_KEY = 'gt.cockpitCollapsed'
const LEGACY_WIDTH_KEY = 'gt.filesWidth'
const LEGACY_COLLAPSED_KEY = 'gt.filesCollapsed'

/**
 * One column, two jobs: 380 sits between the cockpit's 320 and the width a
 * file tree wants, and the range is the union of the two old ones (240–640 and
 * 200–520) with the floor raised — under ~260 the widget cards stop being
 * readable, which the file tree alone could get away with.
 */
export const COLUMN_WIDTH = { default: 380, min: 260, max: 720 } as const

/** The column defaults OPEN — it is the cockpit's slot, and the cockpit was open. */
export const COLUMN_COLLAPSED_WHEN_UNSET = false

function num(raw: string | null): number | null {
  const n = Number(raw)
  return raw != null && Number.isFinite(n) && n > 0 ? n : null
}

function flag(raw: string | null): boolean | null {
  return raw === '1' ? true : raw === '0' ? false : null
}

/**
 * Merged width, or null when neither panel had a stored width (leave the key
 * unset so the default applies).
 */
export function mergedColumnWidth(
  cockpitRaw: string | null,
  filesRaw: string | null,
): number | null {
  const widest = Math.max(num(cockpitRaw) ?? 0, num(filesRaw) ?? 0)
  if (widest <= 0) return null
  return Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, Math.round(widest)))
}

/**
 * Merged collapse, or null when neither panel had an opinion. An unset panel
 * falls back to ITS OWN old default (cockpit open, Files closed) so a user who
 * only ever touched one of them still gets the union of what they could see.
 */
export function mergedColumnCollapsed(
  cockpitRaw: string | null,
  filesRaw: string | null,
): boolean | null {
  const cockpit = flag(cockpitRaw)
  const files = flag(filesRaw)
  if (cockpit === null && files === null) return null
  return (cockpit ?? false) && (files ?? true)
}

function storageOrNull(): MiniStorage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/**
 * Fold the legacy Files-column keys into the canonical column keys, once.
 *
 * Guarded on a legacy key still existing, which makes it both idempotent and a
 * no-op for fresh installs (no key is written for a user who never had an
 * opinion). Call before the first render — `useResizableWidth` reads
 * localStorage in its state initialiser.
 */
export function migrateColumnLayout(storage: MiniStorage | null = storageOrNull()): void {
  try {
    if (!storage) return
    const legacyWidth = storage.getItem(LEGACY_WIDTH_KEY)
    const legacyCollapsed = storage.getItem(LEGACY_COLLAPSED_KEY)
    if (legacyWidth === null && legacyCollapsed === null) return

    const width = mergedColumnWidth(storage.getItem(COLUMN_WIDTH_KEY), legacyWidth)
    if (width !== null) storage.setItem(COLUMN_WIDTH_KEY, String(width))

    const collapsed = mergedColumnCollapsed(storage.getItem(COLUMN_COLLAPSED_KEY), legacyCollapsed)
    if (collapsed !== null) storage.setItem(COLUMN_COLLAPSED_KEY, collapsed ? '1' : '0')

    storage.removeItem(LEGACY_WIDTH_KEY)
    storage.removeItem(LEGACY_COLLAPSED_KEY)
  } catch {
    /* storage disabled — the defaults are fine */
  }
}
