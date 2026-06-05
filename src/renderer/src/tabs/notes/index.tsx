import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FolderGit2,
  FolderOpen,
  Globe,
  NotebookText,
  Plus,
  Trash2,
} from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import { CodeEditor } from '../../components/CodeEditor'
import { Markdown } from '../../components/Markdown'
import { fileIcon } from '../../lib/fileIcons'
import type { FileEntry, NoteFolder, Tab, TabContext } from '../../lib/types'

type Scope = 'repo' | 'global'
type Mode = 'edit' | 'split' | 'preview'
type Surface = 'scratch' | 'folders'
type OpenNote = { folderId: string; path: string; content: string; dirty: boolean; err?: string }

const base = (p: string) => p.split('/').filter(Boolean).pop() || p
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'notes'

function NoteTree({
  entry,
  folderId,
  active,
  selectedDir,
  version,
  onOpen,
  onSelectDir,
  depth = 0,
}: {
  entry: FileEntry
  folderId: string
  active: string | null
  selectedDir: string
  version: number
  onOpen: (path: string) => void
  onSelectDir: (path: string) => void
  depth?: number
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  useEffect(() => {
    if (open) window.gt.notes.folderList(folderId, entry.path).then(setChildren)
  }, [folderId, entry.path, open, version])
  const click = async () => {
    if (!entry.dir) return onOpen(entry.path)
    onSelectDir(entry.path)
    if (!open && children === null) setChildren(await window.gt.notes.folderList(folderId, entry.path))
    setOpen((v) => !v)
  }
  const { Icon, cls } = fileIcon(entry.name, entry.dir, open)
  const selected = entry.dir ? selectedDir === entry.path : active === entry.path
  return (
    <>
      <button
        onClick={click}
        title={entry.path}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] hover:bg-white/5 ${
          selected ? 'bg-[var(--gt-accent)]/12 text-zinc-100' : 'text-zinc-300'
        }`}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-zinc-600">
          {entry.dir ? (
            open ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : null}
        </span>
        <Icon size={14} strokeWidth={2} className={`shrink-0 ${cls}`} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {entry.dir &&
        open &&
        children?.map((child) => (
          <NoteTree
            key={child.path}
            entry={child}
            folderId={folderId}
            active={active}
            selectedDir={selectedDir}
            version={version}
            onOpen={onOpen}
            onSelectDir={onSelectDir}
            depth={depth + 1}
          />
        ))}
    </>
  )
}

function NotesTab({ ctx }: { ctx: TabContext }) {
  const hasRepo = !!ctx.repoRoot
  const [surface, setSurface] = useState<Surface>('scratch')
  const [scope, setScope] = useState<Scope>(hasRepo ? 'repo' : 'global')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('split')
  const [saved, setSaved] = useState(true)
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState('')
  const [folderRoots, setFolderRoots] = useState<FileEntry[] | null>(null)
  const [selectedDir, setSelectedDir] = useState('')
  const [openNote, setOpenNote] = useState<OpenNote | null>(null)
  const [folderSaved, setFolderSaved] = useState(true)
  const [version, setVersion] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const folderSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ scope, text, saved })
  const latestFolder = useRef(openNote)
  latest.current = { scope, text, saved }
  latestFolder.current = openNote

  const activeFolder = folders.find((f) => f.id === activeFolderId) || null

  useEffect(() => {
    window.gt.settings.get().then((s) => {
      const list = s.noteFolders || []
      setFolders(list)
      setActiveFolderId((id) => (id && list.some((f) => f.id === id) ? id : list[0]?.id || ''))
    })
  }, [])

  useEffect(() => {
    let alive = true
    window.gt.notes.read(scope).then((t) => {
      if (alive) {
        setText(t)
        setSaved(true)
      }
    })
    return () => {
      alive = false
    }
  }, [scope, ctx.repoRoot])

  useEffect(() => {
    if (!activeFolderId) {
      setFolderRoots(null)
      return
    }
    window.gt.notes.folderList(activeFolderId, '').then(setFolderRoots)
  }, [activeFolderId, version])

  useEffect(
    () => () => {
      if (!latest.current.saved) window.gt.notes.write(latest.current.scope, latest.current.text)
      if (latestFolder.current?.dirty && !latestFolder.current.err) {
        window.gt.notes.folderWrite(
          latestFolder.current.folderId,
          latestFolder.current.path,
          latestFolder.current.content,
        )
      }
    },
    [],
  )

  const patchSettingsFolders = async (next: NoteFolder[]) => {
    const s = await window.gt.settings.patch({ noteFolders: next })
    setFolders(s.noteFolders || [])
    setActiveFolderId((id) => (id && s.noteFolders.some((f) => f.id === id) ? id : s.noteFolders[0]?.id || ''))
  }

  const addFolder = async () => {
    const path = await window.gt.pickDir()
    if (!path) return
    const title = base(path)
    const ids = new Set(folders.map((f) => f.id))
    let id = slug(title)
    let n = 2
    while (ids.has(id)) id = `${slug(title)}-${n++}`
    await patchSettingsFolders([...folders, { id, title, path }])
    setSurface('folders')
    setActiveFolderId(id)
  }

  const removeFolder = async (id: string) => {
    await patchSettingsFolders(folders.filter((f) => f.id !== id))
    if (openNote?.folderId === id) setOpenNote(null)
  }

  const onScratchChange = (v: string) => {
    setText(v)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.gt.notes.write(scope, v).then(() => setSaved(true))
    }, 600)
  }

  const onFolderChange = (v: string) => {
    if (!openNote) return
    const next = { ...openNote, content: v, dirty: true }
    setOpenNote(next)
    setFolderSaved(false)
    if (folderSaveTimer.current) clearTimeout(folderSaveTimer.current)
    folderSaveTimer.current = setTimeout(() => {
      window.gt.notes.folderWrite(next.folderId, next.path, next.content).then((ok) => {
        if (ok) {
          setFolderSaved(true)
          setOpenNote((cur) =>
            cur && cur.folderId === next.folderId && cur.path === next.path
              ? { ...cur, dirty: false }
              : cur,
          )
        }
      })
    }, 700)
  }

  const switchScope = (s: Scope) => {
    if (s === scope) return
    if (!saved) window.gt.notes.write(scope, text)
    setScope(s)
  }

  const openFolderFile = async (path: string) => {
    if (!activeFolderId) return
    const r = await window.gt.notes.folderRead(activeFolderId, path)
    setOpenNote({
      folderId: activeFolderId,
      path,
      content: r.ok ? r.content : '',
      dirty: false,
      err: r.ok ? undefined : r.reason,
    })
    setFolderSaved(true)
  }

  const createNote = async () => {
    if (!activeFolderId) return
    const name = window.prompt('New note name')
    if (!name?.trim()) return
    const clean = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`
    const path = selectedDir ? `${selectedDir}/${clean}` : clean
    if (await window.gt.notes.folderWrite(activeFolderId, path, '')) {
      setVersion((v) => v + 1)
      openFolderFile(path)
    }
  }

  const segSurface = (s: Surface, label: ReactNode) => (
    <button
      onClick={() => setSurface(s)}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium ${
        surface === s ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
  const segScope = (s: Scope, label: ReactNode, disabled = false) => (
    <button
      disabled={disabled}
      onClick={() => switchScope(s)}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-30 ${
        scope === s ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
  const segMode = (m: Mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded-md px-2.5 py-1 text-[11px] ${
        mode === m ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )

  const editor = (value: string, onChange: (v: string) => void) => (
    <div className="h-full min-h-0 overflow-hidden">
      <CodeEditor value={value} onChange={onChange} extensions={[langs.markdown()]} wrap />
    </div>
  )
  const preview = (value: string) => (
    <div className="h-full overflow-y-auto p-5">
      {value.trim() ? (
        <Markdown>{value}</Markdown>
      ) : (
        <div className="text-[12px] italic text-zinc-600">Nothing yet.</div>
      )}
    </div>
  )
  const noteBody = openNote ? (
    openNote.err ? (
      <div className="p-6 text-[12px] text-zinc-600">Can't open {openNote.path} — {openNote.err}</div>
    ) : mode === 'edit' ? (
      editor(openNote.content, onFolderChange)
    ) : mode === 'preview' ? (
      preview(openNote.content)
    ) : (
      <div className="flex h-full min-h-0">
        <div className="min-h-0 w-1/2 border-r border-[var(--gt-border)]">
          {editor(openNote.content, onFolderChange)}
        </div>
        <div className="min-h-0 w-1/2">{preview(openNote.content)}</div>
      </div>
    )
  ) : (
    <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
      Select a note from a folder.
    </div>
  )
  const scratchBody =
    mode === 'edit' ? (
      editor(text, onScratchChange)
    ) : mode === 'preview' ? (
      preview(text)
    ) : (
      <div className="flex h-full min-h-0">
        <div className="min-h-0 w-1/2 border-r border-[var(--gt-border)]">{editor(text, onScratchChange)}</div>
        <div className="min-h-0 w-1/2">{preview(text)}</div>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {segSurface(
            'scratch',
            <>
              <NotebookText size={13} strokeWidth={2} />
              Scratch
            </>,
          )}
          {segSurface(
            'folders',
            <>
              <FolderOpen size={13} strokeWidth={2} />
              Folders
            </>,
          )}
        </div>
        {surface === 'scratch' ? (
          <>
            <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
              {segScope(
                'repo',
                <>
                  <FolderGit2 size={13} strokeWidth={2} />
                  Repo{hasRepo ? '' : ' (none)'}
                </>,
                !hasRepo,
              )}
              {segScope(
                'global',
                <>
                  <Globe size={13} strokeWidth={2} />
                  Global
                </>,
              )}
            </div>
            <span className="truncate text-[11px] text-zinc-600">
              {scope === 'repo' ? ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '') : 'all repos'}
            </span>
          </>
        ) : (
          <>
            <select
              value={activeFolderId}
              onChange={(e) => {
                setActiveFolderId(e.target.value)
                setOpenNote(null)
                setSelectedDir('')
              }}
              className="h-8 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 text-[12px] text-zinc-300 outline-none"
            >
              {folders.length === 0 ? (
                <option value="">No folders</option>
              ) : (
                folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.title}
                  </option>
                ))
              )}
            </select>
            <span className="max-w-[360px] truncate text-[11px] text-zinc-600">
              {activeFolder?.path || 'Add any markdown directory. Obsidian is optional.'}
            </span>
            {activeFolder && (
              <button
                onClick={() => removeFolder(activeFolder.id)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
              >
                <Trash2 size={12} strokeWidth={2} />
                Remove
              </button>
            )}
            <button
              onClick={addFolder}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
            >
              <Plus size={12} strokeWidth={2.5} />
              Add folder
            </button>
          </>
        )}
        <div className="flex-1" />
        <span
          className={`text-[10.5px] ${
            surface === 'scratch'
              ? saved
                ? 'text-zinc-600'
                : 'text-amber-400'
              : folderSaved
                ? 'text-zinc-600'
                : 'text-amber-400'
          }`}
        >
          {surface === 'scratch' ? (saved ? 'saved' : 'saving…') : folderSaved ? 'saved' : 'saving…'}
        </span>
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {segMode('edit', 'Edit')}
          {segMode('split', 'Split')}
          {segMode('preview', 'Preview')}
        </div>
      </div>
      {surface === 'scratch' ? (
        <div className="min-h-0 flex-1">{scratchBody}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--gt-border)]">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">Notes</span>
              <div className="flex-1" />
              <button
                onClick={createNote}
                disabled={!activeFolderId}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100 disabled:opacity-40"
              >
                <FilePlus size={11} strokeWidth={2} />
                New
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {!activeFolderId ? (
                <div className="p-4 text-[12px] text-zinc-600">
                  Add a markdown folder, docs directory, or Obsidian vault.
                </div>
              ) : folderRoots === null ? (
                <div className="p-4 text-[12px] text-zinc-600">Loading…</div>
              ) : folderRoots.length === 0 ? (
                <div className="p-4 text-[12px] text-zinc-600">No markdown files found.</div>
              ) : (
                folderRoots.map((entry) => (
                  <NoteTree
                    key={entry.path}
                    entry={entry}
                    folderId={activeFolderId}
                    active={openNote?.folderId === activeFolderId ? openNote.path : null}
                    selectedDir={selectedDir}
                    version={version}
                    onOpen={openFolderFile}
                    onSelectDir={setSelectedDir}
                  />
                ))
              )}
            </div>
          </aside>
          <div className="min-w-0 flex-1">{noteBody}</div>
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'notes',
  title: 'Notes',
  icon: NotebookText,
  order: 7,
  appliesTo: () => true,
  Component: NotesTab,
}
export default tab
