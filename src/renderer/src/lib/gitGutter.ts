import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import { RangeSet, type Extension } from '@codemirror/state'
import { gitGutterLines, type GitGutterLine } from '../../../shared/git-gutter'

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: GitGutterLine['kind']) {
    super()
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = `cm-git-change cm-git-${this.kind}`
    el.title = `${this.kind} vs HEAD (saved file)`
    el.textContent = this.kind === 'deleted' ? '▸' : '▎'
    return el
  }
}
const markers = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  deleted: new ChangeMarker('deleted'),
}

export function gitGutter(patch: string): Extension {
  let cachedDoc: unknown
  let cached = RangeSet.empty as RangeSet<GutterMarker>
  return [
    gutter({
      class: 'cm-git-gutter',
      markers: (view) => {
        if (cachedDoc !== view.state.doc) {
          cachedDoc = view.state.doc
          cached = RangeSet.of(
            gitGutterLines(patch, view.state.doc.lines).map(({ line, kind }) =>
              markers[kind].range(view.state.doc.line(line).from),
            ),
          )
        }
        return cached
      },
    }),
    EditorView.baseTheme({
      '.cm-git-gutter .cm-gutterElement': { padding: '0 2px' },
      '.cm-git-added': { color: 'var(--gt-green)' },
      '.cm-git-modified': { color: 'var(--gt-yellow)' },
      '.cm-git-deleted': { color: 'var(--gt-red)' },
    }),
  ]
}
