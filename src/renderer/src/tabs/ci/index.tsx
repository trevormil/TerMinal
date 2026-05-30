import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GitMerge,
  RefreshCw,
  CheckCircle2,
  XCircle,
  CircleDashed,
  CircleSlash,
  Loader2,
  ExternalLink,
  GitBranch,
  ChevronRight,
  ChevronDown,
  FileText,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import { sanitizeLog } from '../../lib/sanitizeLog'
import type { Tab, TabContext, CiRun, CiTabJob, CiRunStatus } from '../../lib/types'

function fmtRelative(ts: number): string {
  if (!ts) return '—'
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

const STATUS_META: Record<
  CiRunStatus,
  { label: string; tone: 'green' | 'red' | 'blue' | 'yellow' | 'mute'; Icon: typeof CheckCircle2 }
> = {
  success: { label: 'success', tone: 'green', Icon: CheckCircle2 },
  failed: { label: 'failed', tone: 'red', Icon: XCircle },
  in_progress: { label: 'running', tone: 'blue', Icon: Loader2 },
  queued: { label: 'queued', tone: 'yellow', Icon: CircleDashed },
  pending: { label: 'pending', tone: 'yellow', Icon: CircleDashed },
  canceled: { label: 'canceled', tone: 'mute', Icon: CircleSlash },
  skipped: { label: 'skipped', tone: 'mute', Icon: CircleSlash },
}

type Filter = 'all' | 'running' | 'failed' | 'success' | 'other'

function bucket(s: CiRunStatus): Filter {
  if (s === 'in_progress' || s === 'queued' || s === 'pending') return 'running'
  if (s === 'failed') return 'failed'
  if (s === 'success') return 'success'
  return 'other'
}

function CiTab({ ctx }: { ctx: TabContext }) {
  const [runs, setRuns] = useState<CiRun[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selRunId, setSelRunId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<CiTabJob[] | null>(null)
  const [jobsError, setJobsError] = useState<string | undefined>()
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [busy, setBusy] = useState(false)
  const cli = ctx.forgeKind === 'github' ? 'gh' : 'glab'
  const platform = ctx.forgeKind === 'github' ? 'GitHub Actions' : 'GitLab CI'
  const ranLabel = ctx.forgeKind === 'github' ? 'workflow' : 'pipeline'

  async function load(showBusy = false) {
    if (showBusy) setBusy(true)
    try {
      const r = await window.gt.ci.list(50)
      setRuns(r.runs || [])
      setError(r.error)
    } catch (e: any) {
      setError(e?.message || 'failed to load')
      setRuns([])
    } finally {
      if (showBusy) setBusy(false)
    }
  }

  // Initial load + 30s auto-refresh while the tab is mounted
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.sessionId, ctx.repoPath])

  // Lazy-load jobs when a row is opened
  useEffect(() => {
    if (!selRunId) {
      setJobs(null)
      setJobsError(undefined)
      return
    }
    let cancelled = false
    setLoadingJobs(true)
    setJobs(null)
    setJobsError(undefined)
    window.gt.ci
      .jobs(selRunId)
      .then((r) => {
        if (cancelled) return
        setJobs(r.jobs || [])
        setJobsError(r.error)
      })
      .catch((e: any) => {
        if (cancelled) return
        setJobsError(e?.message || 'failed to load jobs')
        setJobs([])
      })
      .finally(() => {
        if (!cancelled) setLoadingJobs(false)
      })
    return () => {
      cancelled = true
    }
  }, [selRunId])

  const filtered = useMemo(() => {
    if (!runs) return null
    const q = query.trim().toLowerCase()
    return runs.filter((r) => {
      if (filter !== 'all' && bucket(r.status) !== filter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.shortSha.includes(q) ||
        r.event.toLowerCase().includes(q)
      )
    })
  }, [runs, filter, query])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, running: 0, failed: 0, success: 0, other: 0 }
    for (const r of runs || []) {
      c.all++
      c[bucket(r.status)]++
    }
    return c
  }, [runs])

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* ━━ LEFT: run list ━━ */}
      <aside className="flex w-[55%] min-w-[420px] flex-col border-r border-[var(--gt-border)]">
        {/* header */}
        <div className="shrink-0 border-b border-[var(--gt-border)] px-3 py-2">
          <div className="flex items-center gap-2">
            <GitMerge size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
            <h2 className="text-[13px] font-bold text-zinc-100">CI</h2>
            <span className="text-[11px] text-zinc-600">· {platform}</span>
            <span className="text-[11px] text-zinc-600">· {ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}</span>
            <div className="flex-1" />
            <button
              onClick={() => load(true)}
              disabled={busy}
              title="Refresh"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 disabled:opacity-50"
            >
              <RefreshCw size={11} strokeWidth={2} className={busy ? 'gt-spin' : ''} />
              Refresh
            </button>
          </div>
          {/* filters */}
          <div className="mt-2 flex items-center gap-1">
            {(['all', 'running', 'failed', 'success', 'other'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-0.5 text-[10.5px] ${
                  filter === f
                    ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f} <span className="text-zinc-600">· {counts[f]}</span>
              </button>
            ))}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter by name / branch / sha"
              className="ml-2 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {runs === null ? (
            <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
          ) : error ? (
            <div className="space-y-1 p-3 text-[11.5px]">
              <div className="text-[var(--gt-yellow)]">{error}</div>
              <div className="text-zinc-600">
                Make sure <span className="font-mono">{cli}</span> is installed + authenticated for this host.
              </div>
            </div>
          ) : filtered && filtered.length === 0 ? (
            <div className="p-3 text-[11.5px] text-zinc-600">
              No {ranLabel} runs match.
              {(runs || []).length === 0 && (
                <> The forge returned no runs (recently inactive repo or fresh remote).</>
              )}
            </div>
          ) : (
            (filtered || []).map((r) => {
              const meta = STATUS_META[r.status]
              const on = selRunId === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => setSelRunId(on ? null : r.id)}
                  className={`flex w-full items-start gap-2 border-b border-[var(--gt-border)]/40 px-2.5 py-1.5 text-left ${
                    on ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                  }`}
                  title={`${meta.label} · ${r.event}`}
                >
                  <meta.Icon
                    size={13}
                    strokeWidth={2}
                    className={`mt-0.5 shrink-0 ${
                      meta.tone === 'green'
                        ? 'text-[var(--gt-green)]'
                        : meta.tone === 'red'
                          ? 'text-[var(--gt-red)]'
                          : meta.tone === 'blue'
                            ? 'text-[var(--gt-accent-light)] gt-spin'
                            : meta.tone === 'yellow'
                              ? 'text-[var(--gt-yellow)]'
                              : 'text-zinc-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">
                        {r.name || `${ranLabel} ${r.id}`}
                      </span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-zinc-500">
                      <span className="inline-flex items-center gap-0.5">
                        <GitBranch size={9} strokeWidth={2} />
                        <span className="truncate">{r.branch || '—'}</span>
                      </span>
                      {r.shortSha && (
                        <span className="font-mono text-zinc-600">{r.shortSha}</span>
                      )}
                      <span className="text-zinc-600">{r.event || '—'}</span>
                      <span className="ml-auto text-zinc-600">{fmtRelative(r.createdAt)} ago · {fmtDuration(r.durationMs)}</span>
                    </div>
                  </div>
                  {on ? (
                    <ChevronDown size={12} strokeWidth={2} className="mt-1 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight size={12} strokeWidth={2} className="mt-1 shrink-0 text-zinc-500" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* ━━ RIGHT: selected-run jobs ━━ */}
      <section className="flex min-w-0 flex-1 flex-col">
        {(() => {
          const sel = (runs || []).find((r) => r.id === selRunId)
          if (!sel)
            return (
              <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                Pick a {ranLabel} run on the left.
              </div>
            )
          const meta = STATUS_META[sel.status]
          return (
            <>
              <header className="shrink-0 border-b border-[var(--gt-border)] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <meta.Icon
                    size={15}
                    strokeWidth={2}
                    className={
                      meta.tone === 'green'
                        ? 'text-[var(--gt-green)]'
                        : meta.tone === 'red'
                          ? 'text-[var(--gt-red)]'
                          : meta.tone === 'blue'
                            ? 'text-[var(--gt-accent-light)] gt-spin'
                            : meta.tone === 'yellow'
                              ? 'text-[var(--gt-yellow)]'
                              : 'text-zinc-500'
                    }
                  />
                  <h2 className="text-[13px] font-bold text-zinc-100">{sel.name || `${ranLabel} ${sel.id}`}</h2>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="flex-1" />
                  {sel.webUrl && (
                    <button
                      onClick={() => window.gt.openExternal(sel.webUrl)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
                      title="Open on forge"
                    >
                      <ExternalLink size={11} strokeWidth={2} />
                      Open
                    </button>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10.5px] text-zinc-500">
                  <span className="inline-flex items-center gap-0.5">
                    <GitBranch size={10} strokeWidth={2} />
                    {sel.branch || '—'}
                  </span>
                  {sel.shortSha && <span className="font-mono text-zinc-600">{sel.shortSha}</span>}
                  <span>{sel.event || '—'}</span>
                  <span className="ml-auto">
                    {fmtRelative(sel.createdAt)} ago · {fmtDuration(sel.durationMs)}
                  </span>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loadingJobs ? (
                  <div className="p-3 text-[12px] text-zinc-600">Loading jobs…</div>
                ) : jobsError ? (
                  <div className="space-y-1 p-3 text-[11.5px]">
                    <div className="text-[var(--gt-yellow)]">{jobsError}</div>
                  </div>
                ) : jobs && jobs.length === 0 ? (
                  <div className="p-3 text-[11.5px] text-zinc-600">No jobs for this run.</div>
                ) : (
                  // Group by stage (gh has no stages → single bucket; glab has real stages)
                  groupByStage(jobs || []).map(([stage, list]) => (
                    <div key={stage || '_'} className="border-b border-[var(--gt-border)]/40">
                      {stage && (
                        <div className="bg-black/20 px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
                          {stage}
                        </div>
                      )}
                      {list.map((j) => (
                        <JobRow key={j.id} job={j} />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )
        })()}
      </section>
    </div>
  )
}

function groupByStage(jobs: CiTabJob[]): [string, CiTabJob[]][] {
  const map = new Map<string, CiTabJob[]>()
  for (const j of jobs) {
    const arr = map.get(j.stage) || []
    arr.push(j)
    map.set(j.stage, arr)
  }
  return Array.from(map.entries())
}

function statusIconClass(tone: string): string {
  if (tone === 'green') return 'text-[var(--gt-green)]'
  if (tone === 'red') return 'text-[var(--gt-red)]'
  if (tone === 'blue') return 'text-[var(--gt-accent-light)] gt-spin'
  if (tone === 'yellow') return 'text-[var(--gt-yellow)]'
  return 'text-zinc-500'
}

function JobRow({ job }: { job: CiTabJob }) {
  const jm = STATUS_META[job.status]
  const [expanded, setExpanded] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  const [logErr, setLogErr] = useState<string | undefined>()
  const [loadingLog, setLoadingLog] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const hasSteps = !!(job.steps && job.steps.length)

  async function loadLog() {
    if (loadingLog) return
    setLoadingLog(true)
    setLogErr(undefined)
    try {
      const r = await window.gt.ci.log(job.id)
      setLog(r.log)
      setLogErr(r.error)
      setTruncated(!!r.truncated)
      // Auto-scroll to end (failure context usually at the bottom)
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
      })
    } catch (e: any) {
      setLogErr(e?.message || 'failed to load log')
    } finally {
      setLoadingLog(false)
    }
  }

  // Auto-open expand for failed jobs (the operator almost always wants the log)
  useEffect(() => {
    if (job.status === 'failed' && !expanded) setExpanded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])

  return (
    <div className="border-b border-[var(--gt-border)]/30">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded-sm p-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
        </button>
        <jm.Icon size={12} strokeWidth={2} className={statusIconClass(jm.tone)} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-100">{job.name}</span>
        <span className="text-[10.5px] text-zinc-500">{fmtDuration(job.durationMs)}</span>
        <Badge tone={jm.tone}>{jm.label}</Badge>
        {job.webUrl && (
          <button
            onClick={() => window.gt.openExternal(job.webUrl)}
            title="Open job on forge"
            className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          >
            <ExternalLink size={10} strokeWidth={2} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-[var(--gt-border)]/30 bg-black/10 px-4 py-2">
          {hasSteps && (
            <ol className="mb-2 space-y-0.5">
              {job.steps!.map((s) => {
                const sm = STATUS_META[s.status]
                return (
                  <li key={s.number} className="flex items-center gap-1.5 text-[11px]">
                    <sm.Icon size={10} strokeWidth={2} className={statusIconClass(sm.tone)} />
                    <span className="text-zinc-600">{s.number}.</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{s.name}</span>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={loadLog}
              disabled={loadingLog}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:bg-white/5 disabled:opacity-50"
            >
              <FileText size={10} strokeWidth={2} />
              {log === null ? (loadingLog ? 'Loading log…' : 'Show log') : 'Reload log'}
            </button>
            {truncated && (
              <span className="text-[10px] text-[var(--gt-yellow)]" title="Head trimmed; tail preserved (failure context).">
                truncated · last 1MB
              </span>
            )}
            {logErr && <span className="text-[10px] text-[var(--gt-yellow)]">{logErr}</span>}
          </div>
          {log !== null && !logErr && (
            <pre
              ref={logRef}
              className="mt-2 max-h-[400px] overflow-auto whitespace-pre rounded-md border border-[var(--gt-border)] bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-zinc-300"
            >
              {sanitizeLog(log) || '(empty)'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'ci',
  title: 'CI',
  icon: GitMerge,
  order: 3.55, // after Agents (3) → Runs (3.45) → Schedules (3.5) cluster
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: ({ ctx }) => <CiTab ctx={ctx} />,
}

export default tab
