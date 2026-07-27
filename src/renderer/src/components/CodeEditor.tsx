import { useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, crosshairCursor, keymap, rectangularSelection } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'
import { bracketMatching, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search'
import { detectIndent, indentUnitFor } from '../../../shared/indent'
import { stickyScroll } from '../lib/stickyScroll'

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
  sticky = true,
  onView,
}: {
  value: string
  onChange?: (v: string) => void
  extensions?: Extension[]
  editable?: boolean
  wrap?: boolean
  scrollToLine?: number
  /** Pin enclosing scope headers while scrolling (on by default). */
  sticky?: boolean
  /** Surfaces the underlying EditorView, e.g. for surgical format dispatches. */
  onView?: (view: EditorView) => void
}) {
  const viewRef = useRef<EditorView | null>(null)

  // Editor quality-of-life (ticket 0045). CodeMirror ships all of this; it was
  // simply never wired up. Recomputed only when the file's indentation style
  // changes, so typing doesn't rebuild the extension set.
  const indent = useMemo(() => indentUnitFor(detectIndent(value)), [value.slice(0, 8000)]) // eslint-disable-line react-hooks/exhaustive-deps
  const qol: Extension[] = useMemo(
    () => [
      // Match the file's own indentation rather than imposing a default.
      indentUnit.of(indent),
      bracketMatching(),
      // Highlight other occurrences of the current selection.
      highlightSelectionMatches(),
      // Column/box selection: Shift-Alt-drag, with a crosshair while Alt is held.
      rectangularSelection(),
      crosshairCursor(),
      // Multi-cursor: Cmd-D adds the next occurrence to the selection.
      keymap.of([{ key: 'Mod-d', run: selectNextOccurrence, preventDefault: true }]),
    ],
    [indent],
  )

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
        onView?.(view)
      }}
      extensions={[
        chrome,
        ...(wrap ? [EditorView.lineWrapping] : []),
        ...(sticky ? [stickyScroll()] : []),
        ...qol,
        ...extensions,
      ]}
      basicSetup={{
        lineNumbers: true,
        // Folding: gutter arrows + the fold keymap (Cmd-Alt-[ / ]).
        foldGutter: true,
        foldKeymap: true,
        highlightActiveLine: editable,
        autocompletion: true,
        searchKeymap: true,
        // Bracket handling — matching is added below; auto-close only when
        // the buffer is actually editable.
        closeBrackets: editable,
      }}
    />
  )
}
