import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Save, Workflow } from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import type { Extension } from '@codemirror/state'
import { CodeEditor } from '../../components/CodeEditor'
import { fileIcon } from '../../lib/fileIcons'
import type { FileEntry, Tab, TabContext } from '../../lib/types'

const EXT: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', md: 'markdown', mdx: 'markdown', css: 'css', html: 'html',
  py: 'py', rs: 'rs', go: 'go', yaml: 'yaml', yml: 'yaml', sql: 'sql', sh: 'sh', bash: 'sh',
  zsh: 'sh', toml: 'toml', xml: 'xml',
}
const base = (p: string) => p.split('/').pop() || p

function langFor(path: string): Extension[] {
  const key = EXT[path.split('.').pop()?.toLowerCase() || ''] as keyof typeof langs | undefined
  try {
    return key && langs[key] ? [langs[key]()] : []
  } catch {
    return []
  }
}

function TreeNode({
  entry,
  depth,
  activePath,
  onOpen,
}: {
  entry: FileEntry
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const load = async () => {
    if (!entry.dir) return onOpen(entry.path)
    if (children === null) setChildren(await window.gt.workflow.list(entry.path))
    setOpen((v) => !v)
  }
  const { Icon, cls } = fileIcon(entry.name, entry.dir, open)
  const selected = activePath === entry.path
  return (
    <>
      <button
        onClick={load}
        disabled={entry.ignored}
        title={entry.ignored ? `${entry.name} not found` : entry.path}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={`group flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] hover:bg-white/5 ${
          selected ? 'bg-[var(--gt-accent)]/12 text-zinc-100' : 'text-zinc-300'
        } ${entry.ignored ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-zinc-600">
          {entry.dir ? open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} /> : null}
        </span>
        <Icon size={14} strokeWidth={2} className={`shrink-0 ${cls}`} />
        <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
      </button>
      {entry.dir &&
        open &&
        children?.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
        ))}
    </>
  )
}

type OpenWorkflowFile = { path: string; content: string; saved: string; err?: string }

function WorkflowTab(_props: { ctx: TabContext }) {
  const [roots, setRoots] = useState<FileEntry[] | null>(null)
  const [active, setActive] = useState<OpenWorkflowFile | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const dirty = !!active && active.content !== active.saved
  const title = active ? base(active.path) : 'My Workflow'

  const loadRoots = async () => setRoots(await window.gt.workflow.list(''))
  useEffect(() => {
    loadRoots()
  }, [])

  const openFile = async (path: string) => {
    setMessage('')
    const r = await window.gt.workflow.read(path)
    setActive({ path, content: r.ok ? r.content : '', saved: r.ok ? r.content : '', err: r.ok ? undefined : r.reason })
  }

  const save = async () => {
    if (!active || active.err || !dirty) return
    setSaving(true)
    const ok = await window.gt.workflow.write(active.path, active.content)
    setSaving(false)
    if (ok) {
      setActive({ ...active, saved: active.content })
      setMessage('saved')
    } else {
      setMessage('save failed')
    }
  }

  const extensions = useMemo(() => (active ? langFor(active.path) : []), [active?.path])

  return (
    <div className="flex h-full min-h-0 bg-[var(--gt-bg)]">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/35">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
          <Workflow size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-zinc-200">My Workflow</div>
            <div className="truncate text-[10.5px] text-zinc-600">~/.claude · ~/.codex</div>
          </div>
          <button
            onClick={loadRoots}
            title="Refresh"
            className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          >
            <RefreshCw size={12} strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {roots === null ? (
            <div className="p-3 text-[12px] text-zinc-600">Loading...</div>
          ) : (
            roots.map((entry) => <TreeNode key={entry.path} entry={entry} depth={0} activePath={active?.path || null} onOpen={openFile} />)
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-300">{active ? active.path : title}</span>
          {message && <span className="text-[11px] text-zinc-500">{message}</span>}
          {active && !active.err && (
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                dirty
                  ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/25'
                  : 'cursor-not-allowed border-[var(--gt-border)] text-zinc-600'
              }`}
            >
              <Save size={12} strokeWidth={2} />
              {saving ? 'Saving' : 'Save'}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {!active ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Select a workflow file.
            </div>
          ) : active.err ? (
            <div className="p-6 text-[12px] text-zinc-600">
              Can't open {active.path} - {active.err}
            </div>
          ) : (
            <CodeEditor
              value={active.content}
              onChange={(content) => {
                setMessage('')
                setActive({ ...active, content })
              }}
              extensions={extensions}
            />
          )}
        </div>
      </main>
    </div>
  )
}

const tab: Tab = {
  id: 'workflow',
  title: 'My Workflow',
  icon: Workflow,
  order: 8.5,
  appliesTo: () => true,
  Component: WorkflowTab,
}

export default tab
