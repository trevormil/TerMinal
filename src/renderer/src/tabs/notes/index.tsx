import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NotebookText, FolderGit2, Globe } from 'lucide-react'
import { langs } from '@uiw/codemirror-extensions-langs'
import { CodeEditor } from '../../components/CodeEditor'
import { Markdown } from '../../components/Markdown'
import type { Tab, TabContext } from '../../lib/types'

type Scope = 'repo' | 'global'
type Mode = 'edit' | 'split' | 'preview'

function NotesTab({ ctx }: { ctx: TabContext }) {
  const hasRepo = !!ctx.repoRoot
  const [scope, setScope] = useState<Scope>(hasRepo ? 'repo' : 'global')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('split')
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ scope, text, saved })
  latest.current = { scope, text, saved }

  // load when scope (or attached repo) changes
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

  // flush any pending edit when the tab unmounts (switching away)
  useEffect(
    () => () => {
      if (!latest.current.saved) window.gt.notes.write(latest.current.scope, latest.current.text)
    },
    [],
  )

  const onChange = (v: string) => {
    setText(v)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.gt.notes.write(scope, v).then(() => setSaved(true))
    }, 600)
  }

  const switchScope = (s: Scope) => {
    if (s === scope) return
    if (!saved) window.gt.notes.write(scope, text)
    setScope(s)
  }

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

  const editor = (
    <div className="h-full min-h-0 overflow-hidden">
      <CodeEditor value={text} onChange={onChange} extensions={[langs.markdown()]} wrap />
    </div>
  )
  const preview = (
    <div className="h-full overflow-y-auto p-5">
      {text.trim() ? (
        <Markdown>{text}</Markdown>
      ) : (
        <div className="text-[12px] italic text-zinc-600">Nothing yet — start typing.</div>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
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
        <div className="flex-1" />
        <span className={`text-[10.5px] ${saved ? 'text-zinc-600' : 'text-amber-400'}`}>
          {saved ? 'saved' : 'saving…'}
        </span>
        <div className="flex rounded-lg border border-[var(--gt-border)] p-0.5">
          {segMode('edit', 'Edit')}
          {segMode('split', 'Split')}
          {segMode('preview', 'Preview')}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'edit' && editor}
        {mode === 'preview' && preview}
        {mode === 'split' && (
          <div className="flex h-full min-h-0">
            <div className="min-h-0 w-1/2 border-r border-[var(--gt-border)]">{editor}</div>
            <div className="min-h-0 w-1/2">{preview}</div>
          </div>
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'notes',
  title: 'Notes',
  icon: NotebookText,
  order: 2,
  appliesTo: () => true, // always on
  Component: NotesTab,
}
export default tab
