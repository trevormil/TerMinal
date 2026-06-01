import { useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'

// oneDark supplies syntax highlighting; theme tokens own the editor chrome so
// dark/light appearance changes do not leave hard-coded background seams.
const EDITOR_BG = 'var(--gt-code-bg)'
const chrome = Prec.highest(
  EditorView.theme({
    '&': { height: '100%', backgroundColor: EDITOR_BG, color: 'var(--gt-text-soft)' },
    '.cm-gutters': { backgroundColor: EDITOR_BG, border: 'none', color: 'var(--gt-text-faint)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--gt-accent) 10%, transparent)',
      color: 'var(--gt-text-muted)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--gt-accent) 7%, transparent)',
    },
    '.cm-scroller': {
      fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
      fontSize: '13px',
      lineHeight: '1.55',
    },
    '.cm-content': { caretColor: 'var(--gt-accent)', color: 'var(--gt-text-soft)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--gt-accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--gt-accent) 26%, transparent)',
    },
    '&.cm-focused': { outline: 'none' },
  }),
)

export function CodeEditor({
  value,
  onChange,
  extensions = [],
  editable = true,
  wrap = false,
  scrollToLine,
}: {
  value: string
  onChange?: (v: string) => void
  extensions?: Extension[]
  editable?: boolean
  wrap?: boolean
  scrollToLine?: number
}) {
  const viewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !scrollToLine) return
    try {
      const ln = Math.max(1, Math.min(scrollToLine, view.state.doc.lines))
      const line = view.state.doc.line(ln)
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      })
      view.focus()
    } catch {
      /* ignore */
    }
  }, [scrollToLine, value])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      editable={editable}
      theme={oneDark}
      height="100%"
      style={{ height: '100%', background: EDITOR_BG }}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      extensions={[chrome, ...(wrap ? [EditorView.lineWrapping] : []), ...extensions]}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: editable,
        autocompletion: true,
        searchKeymap: true,
      }}
    />
  )
}
