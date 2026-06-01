import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Inbox, ListChecks, Pause, Play, RefreshCw, Search, X } from 'lucide-react'
import { Badge } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import type { ListenerStatus, TabContext } from '../../lib/types'
import { RunLogPane } from './RunLogPane'

const inboxTone = (s: string): BadgeTone =>
  s === 'done' ? 'green' : s === 'failed' || s === 'dead-letter' ? 'red' : s === 'new' ? 'blue' : 'mute'

function fmtWhen(ts?: number | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`
}

function reltime(ts?: number): string {
  if (!ts) return ''
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function AutomationInfoBox() {
  return (
    <div className="mx-3 mt-3 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/50 px-3 py-2 text-[11.5px] text-zinc-500">
      <div className="flex items-start gap-2">
        <Inbox size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-zinc-300">Automation Inbox is email for TerMinal.</div>
          <div className="mt-0.5 leading-relaxed">
            Outside systems drop structured requests into the inbox. TerMinal processes each request into a run,
            ticket, activity item, or HITL item, then keeps the request-to-run trail here. Runs are execution history;
            schedules are time-based triggers.
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">One-off request</div>
              <div className="text-[11px] leading-snug text-zinc-500">
                Ask an agent to enqueue a single request with <span className="font-mono text-zinc-300">/automation-inbox</span>.
              </div>
            </div>
            <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Source setup</div>
              <div className="text-[11px] leading-snug text-zinc-500">
                Build a durable adapter or service with <span className="font-mono text-zinc-300">/new-inbox-source</span>.
              </div>
            </div>
          </div>
          <div className="mt-2 rounded-md border border-[var(--gt-border)] bg-black/20 p-2 font-mono text-[10.5px] text-zinc-500">
            terminal-cli inbox enqueue --source github --type merge_request.opened --title "Review MR" --repo-root "$PWD" --action run-agent --agent code-review
          </div>
        </div>
      </div>
    </div>
  )
}

export function AutomationInboxView({ ctx }: { ctx: TabContext }) {
  const [status, setStatus] = useState<ListenerStatus | null>(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [listenerFilter, setListenerFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [runsOnly, setRunsOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'source' | 'category'>('newest')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 5000)
  }
  const onRefresh = async () => setStatus(await window.gt.listeners.status())

  useEffect(() => {
    onRefresh()
    const id = setInterval(onRefresh, 5000)
    return () => clearInterval(id)
  }, [ctx.sessionId])

  const counts = status?.counts
  const recent = status?.recent || []
  const listeners = status?.listeners || []
  const sourceOptions = useMemo(
    () => [...new Set(recent.map((r) => r.source || 'unknown'))].sort((a, b) => a.localeCompare(b)),
    [recent],
  )
  const categoryOptions = useMemo(
    () => [...new Set(recent.map((r) => r.action || r.type || 'event'))].sort((a, b) => a.localeCompare(b)),
    [recent],
  )
  const statusOptions = useMemo(
    () => [...new Set(recent.map((r) => r.dir))].sort((a, b) => a.localeCompare(b)),
    [recent],
  )
  const shownRecent = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recent
      .filter((r) => !listenerFilter || (r.listenerId || `${r.source || 'unknown'}:${r.type || 'event'}`) === listenerFilter)
      .filter((r) => !sourceFilter || (r.source || 'unknown') === sourceFilter)
      .filter((r) => !categoryFilter || (r.action || r.type || 'event') === categoryFilter)
      .filter((r) => !statusFilter || r.dir === statusFilter)
      .filter((r) => !runsOnly || Boolean(r.runId))
      .filter((r) => {
        if (!q) return true
        return [r.title, r.listenerName, r.listenerId, r.source, r.type, r.action, r.result, r.error, r.repoRoot, r.file]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') return (a.processedAt || 0) - (b.processedAt || 0)
        if (sortBy === 'source') {
          const bySource = (a.source || 'unknown').localeCompare(b.source || 'unknown')
          return bySource || (b.processedAt || 0) - (a.processedAt || 0)
        }
        if (sortBy === 'category') {
          const byCategory = (a.action || a.type || 'event').localeCompare(b.action || b.type || 'event')
          return byCategory || (b.processedAt || 0) - (a.processedAt || 0)
        }
        return (b.processedAt || 0) - (a.processedAt || 0)
      })
  }, [categoryFilter, listenerFilter, recent, runsOnly, search, sortBy, sourceFilter, statusFilter])

  const rowKey = (r: (typeof recent)[number]) => `${r.dir}:${r.file}`
  const selected = shownRecent.find((r) => rowKey(r) === sel) || null

  return (
    <section className="relative flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <AutomationInfoBox />
      {msg && <div className="px-4 pt-2 text-[11px] text-[var(--gt-green)]">{msg}</div>}
      <div className="mt-3 flex min-h-0 flex-1 border-t border-[var(--gt-border)]">
        <div className="flex w-[58%] min-w-[420px] shrink-0 flex-col border-r border-[var(--gt-border)]">
          <div className="shrink-0 space-y-1.5 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-2.5">
            <div className="flex items-center gap-2">
              <Inbox size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <span className="text-[12px] font-semibold text-zinc-200">Automation Inbox</span>
              <span className="text-[10.5px] text-zinc-600">{status ? `${shownRecent.length} / ${recent.length}` : '...'}</span>
              <Badge tone={status?.enabled ? 'green' : 'mute'}>{status?.enabled ? 'watching' : 'paused'}</Badge>
              {counts && (
                <span className="inline-flex items-center gap-1.5 text-[10.5px]">
                  {counts.new > 0 && <Badge tone="blue">{counts.new} new</Badge>}
                  <Badge tone="green">{counts.done} done</Badge>
                  {counts.failed + counts['dead-letter'] > 0 && (
                    <Badge tone="red">{counts.failed + counts['dead-letter']} failed</Badge>
                  )}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={async () => {
                  if (!status) return
                  await window.gt.listeners.toggle(!status.enabled)
                  await onRefresh()
                  flash(`automation inbox ${status.enabled ? 'paused' : 'enabled'}`)
                }}
                className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                title={status?.enabled ? 'Pause automation inbox' : 'Enable automation inbox'}
              >
                {status?.enabled ? <Pause size={11} strokeWidth={2.5} /> : <Play size={11} strokeWidth={2.5} />}
              </button>
              <button
                onClick={async () => {
                  const r = await window.gt.listeners.process()
                  flash(`processed ${r.processed} · skipped ${r.skipped} · failed ${r.failed}`)
                  await onRefresh()
                }}
                className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                title="Process now"
              >
                <RefreshCw size={11} strokeWidth={2} />
              </button>
              <button
                onClick={() => window.gt.listeners.openDir()}
                className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                title="Open automation inbox folder"
              >
                <FolderOpen size={11} strokeWidth={2} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative min-w-[150px] flex-1">
                <Search size={11} strokeWidth={2} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search source / request / result..."
                  className="h-7 w-full rounded-md border border-[var(--gt-border)] bg-black/30 py-1 pl-7 pr-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
                />
              </div>
              <select
                value={listenerFilter}
                onChange={(e) => setListenerFilter(e.target.value)}
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
              >
                <option value="">All sources</option>
                {listeners.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name || l.id}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
              >
                <option value="">All sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
              >
                <option value="">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
              >
                <option value="">All statuses</option>
                {statusOptions.map((dir) => (
                  <option key={dir} value={dir}>
                    {dir}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="source">Source</option>
                <option value="category">Category</option>
              </select>
              <button
                onClick={() => setRunsOnly((v) => !v)}
                className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${
                  runsOnly
                    ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-300'
                }`}
              >
                Runs only
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!status ? (
              <div className="p-4 text-[12px] text-zinc-600">Loading automation inbox...</div>
            ) : status.recent.length === 0 ? (
              <div className="p-4 text-[12px] text-zinc-600">
                No automation requests yet. Use /automation-inbox for one-off requests or /new-inbox-source for setup.
              </div>
            ) : shownRecent.length === 0 ? (
              <div className="p-4 text-[12px] text-zinc-600">No automation requests match these filters.</div>
            ) : (
              shownRecent.map((r) => {
                const selectedHere = rowKey(r) === sel
                return (
                  <button
                    key={rowKey(r)}
                    onClick={() => setSel(rowKey(r))}
                    className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-2 text-left ${
                      selectedHere ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                    }`}
                  >
                    <Badge tone={inboxTone(r.dir)}>{r.dir}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">
                      {r.title || r.listenerName || r.type || r.file}
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">{r.listenerId || r.source || 'unknown'}</span>
                    {r.action && <span className="shrink-0 text-[10px] text-zinc-600">{r.action}</span>}
                    {r.runId && <Badge tone="blue">run</Badge>}
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{reltime(r.processedAt)}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-zinc-600">
              Pick an automation request on the left.
            </div>
          ) : (
            <>
              <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-2.5">
                <Badge tone={inboxTone(selected.dir)}>{selected.dir}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">
                  {selected.title || selected.listenerName || selected.type || selected.file}
                </span>
                <span className="font-mono text-[10.5px] text-zinc-600">{selected.source || 'unknown'}</span>
                {selected.action && <span className="text-[10.5px] text-zinc-500">{selected.action}</span>}
                <button
                  onClick={() => setSel(null)}
                  title="Close detail"
                  className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <div className="grid gap-2 text-[11.5px] md:grid-cols-2">
                  <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Source</div>
                    <div className="truncate text-zinc-200">{selected.listenerName || selected.listenerId || selected.source || 'unknown'}</div>
                    <div className="mt-1 truncate font-mono text-[10.5px] text-zinc-600">{selected.type || selected.file}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Outcome</div>
                    <div className={selected.error ? 'text-[var(--gt-red)]' : 'text-zinc-200'}>
                      {selected.result || selected.error || 'pending'}
                    </div>
                    <div className="mt-1 text-[10.5px] text-zinc-600">{fmtWhen(selected.processedAt)}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[11.5px]">
                  {selected.repoRoot && (
                    <div>
                      <span className="text-zinc-600">repo </span>
                      <span className="font-mono text-zinc-300">{selected.repoRoot}</span>
                    </div>
                  )}
                  {selected.id && (
                    <div>
                      <span className="text-zinc-600">event </span>
                      <span className="font-mono text-zinc-300">{selected.id}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-zinc-600">file </span>
                    <span className="font-mono text-zinc-300">{selected.file}</span>
                  </div>
                </div>
                {selected.runId && selected.runSource && (
                  <div className="mt-3 h-[min(46vh,420px)] overflow-hidden rounded-lg border border-[var(--gt-border)] bg-black/20">
                    <div className="flex items-center gap-2 border-b border-[var(--gt-border)]/50 px-3 py-2">
                      <ListChecks size={12} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                      <span className="text-[11.5px] font-semibold text-zinc-200">Run log</span>
                      <span className="font-mono text-[10px] text-zinc-600">{selected.runId}</span>
                    </div>
                    <RunLogPane source={selected.runSource} runId={selected.runId} className="h-[calc(100%-34px)]" />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
