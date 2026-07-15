import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Inbox,
  ListChecks,
  RefreshCw,
  FolderOpen,
  X,
  Play,
  StopCircle,
  Trash2,
  Server,
  FileText,
} from 'lucide-react'
import { Badge, ForceChip } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import { EngineLogo } from '../../components/EngineLogo'
import { navigateTo, onNavigate } from '../../lib/nav'
import { engineLabel } from '../../lib/engines'
import type { Tab, TabContext, UnifiedRun, RunArtifact, RunTrendPoint } from '../../lib/types'
import { RunLogPane } from './RunLogPane'
import { AutomationInboxView } from './AutomationInboxView'
import { RunEvaluationPanel } from '../../components/RunEvaluationPanel'

// One global view across every run TerMinal has fired — cron (launchd, via
// bin/terminal-cron) AND in-process (Run button on Agents/Tickets/PRs). The
// per-agent and per-schedule run views in Agents / Schedules stay as scoped
// drill-downs; this tab is the unified picture.

const statusTone = (s: string): BadgeTone =>
  s === 'done' || s === 'pass'
    ? 'green'
    : s === 'failed' || s === 'fail'
      ? 'red'
      : s === 'running'
        ? 'blue'
        : s === 'canceled' || s === 'interrupted'
          ? 'yellow'
          : 'mute'

const sourceTone = (s: UnifiedRun['source']): BadgeTone =>
  s === 'cron' ? 'accent' : s === 'bg' ? 'yellow' : s === 'session' ? 'green' : 'blue'

