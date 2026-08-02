import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  RefreshCw,
  Search,
  ArrowLeft,
  ExternalLink,
  Loader2,
  ListTree,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import type { CiRun, CiRunStatus, CiTabJob, TabContext } from '../../lib/types'
import { StatusIcon, isActive, formatDuration, reltime } from './ciShared'
import { LogView } from './logView'

type Filter = 'all' | 'running' | 'failed' | 'success' | 'other'

function matchesFilter(status: CiRunStatus, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'running':
      return isActive(status)
    case 'failed':
      return status === 'failed' || status === 'canceled'
    case 'success':
      return status === 'success'
    case 'other':
      return status === 'skipped'
  }
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'failed', label: 'Failed' },
  { id: 'success', label: 'Success' },
  { id: 'other', label: 'Other' },
]

// One workflow group's mini status summary: counts by tone.
function groupSummary(runs: CiRun[]) {
  let success = 0
  let failed = 0
  let running = 0
  for (const r of runs) {
    if (r.status === 'success') success++
    else if (r.status === 'failed' || r.status === 'canceled') failed++
    else if (isActive(r.status)) running++
  }
  return { success, failed, running }
}

function RunRow({
  run,
  selected,
  onClick,
}: {
  run: CiRun
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'hover:bg-white/5'
      }`}
    >
      <StatusIcon status={run.status} />
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-zinc-400">
        <GitBranch size={10} strokeWidth={2} className="shrink-0 text-zinc-600" />
        <span className="max-w-[9rem] truncate">{run.branch}</span>
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{run.shortSha}</span>
      <span className="shrink-0 rounded border border-[var(--gt-border)] px-1 py-[1px] text-[9px] uppercase tracking-wide text-zinc-500">
        {run.event}
      </span>
      <div className="flex-1" />
      {run.durationMs != null && (
        <span className="shrink-0 tabular-nums text-[9.5px] text-zinc-600">
          {formatDuration(run.durationMs)}
        </span>
      )}
      <span className="shrink-0 text-[9.5px] text-zinc-700">{reltime(run.createdAt)}</span>
    </button>
  )
}

function StepList({ steps }: { steps: NonNullable<CiTabJob['steps']> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ml-6 mt-0.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400"
      >
        {open ? (
          <ChevronDown size={10} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={10} strokeWidth={2.5} />
        )}
        {steps.length} step{steps.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-0.5 border-l border-[var(--gt-border)] pl-2">
          {steps.map((st) => (
            <div
              key={st.number}
              className="flex items-center gap-1.5 py-[1px] text-[10.5px] text-zinc-400"
            >
              <StatusIcon status={st.status} size={11} />
              <span className="tabular-nums text-zinc-700">{st.number}.</span>
              <span className="min-w-0 truncate">{st.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function JobsPane({
  ctx,
  run,
  onBack,
  selectedJobId,
  onSelectJob,
}: {
  ctx: TabContext
  run: CiRun
  onBack: () => void
  selectedJobId: string | null
  onSelectJob: (job: CiTabJob) => void
}) {
  const [jobs, setJobs] = useState<CiTabJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setJobs(null)
    setError(null)
    window.gt.ci
      .jobs(ctx.repoRoot, run.id)
      .then((r) => {
        if (!alive) return
        if (r.error) setError(r.error)
        else setJobs(r.jobs)
      })
      .catch((e) => alive && setError(String(e?.message || e)))
    return () => {
      alive = false
    }
  }, [ctx.repoRoot, run.id])

  // Group jobs by stage, preserving first-seen order.
  const stages = useMemo<[string, CiTabJob[]][]>(() => {
    if (!jobs) return []
    const map = new Map<string, CiTabJob[]>()
    for (const j of jobs) {
      const k = j.stage || 'jobs'
      const list = map.get(k) ?? []
      list.push(j)
      map.set(k, list)
    }
    return [...map.entries()]
  }, [jobs])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-2 py-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
        >
          <ArrowLeft size={12} strokeWidth={2.25} />
          Runs
        </button>
        <StatusIcon status={run.status} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-zinc-200">
          {run.name}
        </span>
        <button
          onClick={() => window.gt.openExternal(run.webUrl)}
          title="Open run on forge"
          className="shrink-0 text-zinc-600 hover:text-zinc-300"
        >
          <ExternalLink size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {jobs === null && !error ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-zinc-600">
            <Loader2 size={12} strokeWidth={2.25} className="animate-spin" />
            Loading jobs…
          </div>
        ) : error ? (
          <div className="m-1 rounded-md border border-[var(--gt-red)]/30 bg-[var(--gt-red)]/10 px-3 py-2 text-[11px] text-[var(--gt-red)]">
            {error}
          </div>
        ) : jobs && jobs.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-zinc-600">No jobs for this run.</div>
        ) : (
          stages.map(([stage, list]) => (
            <div key={stage} className="mb-3">
              <div className="mb-1 flex items-center gap-1.5 px-1.5">
                <ListTree size={10} strokeWidth={2.25} className="text-zinc-600" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {stage}
                </span>
                <span className="text-[9.5px] tabular-nums text-zinc-700">{list.length}</span>
              </div>
              {list.map((job) => {
                const on = job.id === selectedJobId
                return (
                  <div key={job.id}>
                    <button
                      onClick={() => onSelectJob(job)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        on ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'hover:bg-white/5'
                      }`}
                    >
                      <StatusIcon status={job.status} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                        {job.name}
                      </span>
                      {job.durationMs != null && (
                        <span className="shrink-0 tabular-nums text-[9.5px] text-zinc-600">
                          {formatDuration(job.durationMs)}
                        </span>
                      )}
                    </button>
                    {job.steps && job.steps.length > 0 && <StepList steps={job.steps} />}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function RunsView({ ctx }: { ctx: TabContext }) {
  const [runs, setRuns] = useState<CiRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedRun, setSelectedRun] = useState<CiRun | null>(null)
  const [selectedJob, setSelectedJob] = useState<CiTabJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true)
      try {
        const r = await window.gt.ci.list(ctx.repoRoot, 50)
        if (r.error) {
          setError(r.error)
          setRuns([])
        } else {
          setError(null)
          setRuns(r.runs)
        }
      } catch (e) {
        setError(String((e as Error)?.message || e))
        setRuns([])
      } finally {
        setRefreshing(false)
      }
    },
    [ctx.repoRoot],
  )

  // Initial + repo-switch load.
  useEffect(() => {
    setRuns(null)
    setSelectedRun(null)
    setSelectedJob(null)
    load({ silent: true })
  }, [ctx.repoRoot, load])

  // Poll every 20s while any run is active; stop when nothing is running.
  const anyActive = useMemo(() => (runs ?? []).some((r) => isActive(r.status)), [runs])
  useEffect(() => {
    if (!anyActive) return
    pollRef.current = setInterval(() => load({ silent: true }), 20_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [anyActive, load])

  const groups = useMemo<[string, CiRun[]][]>(() => {
    if (!runs) return []
    const q = query.trim().toLowerCase()
    const filtered = runs.filter((r) => {
      if (!matchesFilter(r.status, filter)) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.shortSha.toLowerCase().includes(q)
      )
    })
    const map = new Map<string, CiRun[]>()
    for (const r of filtered) {
      const list = map.get(r.name) ?? []
      list.push(r)
      map.set(r.name, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [runs, filter, query])

  const toggleGroup = (name: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })

  // Left column: jobs pane when a run is selected, else the run list.
  const leftColumn = selectedRun ? (
    <JobsPane
      ctx={ctx}
      run={selectedRun}
      onBack={() => {
        setSelectedRun(null)
        setSelectedJob(null)
      }}
      selectedJobId={selectedJob?.id ?? null}
      onSelectJob={setSelectedJob}
    />
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        <span className="text-[12px] font-semibold text-zinc-200">Runs</span>
        <span className="text-[11px] text-zinc-600">{runs?.length ?? 0}</span>
        <div className="flex-1" />
        <button
          onClick={() => load()}
          title="Refresh"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-white"
        >
          <RefreshCw size={11} strokeWidth={2.25} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--gt-border)] px-2 py-2">
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2">
          <Search size={12} strokeWidth={2} className="shrink-0 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by workflow, branch, sha…"
            className="w-full bg-transparent py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                filter === f.id
                  ? 'bg-[var(--gt-accent)]/20 text-[var(--gt-accent-light)]'
                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs === null ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-zinc-600">
            <Loader2 size={12} strokeWidth={2.25} className="animate-spin" />
            Loading runs…
          </div>
        ) : error ? (
          <div className="m-1 rounded-md border border-[var(--gt-red)]/30 bg-[var(--gt-red)]/10 px-3 py-2 text-[11px] leading-relaxed text-[var(--gt-red)]">
            {error}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-zinc-600">
            {runs.length === 0 ? 'No CI runs found for this repo.' : 'No runs match this filter.'}
          </div>
        ) : (
          groups.map(([name, list]) => {
            const isCollapsed = collapsed.has(name)
            const sum = groupSummary(list)
            return (
              <div key={name} className="mb-3">
                <button
                  onClick={() => toggleGroup(name)}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
                >
                  {isCollapsed ? (
                    <ChevronRight size={11} strokeWidth={2.5} className="shrink-0 text-zinc-600" />
                  ) : (
                    <ChevronDown size={11} strokeWidth={2.5} className="shrink-0 text-zinc-600" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                    {name}
                  </span>
                  {sum.running > 0 && <Badge tone="blue">{sum.running}</Badge>}
                  {sum.failed > 0 && <Badge tone="red">{sum.failed}</Badge>}
                  {sum.success > 0 && <Badge tone="green">{sum.success}</Badge>}
                </button>
                {!isCollapsed &&
                  list.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      selected={false}
                      onClick={() => {
                        setSelectedRun(run)
                        setSelectedJob(null)
                      }}
                    />
                  ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 bg-[var(--gt-bg)]">
      <aside className="flex w-[26rem] shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]">
        {leftColumn}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedJob ? (
          <LogView
            repoRoot={ctx.repoRoot}
            job={selectedJob}
            forgeLabel={ctx.repoHost || ctx.forgeKind}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[12px] text-zinc-600">
            <ListTree size={28} strokeWidth={1.5} className="mb-3 text-zinc-700" />
            <div className="max-w-sm">
              {selectedRun
                ? 'Pick a job to view its formatted log — sections fold, errors and warnings are highlighted.'
                : 'Select a run on the left to see its jobs, then a job to read its log.'}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
