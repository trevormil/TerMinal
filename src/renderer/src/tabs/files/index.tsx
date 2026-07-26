import { useEffect, useRef, useState } from 'react'
import {
  FolderTree,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Search,
  FilePlus,
  FolderPlus,
  ExternalLink,
  GitCompare,
  ArrowLeft,
  ArrowRight,
  Copy,
  Replace,
  X,
} from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import { langKeyFor } from '../../../../shared/languages'
import { FileViewer, hasViewer } from '../../components/FileViewer'
import { needsBinaryRead, viewerKindFor } from '../../../../shared/file-viewers'
import { MergeDiffView } from '../../components/MergeDiffView'
import {
  fileStatuses,
  parsePorcelain,
  statusBadge,
  statusColor,
  type StatusMap,
} from '../../../../shared/git-status'
import { moveTargetFor } from '../../../../shared/tree-dnd'
import { ImageDiffView } from '../../components/ImageDiffView'
import { describeIndent, detectIndent } from '../../../../shared/indent'
import { matchSegments, replaceInLine } from '../../../../shared/replace'
import { minimalChange } from '../../../../shared/text-change'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from '../../components/CodeEditor'
import { fileIcon } from '../../lib/fileIcons'
import { WorkingDiffView } from '../../components/WorkingDiffView'
import { onNavigate } from '../../lib/nav'
import { useResizableWidth, ResizeHandle } from '../../components/ResizeHandle'
import type { Tab, TabContext, FileEntry, SearchHit } from '../../lib/types'

// Language grammars come from the shared resolver (src/shared/languages.ts),
// which covers ~100 extensions plus extensionless files like Dockerfile and
// Makefile, and is unit-tested against the real langs export so a mapped key
// can never silently resolve to "no highlighting".
function langFor(path: string): Extension[] {
  const key = langKeyFor(path) as keyof typeof langs | ''
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
  /** Drop `from` into directory `toDir` ('' = root). */
  onMove: (from: string, toDir: string) => void
  /** Diff this file against the active open file. */
  onCompare: (p: string) => void
  /** Absolute path for a repo-relative one — what a terminal drop pastes. */
  absFor: (p: string) => string
}

/** The drag payload key for tree-internal moves. */
const DND_REL = 'application/x-terminal-rel'

