import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, X } from 'lucide-react'
import { CodeEditor } from './CodeEditor'
import { FileViewer, hasViewer } from './FileViewer'
import { needsBinaryRead, viewerKindFor } from '../../../shared/file-viewers'
import { langForPath, useLangsReady } from '../lib/lazyLang'
import { navigateTo } from '../lib/nav'
import { fileIcon } from '../lib/fileIcons'

// Deep-link into the Files tab (replay once — the receiving tab mounts only
// after the tab switch lands; mirrors TicketModal's jump).
const openInFilesTab = (path: string) => {
  navigateTo('files', { path })
  setTimeout(() => navigateTo('files', { path }), 50)
}

/**
 * A single file, opened and edited without leaving the Terminal tab. Portaled to
 * document.body so it escapes the session grid's stacking context.
 *
 * Rendering is the Files tab's `FileViewer`, not a second implementation:
 * images, PDFs, markdown, CSV, SVG and unknown binaries render the way they do
 * over there, and only genuinely text-shaped files reach CodeMirror. Sending
 * everything to the editor is the exact bug FileViewer was built to fix — an
 * `icon.png` opened here used to be a failed utf8 read and nothing else.
 *
 * Highlighting goes through the lazy grammar loader — importing the CodeMirror
 * language barrel here instead would pull ~7.2 MB back into the entry chunk.
 *
 * Writes go through the same workspace-fenced Files IPC the Files tab uses, so
 * path-guard boundaries apply unchanged; nothing outside the workspace root is
 * reachable from here.
 */
export function FileModal({ path, onClose }: { path: string; onClose: () => void }) {
  useLangsReady()
  // undefined = still reading.
  const [content, setContent] = useState<string | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // Rendered-vs-source for the kinds that offer a toggle; owned here for the
  // same reason the Files tab owns it — FileViewer is remounted when it flips.
  const [viewerSource, setViewerSource] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  // Read by the unmount flush, which must not close over a stale buffer.
  const latest = useRef<{ content: string; dirty: boolean }>({ content: '', dirty: false })

  const kind = viewerKindFor(path)
  // Binary kinds have no editable text: FileViewer loads their bytes itself.
  const readOnly = needsBinaryRead(kind)

  useEffect(() => {
    setViewerSource(false)
    if (readOnly) {
      setContent('')
      latest.current = { content: '', dirty: false }
      return
    }
    let alive = true
    void window.gt.files.read(path).then((r) => {
      if (!alive) return
      if (!r.ok) return setErr(r.reason || 'Could not read this file')
      setContent(r.content)
      latest.current = { content: r.content, dirty: false }
    })
    return () => {
      alive = false
    }
  }, [path, readOnly])

  const save = async () => {
    if (!latest.current.dirty) return
    setSaving(true)
    const ok = await window.gt.files.write(path, latest.current.content)
    setSaving(false)
    if (ok) {
      latest.current.dirty = false
      setDirty(false)
    }
  }

  // Unsaved edits are never dropped on the floor: closing (Escape, backdrop, X,
  // or the whole modal unmounting) flushes the buffer to disk.
  useEffect(
    () => () => {
      if (latest.current.dirty) void window.gt.files.write(path, latest.current.content)
    },
    [path],
  )

  // Escape closes; ⌘S saves. Captured so the Files tab's own ⌘S (bound on
  // window) can't also fire for a file this modal owns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void save()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, path])

  // Move focus into the dialog on open and hand it back on close, so keyboard
  // focus never sits on a control hidden behind the backdrop.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const { Icon, cls } = fileIcon(path.split('/').pop() || path, false)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={path}
        // Portals bubble through the REACT tree, not the DOM tree — without
        // this, a click inside the dialog reaches the backdrop's onClick (and
        // whatever else is an ancestor in JSX) and closes the modal.
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-[980px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-bg)] outline-none"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          <Icon size={13} strokeWidth={2} className={`shrink-0 ${cls}`} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
            {path}
          </span>
          {/* Save state belongs to the editor. A read-only kind has nothing to
              save, so it gets no status and no Save button. */}
          {!readOnly && content !== undefined && (
            <span className={`shrink-0 text-[11px] ${dirty ? 'text-amber-400' : 'text-zinc-600'}`}>
              {saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}
            </span>
          )}
          {dirty && (
            <button
              onClick={save}
              className="shrink-0 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-medium text-zinc-100 hover:bg-[var(--gt-accent)]/20"
            >
              Save ⌘S
            </button>
          )}
          <button
            onClick={() => {
              openInFilesTab(path)
              onClose()
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
          >
            <ArrowUpRight size={11} strokeWidth={2} />
            View in Files tab
          </button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {err && !hasViewer(path) ? (
            <div className="p-6 text-[12px] text-zinc-600">{err}</div>
          ) : content === undefined ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : hasViewer(path) && !viewerSource ? (
            // Rendered viewer (markdown/image/pdf/csv/svg/binary). Runs even
            // when the utf8 read failed — an image legitimately fails that read
            // and loads through the binary channel instead.
            <FileViewer
              key={path}
              path={path}
              text={content}
              showSource={false}
              onWantsSource={setViewerSource}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {hasViewer(path) && (
                <FileViewer
                  key={`${path}:src`}
                  path={path}
                  text={content}
                  showSource
                  onWantsSource={setViewerSource}
                />
              )}
              <div className="min-h-0 flex-1">
                <CodeEditor
                  key={path}
                  value={content}
                  onChange={(v) => {
                    latest.current = { content: v, dirty: true }
                    setContent(v)
                    setDirty(true)
                  }}
                  extensions={langForPath(path)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
