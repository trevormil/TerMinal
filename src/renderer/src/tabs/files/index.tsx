import { useEffect, useState } from 'react'
import {
  FolderTree,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Search,
  FilePlus,
  FolderPlus,
  X,
} from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import type { Extension } from '@codemirror/state'
import { CodeEditor } from '../../components/CodeEditor'
import type { Tab, TabContext, FileEntry, SearchHit } from '../../lib/types'

const EXT: Record<string, keyof typeof langs> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', mdx: 'markdown', css: 'css', scss: 'sass', less: 'less', html: 'html',
  py: 'python', rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml', sql: 'sql', sh: 'shell', bash: 'shell',
  zsh: 'shell', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', java: 'java', php: 'php', rb: 'ruby', toml: 'toml', xml: 'xml',
}
function langFor(path: string): Extension[] {
  const key = EXT[path.split('.').pop()?.toLowerCase() || '']
  try {
    return key && langs[key] ? [langs[key]()] : []
  } catch {
    return []
  }
}
const base = (p: string) => p.split('/').pop() || p
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

type NodeActions = {
  onOpen: (p: string) => void
  onSelectDir: (p: string) => void
  onRename: (p: string) => void
  onDelete: (p: string) => void
}

function TreeNode({
  entry,
  depth,
  active,
  selectedDir,
  version,
  act,
}: {
  entry: FileEntry
  depth: number
  active: string | null
  selectedDir: string
  version: number
  act: NodeActions
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  // refetch children when the tree version bumps (after a create/rename/delete)
  useEffect(() => {
    if (open) window.gt.files.list(entry.path).then(setChildren)
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const click = async () => {
    if (!entry.dir) return act.onOpen(entry.path)
    act.onSelectDir(entry.path)
    if (!open && children === null) setChildren(await window.gt.files.list(entry.path))
    setOpen((o) => !o)
  }
  const sel = entry.dir ? selectedDir === entry.path : active === entry.path
  return (
    <>
      <div
        onClick={click}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={`group flex cursor-pointer items-center gap-1 py-[3px] pr-1.5 text-[12px] hover:bg-white/5 ${
          sel ? 'bg-[var(--gt-accent)]/12 text-zinc-100' : 'text-zinc-300'
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
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation()
              act.onRename(entry.path)
            }}
            title="Rename"
            className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          >
            <Pencil size={11} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              act.onDelete(entry.path)
            }}
            title="Delete"
            className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-red)]"
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        </span>
      </div>
      {entry.dir &&
        open &&
        children?.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            depth={depth + 1}
            active={active}
            selectedDir={selectedDir}
            version={version}
            act={act}
          />
        ))}
    </>
  )
}

type OpenFile = { path: string; content: string; dirty: boolean; err?: string; scrollLine?: number }
type Prompt = { kind: 'new-file' | 'new-folder' | 'rename'; parent?: string; target?: string }

function FilesTab({ ctx }: { ctx: TabContext }) {
  const [roots, setRoots] = useState<FileEntry[] | null>(null)
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [selectedDir, setSelectedDir] = useState('')
  const [sidebar, setSidebar] = useState<'files' | 'search'>('files')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [pv, setPv] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const activeFile = open.find((f) => f.path === activePath) || null
  const bump = () => setVersion((v) => v + 1)

  useEffect(() => {
    window.gt.files.list('').then(setRoots)
  }, [ctx.repoRoot, version])

  const patch = (path: string, p: Partial<OpenFile>) =>
    setOpen((o) => o.map((f) => (f.path === path ? { ...f, ...p } : f)))

  const openFile = async (path: string, line?: number) => {
    setActivePath(path)
    if (open.some((f) => f.path === path)) {
      if (line) patch(path, { scrollLine: line })
      return
    }
    const r = await window.gt.files.read(path)
    setOpen((o) =>
      o.some((f) => f.path === path)
        ? o
        : [...o, { path, content: r.ok ? r.content : '', dirty: false, err: r.ok ? undefined : r.reason, scrollLine: line }],
    )
  }
  const closeFile = (path: string) =>
    setOpen((o) => {
      const idx = o.findIndex((f) => f.path === path)
      const next = o.filter((f) => f.path !== path)
      if (activePath === path) setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null)
      return next
    })
  const save = async () => {
    if (!activeFile || activeFile.err) return
    if (await window.gt.files.write(activeFile.path, activeFile.content)) patch(activeFile.path, { dirty: false })
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      } else if (mod && e.key.toLowerCase() === 'w' && activePath) {
        e.preventDefault()
        closeFile(activePath)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSidebar('search')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const runSearch = async () => {
    setResults(null)
    setResults(await window.gt.files.search(query))
  }

  const startPrompt = (p: Prompt) => {
    setPrompt(p)
    setPv(p.kind === 'rename' ? base(p.target!) : '')
  }
  const commitPrompt = async () => {
    const name = pv.trim()
    if (!name || !prompt) return setPrompt(null)
    if (prompt.kind === 'rename') {
      const np = (parentOf(prompt.target!) ? parentOf(prompt.target!) + '/' : '') + name
      if (await window.gt.files.rename(prompt.target!, np)) {
        setOpen((o) => o.map((f) => (f.path === prompt.target! ? { ...f, path: np } : f)))
        if (activePath === prompt.target!) setActivePath(np)
        bump()
      }
    } else {
      const path = (prompt.parent ? prompt.parent + '/' : '') + name
      if (await window.gt.files.create(path, prompt.kind === 'new-folder')) {
        bump()
        if (prompt.kind === 'new-file') openFile(path)
      }
    }
    setPrompt(null)
    setPv('')
  }
  const commitDelete = async () => {
    if (!confirmDelete) return
    if (await window.gt.files.del(confirmDelete)) {
      closeFile(confirmDelete)
      bump()
    }
    setConfirmDelete(null)
  }

  const nodeActs: NodeActions = {
    onOpen: (p) => openFile(p),
    onSelectDir: setSelectedDir,
    onRename: (p) => startPrompt({ kind: 'rename', target: p }),
    onDelete: setConfirmDelete,
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      {/* open-file tab bar */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--gt-border)]">
        {open.length === 0 ? (
          <div className="flex items-center px-4 text-[11px] text-zinc-600">
            Open files from the tree → ⌘S save · ⌘W close · ⌘F find · ⌘⇧F search
          </div>
        ) : (
          open.map((f) => (
            <div
              key={f.path}
              onClick={() => setActivePath(f.path)}
              title={f.path}
              className={`group flex cursor-pointer items-center gap-1.5 border-r border-[var(--gt-border)] px-3 text-[12px] ${
                activePath === f.path ? 'bg-[var(--gt-bg)] text-zinc-100' : 'bg-black/20 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f.dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--gt-yellow)]" />}
              <span className="max-w-[160px] truncate font-mono">{base(f.path)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(f.path)
                }}
                className="ml-1 flex items-center rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          ))
        )}
        <div className="flex-1" />
        {activeFile && !activeFile.err && (
          <button
            onClick={save}
            disabled={!activeFile.dirty}
            className="shrink-0 px-3 text-[11px] text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
          >
            Save ⌘S
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* editor (left) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {!activeFile ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Select a file to edit.
            </div>
          ) : activeFile.err ? (
            <div className="p-6 text-[12px] text-zinc-600">
              Can't open {activeFile.path} — {activeFile.err}
            </div>
          ) : (
            <CodeEditor
              key={activeFile.path}
              value={activeFile.content}
              onChange={(v) => patch(activeFile.path, { content: v, dirty: true })}
              extensions={langFor(activeFile.path)}
              scrollToLine={activeFile.scrollLine}
            />
          )}
        </div>

        {/* sidebar (right) */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--gt-border)]">
          <div className="flex shrink-0 border-b border-[var(--gt-border)] p-1.5">
            <button
              onClick={() => setSidebar('files')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                sidebar === 'files' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <FolderTree size={13} strokeWidth={2} />
              Files
            </button>
            <button
              onClick={() => setSidebar('search')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                sidebar === 'search' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <Search size={13} strokeWidth={2} />
              Search
            </button>
          </div>

          {sidebar === 'files' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* file-op toolbar */}
              <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500">
                <button
                  onClick={() => startPrompt({ kind: 'new-file', parent: selectedDir })}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-200"
                >
                  <FilePlus size={12} strokeWidth={2} />
                  File
                </button>
                <button
                  onClick={() => startPrompt({ kind: 'new-folder', parent: selectedDir })}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-200"
                >
                  <FolderPlus size={12} strokeWidth={2} />
                  Folder
                </button>
                <span className="ml-auto truncate font-mono text-[10px] text-zinc-600">
                  in&nbsp;/{selectedDir}
                </span>
              </div>

              {prompt && (
                <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-black/30 px-2 py-1.5">
                  <span className="text-[10px] text-zinc-500">
                    {prompt.kind === 'rename' ? 'rename' : prompt.kind === 'new-folder' ? 'folder' : 'file'}
                  </span>
                  <input
                    autoFocus
                    value={pv}
                    onChange={(e) => setPv(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPrompt()
                      if (e.key === 'Escape') setPrompt(null)
                    }}
                    className="min-w-0 flex-1 rounded border border-[var(--gt-border)] bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                  />
                </div>
              )}
              {confirmDelete && (
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-red)]/30 bg-[var(--gt-red)]/10 px-2 py-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-[var(--gt-red)]">
                    Delete {base(confirmDelete)}?
                  </span>
                  <button onClick={commitDelete} className="rounded bg-[var(--gt-red)]/20 px-1.5 py-0.5 text-[var(--gt-red)]">
                    delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="flex items-center px-1 text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto py-1" key={version}>
                {roots === null ? (
                  <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
                ) : (
                  roots.map((e) => (
                    <TreeNode
                      key={e.path}
                      entry={e}
                      depth={0}
                      active={activePath}
                      selectedDir={selectedDir}
                      version={version}
                      act={nodeActs}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder="search repo (Enter)"
                  className="w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {results === null ? (
                  <div className="p-3 text-[12px] text-zinc-600">Searching…</div>
                ) : results.length === 0 ? (
                  <div className="p-3 text-[12px] text-zinc-600">
                    {query ? 'No matches.' : 'Type a query and press Enter.'}
                  </div>
                ) : (
                  results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => openFile(r.file, r.line)}
                      className="block w-full border-b border-[var(--gt-border)]/50 px-3 py-1.5 text-left hover:bg-white/5"
                    >
                      <div className="truncate font-mono text-[11px] text-zinc-400">
                        {r.file}:{r.line}
                      </div>
                      <div className="truncate font-mono text-[11px] text-zinc-500">{r.text.trim()}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'files',
  title: 'Files',
  icon: FolderTree,
  order: 3,
  appliesTo: (ctx) => !!(ctx.repoRoot || ctx.cwd),
  Component: FilesTab,
}
export default tab
