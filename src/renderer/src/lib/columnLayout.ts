// The unified work column's persisted layout.
//
// The column replaced two panels: the cockpit on the right (`gt.cockpitWidth` /
// `gt.cockpitCollapsed`, 320px, open by default) and the Files column on the
// left (`gt.filesWidth` / `gt.filesCollapsed`, 260px, closed by default). The
// COCKPIT keys won — the surviving column inherits the cockpit's edge, its
// contents and its open-by-default behaviour. The one-time fold-in of the Files
// keys has shipped everywhere and is gone.

export const COLUMN_WIDTH_KEY = 'gt.cockpitWidth'
export const COLUMN_COLLAPSED_KEY = 'gt.cockpitCollapsed'

/**
 * One column, two jobs: 380 sits between the cockpit's 320 and the width a
 * file tree wants, and the range is the union of the two old ones (240–640 and
 * 200–520) with the floor raised — under ~260 the widget cards stop being
 * readable, which the file tree alone could get away with.
 */
export const COLUMN_WIDTH = { default: 380, min: 260, max: 720 } as const

/** The column defaults OPEN — it is the cockpit's slot, and the cockpit was open. */
export const COLUMN_COLLAPSED_WHEN_UNSET = false
