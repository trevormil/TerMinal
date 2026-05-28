import { useEffect, useState } from 'react'
import { X, FolderOpen, Plus, GitBranch } from 'lucide-react'
import type { SessionMeta } from '../lib/types'
import logo from '../assets/logo.png'

export type Choice = { mode: 'new' | 'resume'; sessionId?: string; cwd?: string; name?: string }

function rel(ms: number): string {
  const s = (Date.now() - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const underDir = (sessionCwd: string, dir: string) =>
  sessionCwd === dir || sessionCwd.startsWith(dir.replace(/\/$/, '') + '/')

export function EntryScreen({
  onChoose,
  onCancel,
}: {
  onChoose: (c: Choice) => void
  onCancel?: () => void
}) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null)
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([])
  const [cwd, setCwd] = useState('') // new-session target
  const [filterDir, setFilterDir] = useState('') // resume filter ('' = all)
  const [name, setName] = useState('')

  useEffect(() => {
    window.gt.listSessions().then((s) => {
      setSessions(s)
      if (s[0]?.cwd) setCwd(s[0].cwd)
    })
    window.gt.gauntletDirs().then(setDirs)
  }, [])

  // selecting a folder targets the new session there AND filters resume to it
  const selectDir = (path: string) => {
    setCwd(path)
    setFilterDir(path)
  }
  const browse = async () => {
    const dir = await window.gt.pickDir()
    if (dir) selectDir(dir)
  }

  const all = sessions || []
  const shown = filterDir ? all.filter((s) => underDir(s.cwd, filterDir)) : all
  const countFor = (path: string) => all.filter((s) => underDir(s.cwd, path)).length

  const sel =
    'rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <div className="mb-1 flex items-center gap-2.5">
          <img src={logo} alt="" draggable={false} className="h-9 w-9 rounded-lg" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">Gauntlet Terminal</h1>
          <div className="flex-1" />
          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            >
              <X size={13} strokeWidth={2} />
              cancel
            </button>
          )}
        </div>
        <p className="mb-6 text-sm text-zinc-500">
          Attach to a Claude session. This window pins to it — context, usage, and telemetry all
          track that one session.
        </p>

        {/* quick-pick directories */}
        {dirs.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Projects
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dirs.map((d) => {
                const n = countFor(d.path)
                const active = filterDir === d.path
                return (
                  <button
                    key={d.path}
                    onClick={() => selectDir(d.path)}
                    title={d.path}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                      active
                        ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                        : 'border-[var(--gt-border)] text-zinc-300 hover:border-[var(--gt-accent)]/60'
                    }`}
                  >
                    {d.name}
                    {n > 0 && <span className="ml-1 text-[10px] text-zinc-500">{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* start new */}
        <div className="mb-6 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Start a new session
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={browse}
              className={`${sel} inline-flex shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}
            >
              <FolderOpen size={13} strokeWidth={2} />
              Folder
            </button>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~ (home)"
              spellCheck={false}
              className={`${sel} min-w-0 flex-1 font-mono`}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="session name (optional)"
              className={`${sel} min-w-0 flex-1`}
            />
            <button
              onClick={() =>
                onChoose({ mode: 'new', cwd: cwd.trim() || undefined, name: name.trim() || undefined })
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90"
            >
              <Plus size={14} strokeWidth={2.5} />
              New session
            </button>
          </div>
        </div>

        {/* resume */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Resume{filterDir ? ` · ${filterDir.split('/').pop()}` : ''} ({shown.length})
          </span>
          {filterDir && (
            <button
              onClick={() => setFilterDir('')}
              className="text-[11px] text-[var(--gt-accent-2)] hover:underline"
            >
              show all
            </button>
          )}
        </div>
        {sessions === null ? (
          <div className="py-6 text-center text-[12px] text-zinc-600">Scanning sessions…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-600">
            {filterDir ? 'No sessions for this folder — start a new one above.' : 'No prior Claude sessions found.'}
          </div>
        ) : (
          <div className="space-y-2">
            {shown.slice(0, 300).map((s) => (
              <button
                key={s.id}
                onClick={() => onChoose({ mode: 'resume', sessionId: s.id, cwd: s.cwd })}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 text-left hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-zinc-100">
                    {s.firstUserText || <span className="italic text-zinc-500">untitled session</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-zinc-500">
                    <span className="font-mono">{tilde(s.cwd) || '~'}</span>
                    {s.gitBranch && (
                      <span className="inline-flex items-center gap-0.5 text-zinc-600">
                        <GitBranch size={11} strokeWidth={2} />
                        {s.gitBranch}
                      </span>
                    )}
                    <span className="text-zinc-600">· {s.turns} turns</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10.5px] text-zinc-500">
                  <div>{rel(s.mtime)}</div>
                  <div className="font-mono text-zinc-600">{s.id.slice(0, 8)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
