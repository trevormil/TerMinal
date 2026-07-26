import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import { mergeLineRanges, type LineRange } from '../../../shared/diff-ranges'

// AI-attribution gutter markers (0049): the lines an agent turn wrote carry a
// violet edge in the editor. A human typing into one flips it back to human —
// the mark disappears and the removal is persisted. LOCAL ONLY by design:
// state lives in localStorage, never in the repo, so attribution can never
// leak into git.

export type AttrStore = Record<string, LineRange[]>

const key = (repoRoot: string) => `gt.aiAttr.${repoRoot}`

export function loadAttr(repoRoot: string): AttrStore {
  try {
    return JSON.parse(localStorage.getItem(key(repoRoot)) || '{}') as AttrStore
  } catch {
    return {}
  }
}

export function saveAttr(repoRoot: string, store: AttrStore): void {
  try {
    localStorage.setItem(key(repoRoot), JSON.stringify(store))
  } catch {
    /* storage disabled */
  }
}

/** Fold a checkpoint's changed ranges into the store. */
export function recordAttr(repoRoot: string, incoming: AttrStore): void {
  const store = loadAttr(repoRoot)
  for (const [file, ranges] of Object.entries(incoming)) {
    store[file] = mergeLineRanges([...(store[file] || []), ...ranges])
  }
  saveAttr(repoRoot, store)
}

const aiLine = Decoration.line({ class: 'cm-ai-line' })

const theme = EditorView.baseTheme({
  '.cm-ai-line': {
    boxShadow: 'inset 3px 0 0 0 rgba(167, 139, 250, 0.55)',
  },
})

/**
 * Editor extension marking `ranges` (1-based lines) as AI-written. Marks map
 * through edits; a user edit that touches a marked line clears that mark, and
 * `onChange` reports the surviving line numbers for persistence.
 */
export function aiAttribution(
  ranges: LineRange[],
  onChange?: (lines: number[]) => void,
): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      const builder = new RangeSetBuilder<Decoration>()
      for (const r of mergeLineRanges(ranges)) {
        for (let n = r.from; n <= Math.min(r.to, state.doc.lines); n++) {
          builder.add(state.doc.line(n).from, state.doc.line(n).from, aiLine)
        }
      }
      return builder.finish()
    },
    update(deco, tr) {
      if (!tr.docChanged) return deco
      deco = deco.map(tr.changes)
      if (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move')) {
        const touched = new Set<number>()
        tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
          const a = tr.newDoc.lineAt(fromB).number
          const b = tr.newDoc.lineAt(Math.min(toB, tr.newDoc.length)).number
          for (let n = a; n <= b; n++) touched.add(n)
        })
        deco = deco.update({
          filter: (from) => !touched.has(tr.newDoc.lineAt(from).number),
        })
        if (onChange) {
          const lines: number[] = []
          const iter = deco.iter()
          while (iter.value) {
            lines.push(tr.newDoc.lineAt(iter.from).number)
            iter.next()
          }
          onChange(lines)
        }
      }
      return deco
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  return [theme, field]
}

/** Collapse marked line numbers back into ranges for the store. */
export function linesToRanges(lines: number[]): LineRange[] {
  return mergeLineRanges(lines.map((n) => ({ from: n, to: n })))
}