function fmtWhen(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`
}
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}
const repoOf = (root: string) => root.split('/').filter(Boolean).pop() || root
const RUNS_REPO_FILTER_KEY = 'gt.runs.repoFilter'

function RunsTab({ ctx }: { ctx: TabContext }) {
  const [view, setView] = useState<'runs' | 'inbox'>('runs')
  // Local and remote runs are fetched separately (local is cheap + pollable;
  // remote is an SSH fan-out) then merged into one list so the operator sees
  // both without switching the session's daemon profile.
  const [localRuns, setLocalRuns] = useState<UnifiedRun[] | null>(null)
  const [remoteRuns, setRemoteRuns] = useState<UnifiedRun[]>([])
  const [remoteErrors, setRemoteErrors] = useState<
    { hostId: string; label: string; error: string }[]
  >([])
  const [source, setSource] = useState<'all' | UnifiedRun['source']>('all')
  const [host, setHost] = useState<string>('all') // 'all' | 'local' | hostId
  const [status, setStatus] = useState<string>('all')
  const [repo, setRepo] = useState(() => localStorage.getItem(RUNS_REPO_FILTER_KEY) ?? '__auto__')
  const [agentFilter, setAgentFilter] = useState('')
  const [engineFilter, setEngineFilter] = useState('')
  const [forceFilter, setForceFilter] = useState<'all' | 'force' | 'normal'>('all')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [rerunBusy, setRerunBusy] = useState(false)
  const [rerunError, setRerunError] = useState('')

  // Runs are fire-and-forget processes only (cron/agent/bg) — interactive
  // terminal sessions belong to the Terminal tab, not here.
  const reloadLocal = () =>
    window.gt.agents.allRuns().then((rs) => setLocalRuns(rs.filter((r) => r.source !== 'session')))
  // Remote is an SSH fan-out across every configured host — best-effort, and
  // guarded so overlapping slow SSH calls don't stack up.
  const remoteInFlight = useRef(false)
  const reloadRemote = async () => {
    if (remoteInFlight.current) return
    remoteInFlight.current = true
    try {
      const { runs, errors } = await window.gt.agents.remoteAllRuns()
      setRemoteRuns(runs.filter((r) => r.source !== 'session'))
      setRemoteErrors(errors)
    } catch {
      /* leave prior remote state in place on a transient failure */
    } finally {
      remoteInFlight.current = false
    }
  }
  const reload = async () => {
    await Promise.all([reloadLocal(), reloadRemote()])
  }
  const runs = useMemo(
    () =>
      localRuns === null
        ? null
        : [...localRuns, ...remoteRuns].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
    [localRuns, remoteRuns],
  )
  // Latest merged list, read by the polling interval so its callback never
  // closes over a stale (null) snapshot — the reason auto-refresh was dead.
  const runsRef = useRef<UnifiedRun[] | null>(null)
  runsRef.current = runs
  // Cost per runId from the AI ledger — joined into each row so the operator
  // sees "this run cost $X" without flipping tabs.
  const [costByRunId, setCostByRunId] = useState<Map<string, number>>(new Map())
  // 14-day success-rate / duration trend (#6) — GitHub Insights equivalent.
  const [trends, setTrends] = useState<RunTrendPoint[]>([])
  const reloadCosts = async () => {
    try {
      const ai = await window.gt.observability.runs(500)
      const m = new Map<string, number>()
      for (const a of ai) if (a.runId) m.set(a.runId, (m.get(a.runId) || 0) + a.costUsd)
      setCostByRunId(m)
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    reloadLocal()
    reloadRemote()
    reloadCosts()
    window.gt.agents
      .runTrends(14)
      .then(setTrends)
      .catch(() => {})
    // Always refresh local + costs (cheap local IPC). Gating local refresh on
    // "something is already running" latched the poll OFF whenever the snapshot
    // was all-idle, so a run STARTED while idle (a cron firing, an agent launched
    // from another tab) never appeared and never flipped to done. Only the SSH
    // remote fan-out stays gated — on a running REMOTE run — so idle hosts aren't
    // polled over SSH every 2s.
    const t = setInterval(() => {
      reloadLocal()
      const cur = runsRef.current
      if (cur && cur.some((r) => r.status === 'running' && r.hostId)) reloadRemote()
      reloadCosts()
    }, 2000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtUsd = (n: number) => {
    if (n >= 10) return `$${n.toFixed(2)}`
    if (n >= 0.01) return `$${n.toFixed(3).replace(/0$/, '')}`
    if (n > 0) return `$${n.toFixed(4)}`
    return '—'
  }

  // Cross-tab nav: when another tab calls navigateTo('runs', { runId }) we
  // pre-select that run + scroll the list to it.
  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId !== 'runs') return
        const runId = (ev.payload?.runId as string) || ''
        if (runId) setSel(runId)
      }),
    [],
  )

  const activeRepoLabel = ctx.repoPath || repoOf(ctx.repoRoot || ctx.cwd || '')
  // Filter chip options derived from loaded data — always include the current
  // repo so the auto-scoped default has a matching dropdown entry even with 0 runs.
  const repoOptions = useMemo(() => {
    const set = new Set((runs || []).map((r) => r.repoLabel).filter(Boolean))
    if (activeRepoLabel) set.add(activeRepoLabel)
    return [...set].sort()
  }, [runs, activeRepoLabel])
  // Default to the current repo whenever we're in one — even before it has any
  // runs — instead of falling back to "all repos". Manual picks (incl. "all
  // repos") persist via setRepoFilter and win over this.
  useEffect(() => {
    if (repo !== '__auto__' || !ctx.repoRoot || !activeRepoLabel) return
    setRepo(activeRepoLabel)
  }, [activeRepoLabel, repo, ctx.repoRoot])
  const setRepoFilter = (value: string) => {
    localStorage.setItem(RUNS_REPO_FILTER_KEY, value)
    setRepo(value)
  }
  const agentOptions = useMemo(() => {
    if (!runs) return []
    return [...new Set(runs.map((r) => r.agentId))].sort()
  }, [runs])
  const statusOptions = useMemo(() => {
    if (!runs) return []
    return [...new Set(runs.map((r) => r.status))].sort()
  }, [runs])
  const engineOptions = useMemo(() => {
    if (!runs) return []
    return [...new Set(runs.map((r) => r.engine).filter(Boolean))].sort()
  }, [runs])
  // Host chips: 'local' plus every host that has runs. Options are {value,label}
  // because a host's value is its id but we show its friendly label.
  const hostOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of remoteRuns) if (r.hostId) map.set(r.hostId, r.hostLabel || r.hostId)
    for (const e of remoteErrors) if (!map.has(e.hostId)) map.set(e.hostId, e.label)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [remoteRuns, remoteErrors])
  const hasRemoteHosts = hostOptions.length > 0
  const filtersActive =
    source !== 'all' ||
    host !== 'all' ||
    status !== 'all' ||
    (repo !== '__auto__' && !!repo) ||
    !!agentFilter ||
    !!engineFilter ||
    forceFilter !== 'all' ||
    !!search.trim()

  const filtered = useMemo(() => {
    if (!runs) return null
    const q = search.trim().toLowerCase()
    return runs.filter((r) => {
      if (source !== 'all' && r.source !== source) return false
      if (host === 'local' && r.hostId) return false
      if (host !== 'all' && host !== 'local' && r.hostId !== host) return false
      if (status !== 'all' && r.status !== status) return false
      if (repo !== '__auto__' && repo && r.repoLabel !== repo) return false
      if (agentFilter && r.agentId !== agentFilter) return false
      if (engineFilter && r.engine !== engineFilter) return false
      if (forceFilter === 'force' && !r.force) return false
      if (forceFilter === 'normal' && r.force) return false
      if (!q) return true
      return (
        r.agentTitle.toLowerCase().includes(q) ||
        r.agentId.toLowerCase().includes(q) ||
        r.engine.toLowerCase().includes(q) ||
        r.repoLabel.toLowerCase().includes(q) ||
        r.worktree.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      )
    })
  }, [runs, source, host, status, repo, agentFilter, engineFilter, forceFilter, search])

  const selectedRun = (runs || []).find((r) => r.id === sel) || null

  // Artifacts the selected run's repo produced (#8). Local runs only — a remote
  // run's artifacts live on its host. Fetched on selection; cheap local glob.
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([])
  useEffect(() => {
    setArtifacts([])
    if (!selectedRun || selectedRun.hostId || !selectedRun.repoRoot) return
    let alive = true
    window.gt.agents.runArtifacts(selectedRun.repoRoot).then((a) => {
      if (alive) setArtifacts(a)
    })
    return () => {
      alive = false
    }
  }, [selectedRun?.id, selectedRun?.repoRoot, selectedRun?.hostId])

  // Re-run: cron runs route to schedules.runNow (re-fires the launchd schedule
  // so the run gets all the same env vars + log path); in-process runs route
  // through main so they re-use the original repo + saved run provenance.
  const handleRerun = async (run: UnifiedRun) => {
    setRerunBusy(true)
    setRerunError('')
    try {
      if (run.source === 'cron' && run.scheduleId) {
        // Re-run on the owning host (systemd/k8s fleet) when remote, else local.
        const r = await window.gt.schedules.runNow(run.scheduleId, run.hostId)
        if (r && 'error' in r) {
          setRerunError(r.error)
          return
        }
      } else if (run.source === 'agent') {
        const r = await window.gt.agents.rerun(run.id)
        if ('error' in r) {
          setRerunError(r.error)
          return
        }
      } else {
        setRerunError('This run source cannot be re-run from here yet.')
        return
      }
      await reload()
    } finally {
      setRerunBusy(false)
    }
  }

  const counts = useMemo(() => {
    if (!runs) return { running: 0, done: 0, failed: 0 }
    return {
      running: runs.filter((r) => r.status === 'running').length,
      done: runs.filter((r) => r.status === 'done').length,
      failed: runs.filter((r) => r.status === 'failed').length,
    }
  }, [runs])

  const FilterSelect = ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string
    onChange: (v: string) => void
    options: string[]
    placeholder: string
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <ListChecks size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
        <span className="text-[12px] font-semibold text-zinc-200">Runs</span>
        <div className="ml-1 inline-flex rounded-lg border border-[var(--gt-border)] bg-black/20 p-0.5">
          <button
            onClick={() => setView('runs')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${
              view === 'runs'
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <ListChecks size={10} strokeWidth={2} />
            Runs
          </button>
          <button
            onClick={() => setView('inbox')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${
              view === 'inbox'
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Inbox size={10} strokeWidth={2} />
            Automation Inbox
          </button>
        </div>
      </div>

      {view === 'inbox' ? (
        <AutomationInboxView ctx={ctx} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* List */}
          <div className="flex w-[58%] min-w-[420px] shrink-0 flex-col border-r border-[var(--gt-border)]">
            {/* Header */}
            <div className="shrink-0 space-y-1.5 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-2.5">
              <div className="flex items-center gap-2">
                <ListChecks size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                <span className="text-[12px] font-semibold text-zinc-200">All runs</span>
                <span className="text-[10.5px] text-zinc-600">
                  {filtered ? `${filtered.length} / ${runs?.length || 0}` : '…'}
                </span>
                <span className="ml-2 inline-flex items-center gap-1.5 text-[10.5px]">
                  {counts.running > 0 && (
                    <Badge tone="blue">
                      <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-current gt-pulse" />
                      {counts.running} running
                    </Badge>
                  )}
                  <Badge tone="green">{counts.done} done</Badge>
                  {counts.failed > 0 && <Badge tone="red">{counts.failed} failed</Badge>}
                </span>
                <div className="flex-1" />
                <button
                  onClick={reload}
                  title="Reload runs"
                  className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                >
                  <RefreshCw size={11} strokeWidth={2} />
                </button>
              </div>
              {/* 14-day trend strip (#6): one cell per day, height ∝ volume, color by
              success rate. Hover for the numbers. A quick "is the factory healthy?" */}
              {trends.some((d) => d.total > 0) && (
                <div className="flex items-end gap-[3px]" title="Run success rate — last 14 days">
                  {trends.map((d) => {
                    const rate = d.succeeded + d.failed > 0 ? d.successRate : null
                    const h =
                      d.total === 0 ? 3 : 4 + Math.min(16, Math.round(Math.log2(d.total + 1) * 6))
                    const color =
                      rate === null
                        ? 'var(--gt-border)'
                        : rate >= 0.99
                          ? 'var(--gt-green)'
                          : rate >= 0.75
                            ? '#d4a017'
                            : 'var(--gt-red)'
                    return (
                      <div
                        key={d.date}
                        style={{
                          height: h,
                          backgroundColor: color,
                          opacity: d.total === 0 ? 0.35 : 0.85,
                        }}
                        className="w-[7px] rounded-[1.5px]"
                        title={`${d.date} · ${d.total} run${d.total === 1 ? '' : 's'}${
                          d.succeeded + d.failed > 0
                            ? ` · ${Math.round(d.successRate * 100)}% ok`
                            : ''
                        }${d.avgDurationMs ? ` · ~${fmtDuration(d.avgDurationMs)}` : ''}`}
                      />
                    )
                  })}
                  <span className="ml-1.5 text-[9.5px] text-zinc-600">14d</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search agent / branch / id…"
                  className="min-w-[140px] flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
                />
                <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
                  {(['all', 'cron', 'agent', 'bg'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSource(s)}
                      className={`rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${
                        source === s
                          ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {hasRemoteHosts && (
                  <select
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    title="Filter by machine (local or a remote SSH host)"
                    className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
                  >
                    <option value="all">all hosts</option>
                    <option value="local">Local</option>
                    {hostOptions.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                <FilterSelect
                  value={status}
                  onChange={(v) => setStatus(v || 'all')}
                  options={statusOptions}
                  placeholder="all status"
                />
                <FilterSelect
                  value={repo === '__auto__' ? '' : repo}
                  onChange={setRepoFilter}
                  options={repoOptions}
                  placeholder="all repos"
                />
                <FilterSelect
                  value={agentFilter}
                  onChange={setAgentFilter}
                  options={agentOptions}
                  placeholder="all agents"
                />
                <FilterSelect
                  value={engineFilter}
                  onChange={setEngineFilter}
                  options={engineOptions}
                  placeholder="all engines"
                />
                <select
                  value={forceFilter}
                  onChange={(e) => setForceFilter(e.target.value as typeof forceFilter)}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none"
                >
                  <option value="all">all modes</option>
                  <option value="force">force only</option>
                  <option value="normal">normal only</option>
                </select>
                {filtersActive && (
                  <button
                    onClick={() => {
                      setSource('all')
                      setHost('all')
                      setStatus('all')
                      setRepoFilter('')
                      setAgentFilter('')
                      setEngineFilter('')
                      setForceFilter('all')
                      setSearch('')
                    }}
                    className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10.5px] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Remote hosts that didn't answer this fetch — surfaced so an empty
            remote list reads as "host unreachable", not "no runs". */}
            {remoteErrors.length > 0 && (
              <div className="shrink-0 border-b border-[var(--gt-yellow)]/30 bg-[var(--gt-yellow)]/10 px-3 py-1 text-[10.5px] text-[var(--gt-yellow)]">
                {remoteErrors.map((e) => (
                  <div key={e.hostId} className="truncate" title={e.error}>
                    <Server size={9} strokeWidth={2} className="mr-1 inline" />
                    {e.label}: {e.error}
                  </div>
                ))}
              </div>
            )}

            {/* Rows */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {runs === null ? (
                <div className="p-4 text-[12px] text-zinc-600">Loading runs…</div>
              ) : filtered && filtered.length === 0 ? (
                <div className="p-4 text-[12px] text-zinc-600">No runs match these filters.</div>
              ) : (
                (filtered || []).map((r) => {
                  const dur = r.endedAt
                    ? fmtDuration(r.endedAt - r.startedAt)
                    : r.status === 'running'
                      ? 'running…'
                      : '—'
                  const selectedHere = sel === r.id
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSel(r.id)}
                      className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-2 text-left ${
                        selectedHere ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                      }`}
                    >
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      <Badge tone={sourceTone(r.source)}>{r.source}</Badge>
                      {r.hostId && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-1 py-0.5 text-[9px] text-[var(--gt-accent-light)]"
                          title={`Remote host: ${r.hostLabel || r.hostId}`}
                        >
                          <Server size={8} strokeWidth={2} />
                          {r.hostLabel || r.hostId}
                        </span>
                      )}
                      {r.force && <ForceChip />}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">
                        {r.agentTitle}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">
                        {r.repoLabel}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] uppercase text-zinc-600">
                        <EngineLogo engine={r.engine} size={10} />
                        {engineLabel(r.engine)}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-[10px] text-zinc-500">
                        {dur}
                      </span>
                      <span
                        className="w-14 shrink-0 text-right font-mono tabular-nums text-[10px] text-[var(--gt-accent-light)]"
                        title={
                          r.costUsd != null
                            ? 'Cost reported by or-agent (OpenRouter)'
                            : 'Cost from the AI fleet ledger (joined by runId)'
                        }
                      >
                        {fmtUsd(r.costUsd ?? costByRunId.get(r.id) ?? 0)}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                        {fmtWhen(r.startedAt)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Detail */}
          <section className="flex min-w-0 flex-1 flex-col">
            {!selectedRun ? (
              <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                Pick a run on the left.
              </div>
            ) : (
              <>
                <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-2.5">
                  <Badge tone={statusTone(selectedRun.status)}>{selectedRun.status}</Badge>
                  <Badge tone={sourceTone(selectedRun.source)}>{selectedRun.source}</Badge>
                  {selectedRun.force && <ForceChip size="md" />}
                  <span className="text-[13px] font-semibold text-zinc-100">
                    {selectedRun.agentTitle}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase text-zinc-600">
                    <EngineLogo engine={selectedRun.engine} size={11} />
                    {engineLabel(selectedRun.engine)}
                  </span>
                  <span className="font-mono text-[10.5px] text-zinc-600">
                    {selectedRun.branch}
                  </span>
                  {selectedRun.exitCode != null && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        selectedRun.exitCode === 0
                          ? 'border-[var(--gt-green)]/40 text-[var(--gt-green)]'
                          : 'border-[var(--gt-red)]/40 text-[var(--gt-red)]'
                      }`}
                      title="Process exit code"
                    >
                      exit {selectedRun.exitCode}
                    </span>
                  )}
                  {selectedRun.hostId && (
                    <span
                      className="inline-flex items-center gap-1 rounded border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--gt-accent-light)]"
                      title={`Remote host: ${selectedRun.hostLabel || selectedRun.hostId}`}
                    >
                      <Server size={10} strokeWidth={2} />
                      {selectedRun.hostLabel || selectedRun.hostId}
                    </span>
                  )}
                  <div className="flex-1" />
                  {(selectedRun.costUsd ?? costByRunId.get(selectedRun.id)) != null &&
                    (selectedRun.costUsd ?? costByRunId.get(selectedRun.id) ?? 0) > 0 && (
                      <span
                        className="font-mono text-[10.5px] text-[var(--gt-accent-light)]"
                        title={
                          selectedRun.costUsd != null
                            ? 'Cost reported by or-agent (OpenRouter)'
                            : 'Cost from the AI fleet ledger'
                        }
                      >
                        {fmtUsd(selectedRun.costUsd ?? costByRunId.get(selectedRun.id) ?? 0)}
                      </span>
                    )}
                  <span className="text-[10.5px] text-zinc-500">
                    started {fmtWhen(selectedRun.startedAt)}
                    {selectedRun.endedAt && (
                      <> · {fmtDuration(selectedRun.endedAt - selectedRun.startedAt)}</>
                    )}
                  </span>
                  {selectedRun.worktree && !selectedRun.hostId && (
                    <button
                      onClick={() => {
                        if (selectedRun.source === 'session')
                          navigateTo('terminal', {
                            sessionId: selectedRun.id,
                            cwd: selectedRun.worktree,
                          })
                        else window.gt.openExternal(`file://${selectedRun.worktree}`)
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10.5px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                    >
                      <FolderOpen size={10} strokeWidth={2} />
                      {selectedRun.source === 'session' ? 'Terminal' : 'Worktree'}
                    </button>
                  )}
                  {/* Cancel: in-process agent/bg runs (SIGTERM the tracked child), and
                  cron runs — local OR remote — via the runner's cooperative cancel
                  (SIGTERM its runnerPid → kills the attempt + stops retrying). */}
                  {selectedRun.status === 'running' &&
                    ((selectedRun.source !== 'cron' &&
                      !selectedRun.hostId &&
                      (selectedRun.source === 'agent' || selectedRun.source === 'bg')) ||
                      selectedRun.source === 'cron') && (
                      <button
                        onClick={async () => {
                          if (!confirm('Cancel this run? It will be SIGTERM-ed and not retried.'))
                            return
                          if (selectedRun.source === 'cron') {
                            const r = await window.gt.agents.cancelCron(
                              selectedRun.id,
                              selectedRun.hostId,
                            )
                            if (!r.ok) setRerunError(r.error || 'could not cancel')
                          } else if (selectedRun.source === 'bg')
                            await window.gt.bg.cancel(selectedRun.id)
                          else await window.gt.agents.cancel(selectedRun.id)
                          await reload()
                        }}
                        title="Cancel this run (SIGTERM, no retry)"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 px-1.5 py-0.5 text-[10.5px] text-[var(--gt-red)] hover:border-[var(--gt-red)]/60"
                      >
                        <StopCircle size={10} strokeWidth={2} />
                        Cancel
                      </button>
                    )}
                  {/* Remove worktree: post-run cleanup for in-process runs. Cron
                  worktrees live in ~/.config/TerMinal/cron-worktrees/ and are
                  managed by the runner. */}
                  {selectedRun.source === 'agent' &&
                    selectedRun.status !== 'running' &&
                    !selectedRun.hostId &&
                    selectedRun.worktree && (
                      <button
                        onClick={async () => {
                          if (
                            !confirm(
                              "Remove this run's worktree? Uncommitted changes will be lost.",
                            )
                          )
                            return
                          await window.gt.agents.removeWorktree(selectedRun.id)
                          await reload()
                        }}
                        title="git worktree remove (and rm -rf the directory)"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                      >
                        <Trash2 size={10} strokeWidth={2} />
                        Remove worktree
                      </button>
                    )}
                  <button
                    onClick={() => handleRerun(selectedRun)}
                    disabled={
                      rerunBusy ||
                      selectedRun.status === 'running' ||
                      // Re-runnable: any cron run with a scheduleId (local OR remote — the
                      // host re-fires it), or a LOCAL agent run. Remote-agent/bg/session
                      // have no re-run primitive yet.
                      !(
                        (selectedRun.source === 'cron' && !!selectedRun.scheduleId) ||
                        (selectedRun.source === 'agent' && !selectedRun.hostId)
                      )
                    }
                    title={
                      selectedRun.status === 'running'
                        ? 'Already running'
                        : selectedRun.source === 'bg'
                          ? 'Background inbox tasks cannot be re-run from here yet'
                          : selectedRun.source === 'session'
                            ? 'Terminal sessions cannot be re-run from here yet'
                            : selectedRun.source === 'agent' && selectedRun.hostId
                              ? 'Remote agent runs cannot be re-run from here yet'
                              : selectedRun.source === 'cron' && !selectedRun.scheduleId
                                ? 'Cron run without scheduleId — cannot re-fire'
                                : selectedRun.hostId
                                  ? `Re-run on ${selectedRun.hostLabel || selectedRun.hostId}`
                                  : 'Re-run this agent'
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/15 px-1.5 py-0.5 text-[10.5px] text-zinc-100 hover:border-[var(--gt-accent)]/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={10} strokeWidth={2} />
                    {rerunBusy ? 'starting…' : 'Re-run'}
                  </button>
                  {rerunError && (
                    <span className="max-w-[220px] truncate text-[10.5px] text-[var(--gt-red)]">
                      {rerunError}
                    </span>
                  )}
                  <button
                    onClick={() => setSel(null)}
                    title="Close detail"
                    className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </header>
                {selectedRun.error && (
                  <div className="shrink-0 border-b border-[var(--gt-border)]/60 bg-[var(--gt-red)]/10 px-5 py-2 text-[11.5px] text-[var(--gt-red)]">
                    {selectedRun.error}
                  </div>
                )}
                {(selectedRun.trace || selectedRun.evaluation) && (
                  <div className="shrink-0 space-y-2 border-b border-[var(--gt-border)]/60 bg-[var(--gt-panel)]/30 px-5 py-3">
                    {selectedRun.trace && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                          Trace
                        </span>
                        {selectedRun.trace.ticketRef && (
                          <Badge tone="blue">ticket {selectedRun.trace.ticketRef}</Badge>
                        )}
                        {selectedRun.trace.ticketSlug && (
                          <span className="font-mono text-[10.5px] text-zinc-500">
                            {selectedRun.trace.ticketSlug}
                          </span>
                        )}
                        {selectedRun.trace.prIid !== undefined && (
                          <Badge tone="accent">
                            {selectedRun.trace.prKind || 'pr'} #{selectedRun.trace.prIid}
                          </Badge>
                        )}
                        {selectedRun.trace.sourceBranch && (
                          <span className="font-mono text-[10.5px] text-zinc-500">
                            {selectedRun.trace.sourceBranch}
                          </span>
                        )}
                      </div>
                    )}
                    {selectedRun.evaluation && (
                      <RunEvaluationPanel evaluation={selectedRun.evaluation} />
                    )}
                  </div>
                )}
                {artifacts.length > 0 && (
                  <div className="shrink-0 space-y-1 border-b border-[var(--gt-border)]/60 bg-[var(--gt-panel)]/30 px-5 py-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                      Artifacts · {artifacts.length}
                    </span>
                    <div className="flex flex-col gap-1">
                      {artifacts.slice(0, 8).map((a) => (
                        <button
                          key={a.slug}
                          onClick={() => window.gt.openExternal(`file://${a.reportPath}`)}
                          title={a.summary || a.reportPath}
                          className="flex items-center gap-2 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1 text-left text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50"
                        >
                          <FileText size={11} strokeWidth={2} className="shrink-0 text-zinc-500" />
                          <span className="truncate">{a.title}</span>
                          {a.agent && (
                            <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">
                              {a.agent}
                            </span>
                          )}
                          {a.ok === false && (
                            <span className="shrink-0 text-[9.5px] text-[var(--gt-red)]">
                              failed
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <RunLogPane
                  source={selectedRun.source}
                  runId={selectedRun.id}
                  status={selectedRun.status}
                  hostId={selectedRun.hostId}
                  className="flex-1"
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'runs',
  title: 'Runs',
  icon: ListChecks,
  order: 3.45, // between Agents (3) and Schedules (3.5)
  appliesTo: () => true,
  badge: async (gt) => {
    try {
      const rs = await gt.agents.allRuns()
      // Runs = fire-and-forget processes only; interactive sessions live in Terminal.
      return rs.filter((r) => r.source !== 'session' && r.status === 'running').length
    } catch {
      return 0
    }
  },
  Component: RunsTab,
}
export default tab
