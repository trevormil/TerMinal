import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, CornerDownLeft, X } from 'lucide-react'
import type { Snippet } from '../lib/types'

// Saved prompts. Click one to inject it into the active session's terminal (no
// auto-send — you review/edit, then hit Enter). Manage them inline.
export function SnippetsDrawer({
  onClose,
  onInject,
}: {
  onClose: () => void
  onInject: (body: string) => void
}) {
  const [list, setList] = useState<Snippet[]>([])
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    window.gt.snippets.list().then(setList)
  }, [])

  const persist = (next: Snippet[]) => {
    setList(next)
    window.gt.snippets.save(next)
  }
  const startNew = () => {
    setEditing({ id: '', title: '', body: '' })
    setTitle('')
    setBody('')
  }
  const startEdit = (s: Snippet) => {
    setEditing(s)
    setTitle(s.title)
    setBody(s.body)
  }
  const save = () => {
    if (!title.trim() || !body.trim() || !editing) return
    if (editing.id) {
      persist(list.map((s) => (s.id === editing.id ? { ...s, title: title.trim(), body } : s)))
    } else {
      persist([...list, { id: crypto.randomUUID(), title: title.trim(), body }])
    }
    setEditing(null)
  }
  const remove = (id: string) => persist(list.filter((s) => s.id !== id))

  const sel =
    'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2.5 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-[380px] gt-pop-in flex-col border-l border-[var(--gt-border)] bg-[var(--gt-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--gt-border)] p-4">
          <h2 className="text-sm font-bold tracking-wide text-zinc-100">Snippets</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--gt-accent)] px-2 py-1 text-[11px] font-semibold text-white"
            >
              <Plus size={13} strokeWidth={2.5} />
              New
            </button>
            <button
              onClick={onClose}
              className="flex items-center rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <p className="shrink-0 px-4 pt-3 text-[11px] leading-relaxed text-zinc-500">
          Reusable prompts. Click one to drop it at the prompt of the active session — review, then
          press Enter to send.
        </p>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {editing && (
            <div className="space-y-2 rounded-xl border border-[var(--gt-accent)]/40 bg-black/20 p-3">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="title"
                className={sel}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="prompt text…"
                rows={5}
                className={`${sel} resize-none font-mono`}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={!title.trim() || !body.trim()}
                  className="rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                >
                  {editing.id ? 'Save' : 'Add'}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-lg px-2 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200"
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {list.length === 0 && !editing ? (
            <div className="py-8 text-center text-[12px] text-zinc-600">
              No snippets yet. Hit <span className="text-zinc-400">New</span> to save a prompt.
            </div>
          ) : (
            list.map((s) => (
              <div
                key={s.id}
                className="group rounded-xl border border-[var(--gt-border)] bg-black/20 p-3 transition-colors hover:border-[var(--gt-accent)]/50"
              >
                <div className="mb-1 flex items-center gap-2">
                  <button
                    onClick={() => onInject(s.body)}
                    title="Inject into the active terminal"
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-zinc-100 hover:text-[var(--gt-accent-light)]"
                  >
                    {s.title}
                  </button>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={() => onInject(s.body)}
                      title="Inject"
                      className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-accent-light)]"
                    >
                      <CornerDownLeft size={12} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => startEdit(s)}
                      title="Edit"
                      className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                    >
                      <Pencil size={11} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      title="Delete"
                      className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-red)]"
                    >
                      <Trash2 size={11} strokeWidth={2} />
                    </button>
                  </span>
                </div>
                <button
                  onClick={() => onInject(s.body)}
                  className="block w-full text-left"
                  title="Inject into the active terminal"
                >
                  <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-zinc-500">
                    {s.body}
                  </pre>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
