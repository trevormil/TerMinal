import { EditorView, showPanel, type Panel } from '@codemirror/view'
import type { Extension, Text } from '@codemirror/state'
import { stickyLinesFor } from '../../../shared/sticky'

// Sticky scroll: pin the enclosing scope headers (class → method → block)
// above the editor while their bodies scroll. CM6 has no core equivalent, so
// this is a top panel fed by the indentation walk in shared/sticky.ts.

const theme = EditorView.baseTheme({
  '.cm-sticky-scope': {
    borderBottom: '1px solid var(--gt-border, rgba(255,255,255,0.08))',
    backgroundColor: 'var(--gt-code-bg, #111)',
    fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
    fontSize: '12px',
    lineHeight: '1.55',
    overflow: 'hidden',
  },
  '.cm-sticky-scope-line': {
    padding: '0 6px 0 8px',
    whiteSpace: 'pre',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    opacity: '0.75',
  },
  '.cm-sticky-scope-line:hover': {
    opacity: '1',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
})

function stickyPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-sticky-scope'
  dom.style.display = 'none'

  // The walk wants plain lines; split once per document version, not per
  // scroll tick.
  let splitOf: Text | null = null
  let lines: string[] = []
  const docLines = (): string[] => {
    if (splitOf !== view.state.doc) {
      splitOf = view.state.doc
      lines = view.state.doc.toString().split('\n')
    }
    return lines
  }

  let raf = 0
  let shown: number[] = []
  const render = () => {
    raf = 0
    const rect = view.scrollDOM.getBoundingClientRect()
    const pos = view.posAtCoords({ x: rect.left + 4, y: rect.top + 1 }, false)
    const topLine = view.state.doc.lineAt(Math.min(pos, view.state.doc.length)).number
    const pins = stickyLinesFor(docLines(), topLine)
    if (pins.length === shown.length && pins.every((n, i) => n === shown[i])) return
    shown = pins
    dom.textContent = ''
    dom.style.display = pins.length ? '' : 'none'
    for (const n of pins) {
      const row = document.createElement('div')
      row.className = 'cm-sticky-scope-line'
      row.textContent = docLines()[n - 1]
      row.title = `Jump to line ${n}`
      row.onclick = () => {
        const line = view.state.doc.line(n)
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
        })
        view.focus()
      }
      dom.appendChild(row)
    }
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(render)
  }
  view.scrollDOM.addEventListener('scroll', schedule)

  return {
    dom,
    top: true,
    update(u) {
      if (u.docChanged || u.geometryChanged) schedule()
    },
    destroy() {
      view.scrollDOM.removeEventListener('scroll', schedule)
      if (raf) cancelAnimationFrame(raf)
    },
  }
}

export function stickyScroll(): Extension {
  return [theme, showPanel.of(stickyPanel)]
}
