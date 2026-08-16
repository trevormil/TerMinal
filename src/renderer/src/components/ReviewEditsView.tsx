import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EditorView } from '@codemirror/view'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
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

  // Language grammars arrive asynchronously (they are code-split — see
  // lazyLang.ts), so they cannot be baked into the initial EditorState: the
  // view is deliberately NOT rebuilt when `extensions` changes, which left the
  // buffer permanently unhighlighted. A Compartment lets us swap them in later
  // without tearing down the view and losing the user's merge decisions.
  const langCompartment = useRef(new Compartment())

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
          langCompartment.current.of(extensions),
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

  // Swap the grammar in when it lands, leaving the document and every pending
  // merge decision untouched.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: langCompartment.current.reconfigure(extensions) })
  }, [extensions])

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setNoteOpen((o) => !o)}
          title="Comment on the cursor's line"
          className={noteOpen ? 'bg-primary/20 text-foreground' : 'text-muted-foreground'}
        >
          <MessageSquarePlus size={12} strokeWidth={2} />
          Comment
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={rejectAll}
          title="Revert every edit to the base version"
          className="text-muted-foreground hover:text-destructive"
        >
          <Undo2 size={12} strokeWidth={2} />
          Reject all
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onClose}
          title="Keep the buffer as-is"
        >
          <Check size={12} strokeWidth={2} />
          Accept all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          title="Close review"
          aria-label="Close review"
        >
          <X size={12} strokeWidth={2} />
        </Button>
      </div>
      {noteOpen && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] bg-black/30 px-3 py-1.5">
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addComment()
              if (e.key === 'Escape') setNoteOpen(false)
            }}
            placeholder="Comment for the line under the cursor — Enter to pin"
            className="min-w-0 flex-1"
          />
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
