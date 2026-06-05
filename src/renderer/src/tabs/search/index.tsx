import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  Clipboard,
  FileText,
  GitPullRequest,
  ListChecks,
  Loader2,
  Search,
  ScrollText,
  Ticket,
} from 'lucide-react'
import { navigateTo, onNavigate } from '../../lib/nav'
import type { Tab, TabContext, WorkspaceSearchKind, WorkspaceSearchResult } from '../../lib/types'

const KINDS: { id: WorkspaceSearchKind; label: string; icon: typeof Search }[] = [
  { id: 'file', label: 'Files', icon: FileText },
  { id: 'ticket', label: 'Tickets', icon: Ticket },
  { id: 'mr', label: 'MRs', icon: GitPullRequest },
  { id: 'run', label: 'Runs', icon: ListChecks },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'doc', label: 'Docs', icon: ScrollText },
  { id: 'snippet', label: 'Snippets', icon: Clipboard },
  { id: 'agent-artifact', label: 'Artifacts', icon: Bot },
]

const KIND_META: Record<WorkspaceSearchKind, { label: string; icon: typeof Search; tone: string }> = {
  file: { label: 'File', icon: FileText, tone: 'text-sky-300' },
  ticket: { label: 'Ticket', icon: Ticket, tone: 'text-amber-300' },
  mr: { label: 'MR/PR', icon: GitPullRequest, tone: 'text-fuchsia-300' },
  run: { label: 'Run', icon: ListChecks, tone: 'text-emerald-300' },
  activity: { label: 'Activity', icon: Activity, tone: 'text-cyan-300' },
  doc: { label: 'Doc', icon: ScrollText, tone: 'text-indigo-300' },
  snippet: { label: 'Snippet', icon: Clipboard, tone: 'text-lime-300' },
  'agent-artifact': { label: 'Artifact', icon: Bot, tone: 'text-rose-300' },
}

function route(result: WorkspaceSearchResult) {
  const payload = result.payload || {}
  let target = ''
  let routedPayload: Record<string, unknown> | undefined
  if (result.kind === 'file') {
    target = 'files'
    routedPayload = { path: result.path || payload.path, line: result.line || payload.line }
  } else if (result.kind === 'ticket') {
    target = 'tickets'
    routedPayload = { slug: payload.slug }
  } else if (result.kind === 'mr') {
    target = 'mrs'
    routedPayload = { iid: payload.iid }
  } else if (result.kind === 'doc') {
    target = 'docs'
    routedPayload = { path: result.path || payload.path }
  } else if (result.kind === 'run') {
    target = 'runs'
    routedPayload = { runId: payload.runId }
  } else if (result.kind === 'activity') {
    if (payload.runId) {
      target = 'runs'
      routedPayload = { runId: payload.runId }
    } else if (payload.pr) {
      target = 'mrs'
      routedPayload = { iid: payload.pr }
    } else {
      target = 'activity'
    }
  } else if (result.kind === 'agent-artifact') {
    target = 'agents'
    routedPayload = { agentId: payload.agentId, artifactPath: payload.artifactPath }
  } else if (result.kind === 'snippet') {
    if (typeof payload.prompt === 'string') window.gt.clipboardWrite(payload.prompt).catch(() => {})
    target = 'terminal'
  }
  if (!target) return
  navigateTo(target, routedPayload)
  // Deep-link receivers only mount after the active tab changes; replay once.
  setTimeout(() => navigateTo(target, routedPayload), 50)
}

function timeAgo(ts?: number) {
  if (!ts) return ''
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function SearchTab({ ctx }: { ctx: TabContext }) {
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<Set<WorkspaceSearchKind>>(() => new Set(KINDS.map((k) => k.id)))
  const [results, setResults] = useState<WorkspaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId !== 'search') return
        const q = ev.payload?.q
        if (typeof q === 'string') setQuery(q)
      }),
    [],
  )

  const activeKinds = useMemo(() => KINDS.map((k) => k.id).filter((k) => enabled.has(k)), [enabled])

  useEffect(() => {
    const q = query.trim()
    const run = ++seq.current
    if (q.length < 2 || activeKinds.length === 0) {
      setResults([])
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      window.gt.workspace
        .search(q, activeKinds)
        .then((r) => {
          if (run !== seq.current) return
          setResults(r.results || [])
          setError(r.error || '')
        })
        .catch((e) => {
          if (run !== seq.current) return
          setResults([])
          setError(String(e?.message || e))
        })
        .finally(() => {
          if (run === seq.current) setLoading(false)
        })
    }, 160)
    return () => clearTimeout(t)
  }, [query, activeKinds])

  const toggleKind = (kind: WorkspaceSearchKind) =>
    setEnabled((prev) => {
      const next = new Set(prev)
      next.has(kind) ? next.delete(kind) : next.add(kind)
      return next
    })

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <header className="shrink-0 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/55 px-4 py-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-[var(--gt-accent-light)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files, tickets, MRs, docs, runs, snippets, activity..."
            className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-600 outline-none"
          />
          {loading && <Loader2 size={14} className="animate-spin text-zinc-500" />}
          <span className="text-[11px] text-zinc-600">{ctx.repoPath || ctx.repoRoot}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => {
            const Icon = k.icon
            const on = enabled.has(k.id)
            return (
              <button
                key={k.id}
                onClick={() => toggleKind(k.id)}
                className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] ${
                  on
                    ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] bg-black/10 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon size={12} />
                {k.label}
              </button>
            )
          })}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {query.trim().length < 2 ? (
          <div className="px-4 py-10 text-center text-[12px] text-zinc-600">
            Type at least two characters to search this workspace.
          </div>
        ) : activeKinds.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-zinc-600">
            Enable at least one source.
          </div>
        ) : results.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center text-[12px] text-zinc-600">No matches.</div>
        ) : (
          <div className="divide-y divide-[var(--gt-border)]">
            {results.map((r) => {
              const meta = KIND_META[r.kind]
              const Icon = meta.icon
              return (
                <button
                  key={r.id}
                  onClick={() => route(r)}
                  className="grid w-full grid-cols-[120px_minmax(0,1fr)_80px] items-start gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04]"
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                    <Icon size={13} className={meta.tone} />
                    {meta.label}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-200">{r.title}</span>
                    {r.subtitle && <span className="mt-0.5 block truncate text-[11px] text-zinc-600">{r.subtitle}</span>}
                    {r.detail && <span className="mt-1 block truncate text-[12px] text-zinc-500">{r.detail}</span>}
                  </span>
                  <span className="text-right text-[10.5px] text-zinc-700">{timeAgo(r.ts)}</span>
                </button>
              )
            })}
          </div>
        )}
      </main>
      {error && (
        <footer className="shrink-0 border-t border-[var(--gt-border)] px-4 py-2 text-[11px] text-[var(--gt-yellow)]">
          Partial results: {error}
        </footer>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'search',
  title: 'Search',
  icon: Search,
  order: 2.5,
  appliesTo: () => true,
  Component: SearchTab,
}
export default tab
