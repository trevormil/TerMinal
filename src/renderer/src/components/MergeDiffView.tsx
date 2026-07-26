import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Rows3, WrapText, ChevronDown, ChevronUp } from 'lucide-react'
import { MergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'

// The diff surface (ticket 0048). Reviewing what an agent changed is the most
// common file interaction in TerMinal, so this is worth doing properly rather
// than rendering a raw unified patch:
//
//   - side-by-side OR inline, toggled without losing your place
//   - word-level intra-line highlighting (which chars actually changed)
//   - unchanged regions collapsed behind an expandable spacer — the thing that
//     makes a 2000-line diff readable
//   - syntax highlighting INSIDE the diff (Orca notably lacks this)
//   - keyboard hunk navigation (n / p)
//
// @codemirror/merge provides the diffing; this component owns the chrome.

const EDITOR_BG = 'var(--gt-code-bg)'
const chrome = Prec.highest(
  EditorView.theme({
    '&': { height: '100%', backgroundColor: EDITOR_BG, color: 'var(--gt-text-soft)' },
    '.cm-gutters': { backgroundColor: EDITOR_BG, border: 'none', color: 'var(--gt-text-faint)' },
    '.cm-scroller': {
      fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, Menlo, monospace",
      fontSize: '12.5px',
      lineHeight: '1.5',
    },
    '&.cm-focused': { outline: 'none' },
    // Collapsed-unchanged spacer: make it obviously clickable.
    '.cm-collapsedLines': {
      color: 'var(--gt-text-muted)',
      backgroundColor: 'color-mix(in srgb, var(--gt-accent) 8%, transparent)',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '11px',
    },
  }),
)

export type MergeDiffViewProps = {
  original: string
  modified: string
  /** Language extensions, so the diff is syntax-highlighted like the editor. */
  extensions?: Extension[]
  /** Start collapsed when a diff is large; expandable per region. */
  collapseUnchanged?: boolean
  className?: string
}

/**
 * A two-document diff. `mode` is owned here (and persisted) so the toggle
 * survives navigating between files.
 */
export function MergeDiffView({
  original,
  modified,
  extensions = [],
  collapseUnchanged = true,
  className = '',
}: MergeDiffViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'split' | 'inline'>(
    () => (localStorage.getItem('gt.diffMode') as 'split' | 'inline') || 'split',
  )
  const [wrap, setWrap] = useState(() => localStorage.getItem('gt.diffWrap') === '1')
  const viewRef = useRef<MergeView | EditorView | null>(null)

  const common = useMemo<Extension[]>(
    () => [
      chrome,
      oneDark,
      EditorView.editable.of(false),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...extensions,
    ],
    [wrap, extensions],
  )

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    parent.innerHTML = ''

    // collapseUnchanged keeps big diffs readable; 3 lines of context reads well.
    const collapse = collapseUnchanged ? { margin: 3, minSize: 6 } : undefined

    if (mode === 'split') {
      const mv = new MergeView({
        parent,
        a: { doc: original, extensions: common },
        b: { doc: modified, extensions: common },
        // Word-level highlighting inside changed lines.
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: collapse,
      })
      viewRef.current = mv
      return () => mv.destroy()
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: modified,
        extensions: [
          ...common,
          unifiedMergeView({
            original,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: collapse,
            // Read-only review surface: no accept/reject here (that's #0049).
            mergeControls: false,
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => view.destroy()
  }, [original, modified, mode, common, collapseUnchanged])

  const setModePersisted = (m: 'split' | 'inline') => {
    setMode(m)
    localStorage.setItem('gt.diffMode', m)
  }
  const toggleWrap = () => {
    setWrap((w) => {
      localStorage.setItem('gt.diffWrap', w ? '0' : '1')
      return !w
    })
  }

  /** Scroll to the next/previous change — keyboard-first review (n / p). */
  const jump = (dir: 1 | -1) => {
    const el = host.current?.querySelector('.cm-scroller')
    if (!el) return
    const marks = Array.from(host.current!.querySelectorAll('.cm-changedLine'))
    if (!marks.length) return
    const top = el.scrollTop
    const tops = marks.map((m) => (m as HTMLElement).offsetTop)
    const next =
      dir === 1 ? tops.find((t) => t > top + 4) : [...tops].reverse().find((t) => t < top - 4)
    if (next !== undefined) el.scrollTo({ top: next - 40, behavior: 'smooth' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'n') jump(1)
      else if (e.key === 'p') jump(-1)
    }
    const el = host.current
    el?.addEventListener('keydown', onKey as EventListener)
    return () => el?.removeEventListener('keydown', onKey as EventListener)
  }, [])

  const btn = (on: boolean) =>
    `inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
      on
        ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
    }`

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-1.5">
        <button
          onClick={() => setModePersisted('split')}
          className={btn(mode === 'split')}
          title="Side by side"
        >
          <Columns2 size={12} strokeWidth={2} />
          Split
        </button>
        <button
          onClick={() => setModePersisted('inline')}
          className={btn(mode === 'inline')}
          title="Inline"
        >
          <Rows3 size={12} strokeWidth={2} />
          Inline
        </button>
        <button onClick={toggleWrap} className={btn(wrap)} title="Wrap long lines">
          <WrapText size={12} strokeWidth={2} />
          Wrap
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-700">n / p to step changes</span>
        <button onClick={() => jump(-1)} className={btn(false)} title="Previous change (p)">
          <ChevronUp size={12} strokeWidth={2} />
        </button>
        <button onClick={() => jump(1)} className={btn(false)} title="Next change (n)">
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
      <div ref={host} tabIndex={0} className="min-h-0 flex-1 overflow-hidden outline-none" />
    </div>
  )
}