function TreeNode({
  entry,
  depth,
  active,
  selectedDir,
  version,
  statuses,
  act,
}: {
  entry: FileEntry
  depth: number
  active: string | null
  selectedDir: string
  version: number
  statuses: StatusMap
  act: NodeActions
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [dropHover, setDropHover] = useState(false)
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
  const { Icon, cls } = fileIcon(entry.name, entry.dir, open)
  return (
    <>
      <div
        onClick={click}
        style={{ paddingLeft: depth * 12 + 8 }}
        title={entry.ignored ? `${entry.name} · git-ignored` : entry.name}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_REL, entry.path)
          // text/plain carries the absolute path, so dropping on a terminal
          // pastes something an agent can actually use (the Orca steal).
          e.dataTransfer.setData('text/plain', act.absFor(entry.path))
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onDragOver={
          entry.dir
            ? (e) => {
                if (!e.dataTransfer.types.includes(DND_REL)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                setDropHover(true)
              }
            : undefined
        }
        onDragLeave={entry.dir ? () => setDropHover(false) : undefined}
        onDrop={
          entry.dir
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                setDropHover(false)
                const from = e.dataTransfer.getData(DND_REL)
                if (from) act.onMove(from, entry.path)
              }
            : undefined
        }
        className={`group flex cursor-pointer items-center gap-1 py-[3px] pr-1.5 text-[12px] hover:bg-white/5 ${
          sel ? 'bg-[var(--gt-accent)]/12 text-zinc-100' : 'text-zinc-300'
        } ${entry.ignored ? 'opacity-45' : ''} ${
          dropHover
            ? 'bg-[var(--gt-accent)]/20 outline outline-1 -outline-offset-1 outline-[var(--gt-accent)]/50'
            : ''
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
        <span
          className={`min-w-0 flex-1 truncate ${statuses[entry.path] ? statusColor(statuses[entry.path]) : ''}`}
        >
          {entry.name}
        </span>
        {statuses[entry.path] && (
          <span
            title={statuses[entry.path]}
            className={`shrink-0 font-mono text-[10px] font-bold ${statusColor(statuses[entry.path])}`}
          >
            {statusBadge(statuses[entry.path])}
          </span>
        )}
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {!entry.dir && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                act.onCompare(entry.path)
              }}
              title="Compare with active file"
              className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            >
              <GitCompare size={11} strokeWidth={2} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(entry.path)
            }}
            title="Copy relative path"
            className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          >
            <Copy size={11} strokeWidth={2} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              window.gt.files.reveal(entry.path)
            }}
            title="Reveal in Finder"
            className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          >
            <ExternalLink size={11} strokeWidth={2} />
          </button>
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
            statuses={statuses}
            act={act}
          />
        ))}
    </>
  )
}

/**
 * One file's HEAD vs working-tree diff — text through the CodeMirror merge
 * view, images through swipe/onion. `working` short-circuits the disk read
 * when the caller already holds the buffer (the active editor).
 *
 * A HEAD-read failure is NOT an empty original. Remote daemons answer
 * { ok: false, reason: 'Per-file diff not supported…' }, and collapsing that
 * to '' made every unchanged remote file render as a whole-file addition —
 * a confidently wrong diff, which is worse than saying we can't show one.
 */
function PerFileDiff({ path, working }: { path: string; working?: string }) {
  const isImage = viewerKindFor(path) === 'image'
  const [head, setHead] = useState<string | null>(null)
  const [headB64, setHeadB64] = useState<string | null>(null)
  const [work, setWork] = useState<string | null>(null)
  const [workB64, setWorkB64] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setErr(null)
    setHead(null)
    setHeadB64(null)
    setWork(null)
    setWorkB64(null)
    if (isImage) {
      Promise.all([window.gt.getFileAtHeadBinary(path), window.gt.files.readBinary(path)])
        .then(([h, w]) => {
          if (!alive) return
          if (!h.ok) return setErr(h.reason || 'Could not read this file at HEAD')
          setHeadB64(h.base64)
          // A working-tree read failure means the file is deleted — old-only.
          setWorkB64(w.ok ? w.base64 : '')
        })
        .catch((e) => alive && setErr(String(e?.message || e)))
      return () => {
        alive = false
      }
    }
    window.gt
      .getFileAtHead(path)
      .then((r) => {
        if (!alive) return
        if (!r.ok) return setErr(r.reason || 'Could not read this file at HEAD')
        setHead(r.content)
      })
      .catch((e) => alive && setErr(String(e?.message || e)))
    if (working === undefined) {
      window.gt.files.read(path).then((r) => alive && setWork(r.ok ? r.content : ''))
    } else {
      setWork(working)
    }
    return () => {
      alive = false
    }
  }, [path, working, isImage])

  if (err) return <div className="p-6 text-[12px] text-zinc-600">{err}</div>
  if (isImage) {
    if (headB64 === null || workB64 === null)
      return <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
    return <ImageDiffView path={path} oldBase64={headB64} newBase64={workB64} />
  }
  if (head === null || work === null)
    return <div className="p-6 text-[12px] text-zinc-600">Loading diff…</div>
  return <MergeDiffView original={head} modified={work} extensions={langFor(path)} />
}

/** Two arbitrary files diffed against each other (tree "compare with"). */
function CompareView({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const [ca, setCa] = useState<string | null>(null)
  const [cb, setCb] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setCa(null)
    setCb(null)
    setErr(null)
    Promise.all([window.gt.files.read(a), window.gt.files.read(b)]).then(([ra, rb]) => {
      if (!alive) return
      if (!ra.ok) return setErr(`Can't read ${a} — ${ra.reason}`)
      if (!rb.ok) return setErr(`Can't read ${b} — ${rb.reason}`)
      setCa(ra.content)
      setCb(rb.content)
    })
    return () => {
      alive = false
    }
  }, [a, b])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px]">
        <GitCompare size={12} strokeWidth={2} className="text-zinc-400" />
        <span className="truncate font-mono text-zinc-400">{a}</span>
        <span className="text-zinc-600">⟷</span>
        <span className="truncate font-mono text-zinc-400">{b}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="flex items-center rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          title="Close comparison"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {err ? (
          <div className="p-6 text-[12px] text-zinc-600">{err}</div>
        ) : ca === null || cb === null ? (
          <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
        ) : (
          <MergeDiffView original={ca} modified={cb} extensions={langFor(b)} />
        )}
      </div>
    </div>
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
  const [sidebar, setSidebar] = useState<'files' | 'search' | 'changes'>('files')
  // A viewer-backed file (markdown/csv/svg/...) can toggle to its raw source,
  // which hands rendering back to CodeMirror so edit/save stay in one place.
  // Owned HERE, not in FileViewer: flipping it swaps which FileViewer instance
  // is mounted, so any copy held inside the component is wiped on every toggle.
  const [viewerSource, setViewerSource] = useState(false)
  // Per-file "Changes View" (Orca): diff THIS file against HEAD inside its own
  // tab, instead of leaving for the whole-worktree diff pane.
  const [fileDiff, setFileDiff] = useState(false)
  // Compare-with: a tree-picked file diffed against the active open file.
  const [compare, setCompare] = useState<string | null>(null)
  // Changes sidebar: a changed file picked from the list gets its own merge
  // diff; null shows the whole-worktree patch.
  const [changesFile, setChangesFile] = useState<string | null>(null)
  // Per-file git status for tree decorations. Polled (not watched) because an
  // agent writing files is the common case and a 2s poll is cheap next to it.
  // The raw porcelain is kept too — the Changes list needs files only, without
  // the parent-dir rollup the tree decorations use.
  const [statuses, setStatuses] = useState<StatusMap>({})
  const [porcelain, setPorcelain] = useState('')
  // Back/forward across files — the editor-location stack every IDE has, and
  // the thing you miss instantly when it's absent. Held in a ref so pushing a
  // visit never re-renders.
  const history = useRef<{ stack: string[]; at: number }>({ stack: [], at: -1 })
  const [, bumpHistory] = useState(0)
  const filesSidebar = useResizableWidth('gt.filesSidebarWidth', 288, {
    min: 200,
    max: 640,
    edge: 'left',
  })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)
  // The query the current results answer — replace previews must use it, not
  // the live input the user may have edited since.
  const [resultsQuery, setResultsQuery] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [replaceMsg, setReplaceMsg] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [pv, setPv] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editorName, setEditorName] = useState('Cursor')
  const [formatOnSave, setFormatOnSave] = useState(false)
  // Live EditorViews by path, so a formatter result can be dispatched as one
  // minimal change (cursor + scroll survive) instead of a full re-render.
  const views = useRef<Record<string, EditorView>>({})

  const activeFile = open.find((f) => f.path === activePath) || null
  const bump = () => setVersion((v) => v + 1)

  // Opening a different file starts on its rendered view again — switching to a
  // README shouldn't inherit "show source" from the CSV you were just reading.
  useEffect(() => {
    setViewerSource(false)
  }, [activePath])

  useEffect(() => {
    window.gt.files.list('').then(setRoots)
  }, [ctx.repoRoot, version])
  useEffect(() => {
    const load = () =>
      window.gt
        .getStatusPorcelain()
        .then((p) => {
          setPorcelain(p)
          setStatuses(fileStatuses(p))
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [ctx.repoRoot, version])
  useEffect(() => {
    window.gt.settings.get().then((s) => {
      setEditorName(s.apps?.editor || 'Cursor')
      setFormatOnSave(!!s.apps?.formatOnSave)
    })
  }, [])

  // Leaving a file closes its diff and any compare, so neither sticks across
  // files.
  useEffect(() => {
    setFileDiff(false)
    setCompare(null)
  }, [activePath])

  const patch = (path: string, p: Partial<OpenFile>) =>
    setOpen((o) => o.map((f) => (f.path === path ? { ...f, ...p } : f)))

  const openFile = async (path: string, line?: number, fromHistory = false) => {
    setActivePath(path)
    // The palette's `@` (symbols) mode outlines whichever file is open here.
    try {
      localStorage.setItem('gt.files.lastPath', path)
    } catch {
      /* storage disabled */
    }
    if (!fromHistory) {
      const h = history.current
      // Truncate any forward entries — a new visit forks the timeline.
      if (h.stack[h.at] !== path) {
        h.stack = [...h.stack.slice(0, h.at + 1), path]
        h.at = h.stack.length - 1
        bumpHistory((n) => n + 1)
      }
    }
    if (open.some((f) => f.path === path)) {
      if (line) patch(path, { scrollLine: line })
      return
    }
    const r = await window.gt.files.read(path)
    setOpen((o) =>
      o.some((f) => f.path === path)
        ? o
        : [
            ...o,
            {
              path,
              content: r.ok ? r.content : '',
              dirty: false,
              err: r.ok ? undefined : r.reason,
              scrollLine: line,
            },
          ],
    )
  }
  // Cross-tab nav: navigateTo('files', { path, line }) opens that file (from
  // the command palette / search). Held in a ref so the listener always sees
  // the latest openFile without re-subscribing every render.
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId !== 'files') return
        // Cockpit Git panel → jump straight to the Changes view.
        if (ev.payload?.sidebar === 'changes') setSidebar('changes')
        const path = ev.payload?.path as string | undefined
        if (path) openFileRef.current(path, ev.payload?.line as number | undefined)
      }),
    [],
  )

  const closeFile = (path: string) =>
    setOpen((o) => {
      const idx = o.findIndex((f) => f.path === path)
      const next = o.filter((f) => f.path !== path)
      if (activePath === path) setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null)
      return next
    })
  const save = async () => {
    if (!activeFile || activeFile.err) return
    let content = activeFile.content
    // An already-scheduled autosave holds this same (now superseded) content —
    // left alone it could fire after the formatted write below and clobber it
    // with the stale pre-format text.
    clearTimeout(saveTimers.current[activeFile.path])
    // Format on save (opt-in, ⌘S only — the debounced auto-save stays raw so
    // the formatter never fights mid-typing). Skipped silently when the
    // project has no prettier or prettier doesn't own the file.
    if (formatOnSave) {
      const r = await window.gt.files.format(activeFile.path, content)
      if (r.ok && r.content !== undefined && r.content !== content) {
        const view = views.current[activeFile.path]
        // Only apply if the buffer didn't change while prettier ran.
        if (view && view.state.doc.toString() === content) {
          const c = minimalChange(content, r.content)
          if (c) view.dispatch({ changes: c })
          content = r.content
        } else if (!view) {
          content = r.content
        }
      }
    }
    if (await window.gt.files.write(activeFile.path, content))
      patch(activeFile.path, { content, dirty: false })
  }

  // auto-save: debounce a write per file on edit (no ⌘S needed). Keyed by path
  // + content so a tab switch can't save the wrong file.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const scheduleSave = (path: string, content: string) => {
    clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(async () => {
      if (await window.gt.files.write(path, content)) patch(path, { dirty: false })
    }, 700)
  }
  // flush any pending saves when leaving the Files tab
  const openRef = useRef(open)
  openRef.current = open
  useEffect(
    () => () => {
      for (const t of Object.values(saveTimers.current)) clearTimeout(t)
      for (const f of openRef.current)
        if (f.dirty && !f.err) window.gt.files.write(f.path, f.content)
    },
    [],
  )

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

  // Latest-query-wins: a slow earlier search can resolve after a newer one, so
  // tag each run and drop stale responses (that was the "flaky" results).
  const runSearch = async () => {
    const q = query.trim()
    const seq = ++searchSeq.current
    setSearching(true)
    const r = q.length < 2 ? [] : await window.gt.files.search(q)
    if (seq !== searchSeq.current) return // superseded
    setResults(r)
    setResultsQuery(q)
    setExcluded(new Set())
    setReplaceMsg('')
    setSearching(false)
  }

  // Apply the replacement to every non-excluded match. Dirty buffers flush
  // first so the on-disk text the replace reads is what you see; changed open
  // files reload from disk after.
  const runReplace = async () => {
    if (!results || !resultsQuery) return
    const targets = results
      .filter((_, i) => !excluded.has(i))
      .map((r) => ({ file: r.file, line: r.line }))
    if (targets.length === 0) return
    setReplacing(true)
    for (const f of open) if (f.dirty && !f.err) await window.gt.files.write(f.path, f.content)
    const res = await window.gt.files.replace(resultsQuery, replacement, targets)
    const touched = new Set(targets.map((t) => t.file))
    for (const f of open) {
      if (!touched.has(f.path)) continue
      const read = await window.gt.files.read(f.path)
      if (read.ok) patch(f.path, { content: read.content, dirty: false })
    }
    setReplacing(false)
    setReplaceMsg(
      `Replaced ${res.replaced} in ${res.files} file${res.files === 1 ? '' : 's'}` +
        (res.skipped ? ` · ${res.skipped} skipped` : ''),
    )
    bump()
    runSearch()
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

  // Tree drag-and-drop: rename under the hood, with open buffers and the
  // active path following the file to its new home.
  const movePath = async (from: string, toDir: string) => {
    const dest = moveTargetFor(from, toDir)
    if (!dest) return
    if (await window.gt.files.rename(from, dest)) {
      const remap = (p: string) =>
        p === from ? dest : p.startsWith(from + '/') ? dest + p.slice(from.length) : p
      setOpen((o) => o.map((f) => ({ ...f, path: remap(f.path) })))
      if (activePath) setActivePath(remap(activePath))
      bump()
    }
  }

  const nodeActs: NodeActions = {
    onOpen: (p) => openFile(p),
    onSelectDir: setSelectedDir,
    onRename: (p) => startPrompt({ kind: 'rename', target: p }),
    onDelete: setConfirmDelete,
    onMove: movePath,
    onCompare: (p) => {
      // Nothing open to compare against → just open the file instead.
      if (!activePath || activePath === p) openFile(p)
      else setCompare(p)
    },
    absFor: (p) => {
      const root = ctx.repoRoot || ctx.cwd || ''
      return root ? `${root}/${p}` : p
    },
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
          open.map((f) => {
            const { Icon, cls } = fileIcon(base(f.path), false)
            return (
              <div
                key={f.path}
                onClick={() => setActivePath(f.path)}
                title={f.path}
                className={`group flex cursor-pointer items-center gap-1.5 border-r border-[var(--gt-border)] px-3 text-[12px] ${
                  activePath === f.path
                    ? 'bg-[var(--gt-bg)] text-zinc-100'
                    : 'bg-black/20 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon size={13} strokeWidth={2} className={`shrink-0 ${cls}`} />
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
            )
          })
        )}
        <div className="flex-1" />
        {activeFile && !activeFile.err && (
          <span
            className={`shrink-0 px-3 text-[11px] ${activeFile.dirty ? 'text-amber-400' : 'text-zinc-600'}`}
          >
            {activeFile.dirty ? 'saving…' : 'saved'}
          </span>
        )}
      </div>

      {/* breadcrumbs — the active file's path, each segment clickable to reveal
          that folder in the tree. Also carries the detected indentation. */}
      {activeFile && sidebar !== 'changes' && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-3 py-1 text-[10.5px] text-zinc-600">
          {activeFile.path.split('/').map((seg, i, all) => {
            const upto = all.slice(0, i + 1).join('/')
            const last = i === all.length - 1
            return (
              <span key={upto} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-700">/</span>}
                <button
                  onClick={() => !last && setSelectedDir(upto)}
                  className={
                    last ? 'text-zinc-300' : 'cursor-pointer transition-colors hover:text-zinc-300'
                  }
                >
                  {seg}
                </button>
              </span>
            )
          })}
          <div className="flex-1" />
          <button
            onClick={() => {
              const h = history.current
              if (h.at > 0) {
                h.at--
                bumpHistory((n) => n + 1)
                openFile(h.stack[h.at], undefined, true)
              }
            }}
            disabled={history.current.at <= 0}
            title="Back"
            className="inline-flex cursor-pointer items-center rounded px-1 py-0.5 transition-colors hover:bg-white/5 hover:text-zinc-300 disabled:cursor-default disabled:opacity-30"
          >
            <ArrowLeft size={11} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              const h = history.current
              if (h.at < h.stack.length - 1) {
                h.at++
                bumpHistory((n) => n + 1)
                openFile(h.stack[h.at], undefined, true)
              }
            }}
            disabled={history.current.at >= history.current.stack.length - 1}
            title="Forward"
            className="inline-flex cursor-pointer items-center rounded px-1 py-0.5 transition-colors hover:bg-white/5 hover:text-zinc-300 disabled:cursor-default disabled:opacity-30"
          >
            <ArrowRight size={11} strokeWidth={2} />
          </button>
          {/* Text-backed files diff through the merge view; images get their
              own swipe/onion diff. Other binary kinds (PDF/hex) still can't be
              diffed — their `content` is empty and the result would be an
              all-deleted diff of an unchanged file. */}
          {(!needsBinaryRead(viewerKindFor(activeFile.path)) ||
            viewerKindFor(activeFile.path) === 'image') && (
            <button
              onClick={() => setFileDiff((d) => !d)}
              title="Diff this file against HEAD"
              className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                fileDiff
                  ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                  : 'hover:bg-white/5 hover:text-zinc-300'
              }`}
            >
              <GitCompare size={11} strokeWidth={2} />
              Changes
            </button>
          )}
          <span className="tabular-nums">{describeIndent(detectIndent(activeFile.content))}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* editor (left) — replaced by the working diff when Changes is active */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {sidebar === 'changes' ? (
            changesFile ? (
              <PerFileDiff path={changesFile} />
            ) : (
              <WorkingDiffView />
            )
          ) : compare && activeFile ? (
            <CompareView a={compare} b={activeFile.path} onClose={() => setCompare(null)} />
          ) : !activeFile ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Select a file to edit.
            </div>
          ) : activeFile.err && !hasViewer(activeFile.path) ? (
            <div className="p-6 text-[12px] text-zinc-600">
              Can't open {activeFile.path} — {activeFile.err}
            </div>
          ) : fileDiff ? (
            <PerFileDiff
              path={activeFile.path}
              working={
                needsBinaryRead(viewerKindFor(activeFile.path)) ? undefined : activeFile.content
              }
            />
          ) : hasViewer(activeFile.path) && !viewerSource ? (
            // Rendered viewer (markdown/image/pdf/csv/svg/binary). This runs
            // even when the utf8 read failed — an image legitimately fails that
            // read and is loaded through the binary channel instead.
            <FileViewer
              key={activeFile.path}
              path={activeFile.path}
              text={activeFile.content}
              showSource={false}
              onWantsSource={setViewerSource}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {hasViewer(activeFile.path) && (
                <FileViewer
                  key={`${activeFile.path}:src`}
                  path={activeFile.path}
                  text={activeFile.content}
                  showSource
                  onWantsSource={setViewerSource}
                />
              )}
              <div className="min-h-0 flex-1">
                <CodeEditor
                  key={activeFile.path}
                  value={activeFile.content}
                  onChange={(v) => {
                    patch(activeFile.path, { content: v, dirty: true })
                    scheduleSave(activeFile.path, v)
                  }}
                  extensions={langFor(activeFile.path)}
                  scrollToLine={activeFile.scrollLine}
                  onView={(v) => (views.current[activeFile.path] = v)}
                />
              </div>
            </div>
          )}
        </div>

        {/* sidebar (right) — drag the divider to resize */}
        <ResizeHandle onMouseDown={filesSidebar.onResizeStart} />
        <aside
          className="flex shrink-0 flex-col border-l border-[var(--gt-border)]"
          style={{ width: filesSidebar.width }}
        >
          <div className="flex shrink-0 border-b border-[var(--gt-border)] p-1.5">
            <button
              onClick={() => setSidebar('files')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                sidebar === 'files'
                  ? 'bg-white/10 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <FolderTree size={13} strokeWidth={2} />
              Files
            </button>
            <button
              onClick={() => setSidebar('search')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                sidebar === 'search'
                  ? 'bg-white/10 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <Search size={13} strokeWidth={2} />
              Search
            </button>
            <button
              onClick={() => setSidebar('changes')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                sidebar === 'changes'
                  ? 'bg-white/10 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              <GitCompare size={13} strokeWidth={2} />
              Changes
            </button>
          </div>

          {sidebar === 'changes' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <button
                onClick={() => setChangesFile(null)}
                className={`shrink-0 border-b border-[var(--gt-border)] px-3 py-2 text-left text-[11px] font-medium ${
                  changesFile === null
                    ? 'bg-white/5 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                All changes · patch view
              </button>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {Object.entries(parsePorcelain(porcelain)).length === 0 ? (
                  <div className="p-3 text-[11px] leading-relaxed text-zinc-600">
                    No uncommitted changes. The pane shows everything since the base branch.
                  </div>
                ) : (
                  Object.entries(parsePorcelain(porcelain)).map(([path, st]) => {
                    const { Icon, cls } = fileIcon(base(path), false)
                    return (
                      <button
                        key={path}
                        onClick={() => setChangesFile(path)}
                        title={path}
                        className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11.5px] hover:bg-white/5 ${
                          changesFile === path
                            ? 'bg-[var(--gt-accent)]/12 text-zinc-100'
                            : 'text-zinc-400'
                        }`}
                      >
                        <Icon size={12} strokeWidth={2} className={`shrink-0 ${cls}`} />
                        <span className={`min-w-0 flex-1 truncate font-mono ${statusColor(st)}`}>
                          {path}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[10px] font-bold ${statusColor(st)}`}
                        >
                          {statusBadge(st)}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : sidebar === 'files' ? (
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
                <span className="truncate font-mono text-[10px] text-zinc-600">
                  in&nbsp;/{selectedDir}
                </span>
                <button
                  onClick={() =>
                    window.gt.openInEditor(
                      activePath ? `${ctx.repoRoot}/${activePath}` : ctx.repoRoot || undefined,
                    )
                  }
                  title={`Open ${activePath ? 'this file' : 'this repo'} in ${editorName}`}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-200"
                >
                  <ExternalLink size={12} strokeWidth={2} />
                  {editorName}
                </button>
              </div>

              {prompt && (
                <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-black/30 px-2 py-1.5">
                  <span className="text-[10px] text-zinc-500">
                    {prompt.kind === 'rename'
                      ? 'rename'
                      : prompt.kind === 'new-folder'
                        ? 'folder'
                        : 'file'}
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
                  <button
                    onClick={commitDelete}
                    className="rounded bg-[var(--gt-red)]/20 px-1.5 py-0.5 text-[var(--gt-red)]"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="flex items-center px-1 text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              )}

              <div
                className="min-h-0 flex-1 overflow-y-auto py-1"
                key={version}
                onDragOver={(e) => {
                  // Falling through a folder row lands the drop at the root.
                  if (!e.dataTransfer.types.includes(DND_REL)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  const from = e.dataTransfer.getData(DND_REL)
                  if (from) movePath(from, '')
                }}
              >
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
                      statuses={statuses}
                      act={nodeActs}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 space-y-1.5 p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="Search repo (Enter)"
                    className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                  />
                  <button
                    onClick={() => setReplaceOpen((o) => !o)}
                    title="Search & replace"
                    className={`flex shrink-0 items-center rounded-md border border-[var(--gt-border)] p-1.5 ${
                      replaceOpen
                        ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    <Replace size={13} strokeWidth={2} />
                  </button>
                </div>
                {replaceOpen && (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                      placeholder="Replace with"
                      className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                    />
                    <button
                      onClick={runReplace}
                      disabled={
                        replacing ||
                        !results ||
                        results.length === 0 ||
                        results.length === excluded.size
                      }
                      className="shrink-0 rounded-md bg-[var(--gt-accent)]/20 px-2 py-1 text-[11px] font-medium text-zinc-100 disabled:opacity-40"
                    >
                      {replacing
                        ? 'Replacing…'
                        : `Replace${results ? ` ${results.length - excluded.size}` : ''}`}
                    </button>
                  </div>
                )}
                {replaceMsg && (
                  <div className="px-0.5 text-[10.5px] text-zinc-500">{replaceMsg}</div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {searching ? (
                  <div className="p-3 text-[12px] text-zinc-600">Searching…</div>
                ) : results === null ? (
                  <div className="p-3 text-[12px] text-zinc-600">Type a query and press Enter.</div>
                ) : results.length === 0 ? (
                  <div className="p-3 text-[12px] text-zinc-600">
                    No matches for “{resultsQuery}”.
                  </div>
                ) : (
                  results.map((r, i) => {
                    const { Icon, cls } = fileIcon(base(r.file), false)
                    const line = r.text.trim()
                    return (
                      <div
                        key={i}
                        className={`flex w-full items-start gap-1 border-b border-[var(--gt-border)]/50 px-2 py-1.5 hover:bg-white/5 ${
                          excluded.has(i) ? 'opacity-45' : ''
                        }`}
                      >
                        {replaceOpen && (
                          <input
                            type="checkbox"
                            checked={!excluded.has(i)}
                            onChange={() =>
                              setExcluded((ex) => {
                                const next = new Set(ex)
                                if (next.has(i)) next.delete(i)
                                else next.add(i)
                                return next
                              })
                            }
                            className="mt-0.5 shrink-0 accent-[var(--gt-accent)]"
                          />
                        )}
                        <button
                          onClick={() => openFile(r.file, r.line)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5 truncate font-mono text-[11px] text-zinc-400">
                            <Icon size={12} strokeWidth={2} className={`shrink-0 ${cls}`} />
                            <span className="truncate">
                              {r.file}:{r.line}
                            </span>
                          </div>
                          <div className="truncate pl-[18px] font-mono text-[11px] text-zinc-500">
                            {matchSegments(line, resultsQuery).map((seg, j) =>
                              seg.hit ? (
                                <mark
                                  key={j}
                                  className="rounded-sm bg-[var(--gt-accent)]/25 px-px text-zinc-200"
                                >
                                  {seg.text}
                                </mark>
                              ) : (
                                <span key={j}>{seg.text}</span>
                              ),
                            )}
                          </div>
                          {/* per-match preview of what the line becomes */}
                          {replaceOpen && !excluded.has(i) && (
                            <div className="truncate pl-[18px] font-mono text-[11px] text-emerald-500/80">
                              {replaceInLine(line, resultsQuery, replacement).text}
                            </div>
                          )}
                        </button>
                      </div>
                    )
                  })
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
  order: 8,
  appliesTo: (ctx) => !!(ctx.repoRoot || ctx.cwd),
  Component: FilesTab,
}
export default tab
