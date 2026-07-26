import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, Undo2, X } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'

// Inline AI-edit review (0049, Cursor's defining affordance): the agent's
// edits render as red/green chunks IN the buffer, with @codemirror/merge's
// per-chunk accept/reject controls live, plus accept-all / reject-all.
// The document is editable — rejecting a chunk reverts it to the original and
// flows back into the buffer through onContentChange like any other edit.

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
    '.cm-collapsedLines': {
      color: 'var(--gt-text-muted)',
      backgroundColor: 'color-mix(in srgb, var(--gt-accent) 8%, transparent)',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '11px',
    },
  }),
)

export function ReviewEditsView({
  path,
  content,
  original,
  baseLabel,
  extensions = [],
  onContentChange,
  onClose,
  onComment,
}: {
  path: string
  content: string
  original: string
  /** What the edits are being reviewed against ("checkpoint 3f2a91" / "HEAD"). */
  baseLabel: string
  extensions?: Extension[]
  /** Fires for every buffer change — per-chunk rejects included. */
  onContentChange: (v: string) => void
  onClose: () => void
  /** Pin a comment to the cursor's line. */
  onComment: (c: { line: number; text: string; note: string }) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  // The view is created once per (path, original): content changes flow OUT of
  // it, so rebuilding on every keystroke would fight the user.
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    parent.innerHTML = ''
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: content,
        extensions: [
          chrome,
          oneDark,
          ...extensions,
          unifiedMergeView({
            original,
            highlightChanges: true,
            gutter: true,
            mergeControls: true,
            collapseUnchanged: { margin: 3, minSize: 6 },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onContentChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, original])

  const addComment = () => {
    const view = viewRef.current
    if (!view || !note.trim()) return
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    onComment({ line: line.number, text: line.text, note: note.trim() })
    setNote('')
    setNoteOpen(false)
  }

  const rejectAll = () => {
    onContentChange(original)
    onClose()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px]">
        <span className="font-medium text-zinc-200">Reviewing edits</span>
        <span className="text-zinc-600">vs {baseLabel}</span>
        <div className="flex-1" />
        <button
          onClick={() => setNoteOpen((o) => !o)}
          title="Comment on the cursor's line"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
            noteOpen
              ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
          }`}
        >
          <MessageSquarePlus size={12} strokeWidth={2} />
          Comment
        </button>
        <button
          onClick={rejectAll}
          title="Revert every edit to the base version"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-zinc-500 hover:bg-white/5 hover:text-[var(--gt-red)]"
        >
          <Undo2 size={12} strokeWidth={2} />
          Reject all
        </button>
        <button
          onClick={onClose}
          title="Keep the buffer as-is"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--gt-accent)]/20 px-2 py-1 text-zinc-100"
        >
          <Check size={12} strokeWidth={2} />
          Accept all
        </button>
        <button
          onClick={onClose}
          className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Close review"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      {noteOpen && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] bg-black/30 px-3 py-1.5">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addComment()
              if (e.key === 'Escape') setNoteOpen(false)
            }}
            placeholder="Comment for the line under the cursor — Enter to pin"
            className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/40 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          />
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
