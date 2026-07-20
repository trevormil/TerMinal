import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  FileText,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import { EngineLogo } from '../../components/EngineLogo'
import { engineLabel } from '../../lib/engines'
import {
  engineInstanceLabel,
  openPromptInTerminal,
  remoteForTabContext,
  withLaunchContext,
  type LaunchMode,
} from '../../lib/launch'
import { scheduleDesignerPrompt } from '../../lib/agentPrompts'
import { BashHighlight } from '../../components/BashHighlight'
import { RunOutputView } from '../../components/StructuredRunLog'
import { SkillHint } from '../../components/SkillHint'
import type { BadgeTone } from '../../components/ui'
import type {
  Tab,
  TabContext,
  Agent,
  Schedule,
  ScheduleSpec,
  ScheduleRetry,
  CronRun,
  Engine,
} from '../../lib/types'
import { EngineModelPicker } from '../../components/EngineModelPicker'

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const FIELD =
  'rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

const SCHED_REPO_FILTER_KEY = 'gt.schedules.repoFilter'
const repoOf = (root: string) => root.split('/').filter(Boolean).pop() || root

function fmtWhen(ts?: number | null): string {
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
function reltime(ts?: number): string {
  if (!ts) return ''
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function untilFire(ts?: number | null): string {
  if (!ts) return ''
  const s = (ts - Date.now()) / 1000
  if (s <= 0) return 'now'
  if (s < 60) return `in ${Math.floor(s)}s`
  if (s < 3600) return `in ${Math.floor(s / 60)}m`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `in ${Math.floor(s / 86400)}d`
}
const statusTone = (s?: string): BadgeTone =>
  s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'mute'

// The structured + advanced-cron builder. Produces a ScheduleSpec.
function ScheduleForm({
  repoRoot,
  remote,
  agents,
  onCancel,
  onSave,
  onCustomSpawned,
}: {
  repoRoot: string
  remote?: TabContext['remoteSession']
  agents: Agent[]
  onCancel: () => void
  onSave: (
    agentId: string,
    engine: Engine,
    spec: ScheduleSpec,
    model?: string,
    env?: Record<string, string>,
    retry?: ScheduleRetry,
    timeoutSec?: number,
    host?: string,
    runtime?: 'bare' | 'container' | 'k8s',
  ) => Promise<void>
  onCustomSpawned: () => void
}) {
  // Plaintext describe-it-in-words is the primary path; the deterministic
  // Form remains available behind the toggle for power users.
  const [mode, setMode] = useState<'form' | 'custom'>('custom')
  const [customText, setCustomText] = useState('')
  const [customBusy, setCustomBusy] = useState(false)
  const [customErr, setCustomErr] = useState('')
  const [agentId, setAgentId] = useState(agents[0]?.id || '')
  const [engine, setEngine] = useState<Engine>('codex')
  const [model, setModel] = useState('')
  const [customLaunchMode, setCustomLaunchMode] = useState<LaunchMode>('terminal')
  // Where this schedule fires (ADR-0002). '' = local (launchd). A hostId → that
  // always-on host via systemd. Only offered in the local control-plane context
  // (not when already attached to a remote session). Linux hosts only — the
  // systemd trigger layer is Linux-specific.
  const [host, setHost] = useState('')
  const [runtime, setRuntime] = useState<'bare' | 'container' | 'k8s'>('bare')
  const [hostOptions, setHostOptions] = useState<{ id: string; label: string }[]>([])
  // Reachability per host — hosts go down routinely (tailscale reauth ~24h, asleep),
  // so probe up front and show it in the selector instead of failing at save time.
  const [hostHealth, setHostHealth] = useState<
    Record<string, { reachable: boolean; hint?: string }>
  >({})
  useEffect(() => {
    window.gt.settings.get().then((s) => {
      setEngine(s.defaultEngine)
      const hosts = (s.remoteHosts || [])
        .filter((h) => h.platform !== 'macos')
        .map((h) => ({ id: h.id, label: h.label }))
      setHostOptions(hosts)
      for (const h of hosts)
        window.gt
          .healthCheckHost(h.id)
          .then((r) =>
            setHostHealth((m) => ({ ...m, [h.id]: { reachable: r.reachable, hint: r.hint } })),
          )
    })
  }, [])
  // Pre-fill model from the selected agent's default whenever the agent changes.
  useEffect(() => {
    const a = agents.find((x) => x.id === agentId)
    setModel(a?.model || '')
  }, [agentId, agents])
  const [kind, setKind] = useState<'calendar' | 'cron'>('calendar')
  const [time, setTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [cron, setCron] = useState('30 9 * * 1-5')
  // Optional flaky-run controls. Blank = use the runner defaults (2 retries,
  // 30s base backoff, 30m timeout). Only sent when the operator fills them in.
  const [maxRetries, setMaxRetries] = useState('')
  const [backoffSec, setBackoffSec] = useState('')
  const [timeoutMin, setTimeoutMin] = useState('')
  // Per-schedule env vars — one KEY=value per line. Sanitized + uppercased by
  // the main-side IPC; only POSIX-shaped names survive (`[A-Z_][A-Z0-9_]*`).
  // Optional; the common case is empty.
  const [envText, setEnvText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const toggleWd = (d: number) =>
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b)))

  const buildSpec = (): ScheduleSpec => {
    if (kind === 'cron') return { kind: 'cron', expr: cron.trim() }
    const [h, m] = time.split(':').map(Number)
    return {
      kind: 'calendar',
      minute: m || 0,
      hour: h || 0,
      weekdays: weekdays.length ? weekdays : undefined,
    }
  }

  // Only build a retry object when the operator typed a retry count; backoff
  // defaults to 30s if left blank. Timeout is minutes in the UI → seconds out.
  const buildRetry = (): ScheduleRetry | undefined => {
    const n = parseInt(maxRetries, 10)
    if (!Number.isFinite(n) || n < 0) return undefined
    const b = parseInt(backoffSec, 10)
    return { maxRetries: n, backoffSec: Number.isFinite(b) && b > 0 ? b : 30 }
  }
  const buildTimeoutSec = (): number | undefined => {
    const n = parseInt(timeoutMin, 10)
    return Number.isFinite(n) && n > 0 ? n * 60 : undefined
  }

  // Parse the env textarea into a Record. Lines starting with `#` are comments;
  // blank lines are ignored; everything else is split on the FIRST `=` so values
  // can contain `=` themselves. Malformed lines are dropped silently — the
  // main-side IPC re-sanitizes before persisting, so this is just for the
  // common case.
  const parseEnv = (raw: string): Record<string, string> | undefined => {
    const out: Record<string, string> = {}
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (!key) continue
      out[key] = value
    }
    return Object.keys(out).length ? out : undefined
  }

  const submit = async () => {
    if (!agentId) return
    setBusy(true)
    setErr('')
    try {
      await onSave(
        agentId,
        engine,
        buildSpec(),
        model.trim() || undefined,
        parseEnv(envText),
        buildRetry(),
        buildTimeoutSec(),
        host || undefined,
        host ? runtime : undefined,
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCustom = async () => {
    const t = customText.trim()
    if (!t) return
    if (customLaunchMode === 'terminal') {
      openPromptInTerminal({
        engine,
        cwd: repoRoot,
        name: 'Design schedule',
        prompt: scheduleDesignerPrompt(t, { model: model || undefined }),
        remote,
      })
      onCustomSpawned()
      return
    }
    setCustomBusy(true)
    setCustomErr('')
    const r = await window.gt.schedules.design(t, engine)
    setCustomBusy(false)
    if (r && 'error' in r) {
      setCustomErr(r.error)
      return
    }
    onCustomSpawned()
  }

  return (
    <div className="space-y-3">
      <SkillHint>
        You can also schedule from the terminal with{' '}
        <code className="font-mono text-zinc-300">
          /new-schedule "Run docs every Monday at 9am"
        </code>{' '}
        in Claude or{' '}
        <code className="font-mono text-zinc-300">
          $new-schedule "Run docs every Monday at 9am"
        </code>{' '}
        in Codex.
      </SkillHint>
      {/* Form / Custom toggle — same UX as the agents tab's new-agent flow. */}
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
        {(['form', 'custom'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-sm px-2 py-0.5 text-[11px] capitalize ${
              mode === m
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {m === 'form' ? 'Form' : 'Describe in plain text'}
          </button>
        ))}
      </div>

      {mode === 'custom' && (
        <div className="space-y-2">
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitCustom()
            }}
            rows={3}
            autoFocus
            placeholder='e.g. "Run the docs agent every Monday at 9am" — reference any existing agent by name.'
            className={`${FIELD} resize-y w-full`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              engine + model
              <EngineModelPicker
                engine={engine}
                model={model || undefined}
                onChange={(e, m) => {
                  setEngine(e)
                  setModel(m || '')
                }}
                size="sm"
              />
            </label>
            <select
              value={customLaunchMode}
              onChange={(e) => setCustomLaunchMode(e.target.value as LaunchMode)}
              className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
            >
              <option value="terminal">{engineInstanceLabel(engine)} instance</option>
              <option value="process">Process</option>
            </select>
            {customErr && <span className="text-[11px] text-[var(--gt-red)]">{customErr}</span>}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onCancel}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={submitCustom}
                disabled={!customText.trim() || customBusy}
                className="rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {customBusy
                  ? 'Spawning…'
                  : customLaunchMode === 'terminal'
                    ? 'Open instance'
                    : `Design with ${engineLabel(engine)}`}
              </button>
            </div>
          </div>
          <div className="text-[10.5px] text-zinc-600">
            ⌘↵ to submit · the designer reads your agent list + existing schedules, parses the
            cadence, and writes the new entry directly. After it finishes the app reconciles launchd
            so the schedule becomes real.
          </div>
        </div>
      )}

      {mode === 'form' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500">Run</span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={FIELD}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-zinc-500">via</span>
            <EngineModelPicker
              engine={engine}
              model={model || undefined}
              onChange={(e, m) => {
                setEngine(e)
                setModel(m || '')
              }}
              size="sm"
            />
            {/* Run-on host selector — only in the local control plane (not when
            already attached to a remote), and only when Linux hosts exist. */}
            {!remote && hostOptions.length > 0 && (
              <>
                <span className="text-[11px] text-zinc-500">on</span>
                <select value={host} onChange={(e) => setHost(e.target.value)} className={FIELD}>
                  <option value="">This Mac (launchd)</option>
                  {hostOptions.map((h) => {
                    const hh = hostHealth[h.id]
                    const dot = !hh ? '' : hh.reachable ? '● ' : '○ '
                    return (
                      <option key={h.id} value={h.id}>
                        {dot}
                        {h.label} (systemd){hh && !hh.reachable ? ' — unreachable' : ''}
                      </option>
                    )
                  })}
                </select>
                {host && (
                  <select
                    value={runtime}
                    onChange={(e) => setRuntime(e.target.value as 'bare' | 'container' | 'k8s')}
                    className={FIELD}
                  >
                    <option value="bare">Bare</option>
                    <option value="container">Container</option>
                    <option value="k8s">k8s (k3s CronJob)</option>
                  </select>
                )}
                {host && hostHealth[host] && !hostHealth[host].reachable && (
                  <span className="text-[10.5px] text-amber-400">{hostHealth[host].hint}</span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
            {(['calendar', 'cron'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize ${
                  kind === k
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {k === 'calendar' ? 'At a time' : 'Cron'}
              </button>
            ))}
          </div>

          {kind === 'calendar' && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
              at
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={FIELD}
              />
              <span className="text-zinc-600">on</span>
              {WD.map((w, i) => (
                <button
                  key={w}
                  onClick={() => toggleWd(i)}
                  className={`h-6 w-7 rounded text-[10px] ${
                    weekdays.includes(i)
                      ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
                      : 'border border-[var(--gt-border)] text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {w}
                </button>
              ))}
              <span className="text-[10px] text-zinc-600">
                {weekdays.length ? '' : '(every day)'}
              </span>
            </div>
          )}
          {kind === 'cron' && (
            <div className="space-y-1">
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="min hour dom month dow  (e.g. 30 9 * * 1-5)"
                className={`${FIELD} w-full font-mono`}
              />
              <div className="text-[10px] text-zinc-600">
                5-field cron — ranges/lists/steps ok (e.g. */15, 1-5, 9,17). Fires at fixed
                wall-clock times.
              </div>
            </div>
          )}

          {/* Optional reliability knobs for flaky runs. Blank = runner defaults
          (2 retries · 30s base backoff · 30m timeout). */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            <span className="text-zinc-600">Retries</span>
            <input
              type="number"
              min={0}
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
              placeholder="2"
              className={`${FIELD} w-14`}
            />
            <span className="text-zinc-600">Backoff</span>
            <input
              type="number"
              min={1}
              value={backoffSec}
              onChange={(e) => setBackoffSec(e.target.value)}
              placeholder="30s"
              className={`${FIELD} w-16`}
            />
            <span className="text-zinc-600">Timeout</span>
            <input
              type="number"
              min={1}
              value={timeoutMin}
              onChange={(e) => setTimeoutMin(e.target.value)}
              placeholder="30m"
              className={`${FIELD} w-16`}
            />
            <span className="text-[10px] text-zinc-700">blank = defaults</span>
          </div>

          {/* Optional per-schedule env vars. Power-user surface: most schedules
          have zero. The cron runner spreads these into the spawned agent's
          env after the standard TERMINAL_* keys, so e.g. a "(bolt)" Beacon
          schedule can pin BEACON_PROJECT=bolt and the agent prompt's
          `$BEACON_PROJECT` substitution resolves to bolt instead of the
          global config default. */}
          <details className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1">
            <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">
              Env vars <span className="text-zinc-700">(optional · KEY=value, one per line)</span>
            </summary>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={3}
              placeholder={`BEACON_PROJECT=bolt\nBEACON_SECRET=sec_…`}
              className={`${FIELD} mt-1.5 resize-y w-full font-mono text-[11px]`}
            />
            <div className="mt-1 text-[10px] text-zinc-600">
              Keys must match <span className="font-mono">[A-Z_][A-Z0-9_]*</span>. Comments (
              <span className="font-mono">#…</span>) and blank lines ignored.
            </div>
          </details>

          {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={busy || !agentId}
              className="rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Schedule it'}
            </button>
            <button
              onClick={onCancel}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SchedulesTab({ ctx }: { ctx: TabContext }) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [log, setLog] = useState<{ runId: string; text: string } | null>(null)
  const [msg, setMsg] = useState('')
  // '__auto__' = follow the current repo (resolved below); '' = all repos.
  const [repo, setRepo] = useState(() => localStorage.getItem(SCHED_REPO_FILTER_KEY) ?? '__auto__')
  const activeRepoLabel = ctx.repoPath || repoOf(ctx.repoRoot || ctx.cwd || '')
  // The pause-all/kill-switch (agents-disabled.ts) is a LOCAL-only mechanism;
  // the remote daemon has no disabled-list, so those IPCs no-op when a remote
  // host is attached. Guard the UI so it never flashes a false "paused N".
  const isRemote = !!remoteForTabContext(ctx)
  // Default the filter to the current repo whenever we're in one. Manual picks
  // (incl. "All repos") persist and win over this.
  useEffect(() => {
    if (repo !== '__auto__' || !ctx.repoRoot || !activeRepoLabel) return
    setRepo(activeRepoLabel)
  }, [activeRepoLabel, repo, ctx.repoRoot])
  const setRepoFilter = (value: string) => {
    localStorage.setItem(SCHED_REPO_FILTER_KEY, value)
    setRepo(value)
  }
  // Tick the relative "fires in 12m" labels every minute. The Schedule.nextRun
  // value is already on each record (computed by readSchedules); this just
  // forces the count-down strings to refresh in place.
  const [, setClockTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  const [disabled, setDisabledIds] = useState<Set<string>>(new Set())
  // Lazy-loaded bash bodies, keyed by agentId. Same cache pattern as the Agents tab.
  const [scriptByAgent, setScriptByAgent] = useState<
    Record<string, { path: string; body: string } | null>
  >({})

  const reload = () => window.gt.schedules.list().then(setSchedules)
  const reloadDisabled = () =>
    window.gt.schedules.disabledList().then((ids) => setDisabledIds(new Set(ids)))
  useEffect(() => {
    reload()
    reloadDisabled()
    window.gt.agents.list().then(setAgents)
  }, [ctx.sessionId])

  // Listen for the design-schedule run completing — when the spawn finishes
  // writing to schedules.json, reconcile launchd so the new entry becomes a
  // real LaunchAgent without the user having to click Reconcile.
  useEffect(() => {
    const off = window.gt.agents.onStatus(async (run) => {
      if (run.agentId !== 'design-schedule' || run.status !== 'done') return
      await window.gt.schedules.reconcile()
      reload()
      flash('schedule designed · launchd reconciled')
    })
    return () => off()
  }, [])

  // Live log tail while a running cron job's log is open. Polls every 1.5s and
  // updates the inline log pane so the operator sees output as `script -q`
  // streams agent stdout, instead of having to re-click "log".
  useEffect(() => {
    if (!log) return
    const targetRun = runs.find((r) => r.id === log.runId)
    if (!targetRun || targetRun.status !== 'running') return
    let alive = true
    const tick = async () => {
      const text = await window.gt.schedules.runLog(log.runId)
      if (alive && text !== log.text) setLog({ runId: log.runId, text })
    }
    const id = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [log?.runId, log?.text, runs])

  // Auto-refresh the expanded schedule's run list while any of its runs is still
  // running, so a run that finishes flips running → done/failed IN PLACE instead
  // of being stuck on the one-shot snapshot from openRuns() until you collapse +
  // re-expand. Gated on `anyRunning` (not the `runs` array identity) so a steady
  // stream of same-status polls doesn't churn the interval; the effect tears the
  // poll down the moment nothing is running.
  const anyRunning = runs.some((r) => r.status === 'running')
  useEffect(() => {
    if (!expanded || !anyRunning) return
    let alive = true
    const id = setInterval(async () => {
      const next = await window.gt.schedules.runs(expanded)
      if (alive) setRuns(next)
    }, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [expanded, anyRunning])

  // Global view: repo options span every repo that has a schedule. (Run-only
  // repos previously also appeared here; that's now the Runs tab's job.)
  const repoOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of schedules || []) if (s.repoLabel) set.add(s.repoLabel)
    if (activeRepoLabel) set.add(activeRepoLabel) // always offer the current repo
    return [...set].sort()
  }, [schedules, activeRepoLabel])
  const shownSchedules = (schedules || []).filter(
    (s) => repo === '__auto__' || !repo || s.repoLabel === repo,
  )

  const openRuns = async (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    setLog(null)
    setRuns(await window.gt.schedules.runs(id))
    // Lazy-fetch the script body for the schedule's agent so it renders above
    // the run history. Cache including null so we don't re-hit IPC.
    const sched = (schedules || []).find((s) => s.id === id)
    if (sched && !(sched.agentId in scriptByAgent)) {
      window.gt.agents
        .script(sched.agentId)
        .then((r) => setScriptByAgent((m) => ({ ...m, [sched.agentId]: r })))
    }
  }

  const save = async (
    agentId: string,
    engine: Engine,
    spec: ScheduleSpec,
    model?: string,
    env?: Record<string, string>,
    retry?: ScheduleRetry,
    timeoutSec?: number,
    host?: string,
    runtime?: 'bare' | 'container' | 'k8s',
  ) => {
    const r = await window.gt.schedules.save({
      agentId,
      engine,
      spec,
      model,
      env,
      retry,
      timeoutSec,
      host,
      runtime,
    })
    if (r && 'error' in r) throw new Error(r.error)
    setCreating(false)
    reload()
  }
  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 5000)
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <CalendarClock size={14} strokeWidth={2} className="text-[var(--gt-accent-2)]" />
        <span className="text-[12px] font-semibold text-zinc-200">Schedules</span>
        <span className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-0.5 text-[11px] text-zinc-500">
          {(schedules || []).length} schedules
        </span>
        <select
          value={repo === '__auto__' ? '' : repo}
          onChange={(e) => setRepoFilter(e.target.value)}
          title="Filter by repo"
          className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 text-[11px] text-zinc-300 outline-none"
        >
          <option value="">All repos</option>
          {repoOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {/* Pause-all / Resume-all. The runner re-reads the disabled list on
            every fire, so the kill-switch takes effect on the next launchd
            tick — no reconcile/restart needed. Useful for travel, slow
            networks, or debugging without un-scheduling everything. */}
        {(() => {
          const total = (schedules || []).length
          const pausedCount = (schedules || []).filter((s) => disabled.has(s.id)).length
          const allPaused = total > 0 && pausedCount === total
          return (
            total > 0 && (
              <button
                onClick={async () => {
                  if (isRemote) {
                    flash('pause-all is local-only — toggle remote schedules individually')
                    return
                  }
                  await window.gt.schedules.disabledAll(!allPaused)
                  reloadDisabled()
                  flash(allPaused ? `resumed ${total} schedules` : `paused ${total} schedules`)
                }}
                title={
                  allPaused
                    ? 'Resume every schedule (re-enable launchd firing)'
                    : 'Pause every schedule (no fires until you resume)'
                }
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                  allPaused
                    ? 'border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)]'
                    : pausedCount > 0
                      ? 'border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 text-[var(--gt-yellow)]'
                      : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/60'
                }`}
              >
                {allPaused ? (
                  <Play size={11} strokeWidth={2.5} />
                ) : (
                  <Pause size={11} strokeWidth={2.5} />
                )}
                {allPaused
                  ? `Resume all (${total})`
                  : pausedCount > 0
                    ? `Pause all (${pausedCount}/${total} paused)`
                    : `Pause all (${total})`}
              </button>
            )
          )
        })()}
        <button
          onClick={async () => {
            const r = await window.gt.schedules.reconcile()
            if ('error' in r) flash(`reconcile failed · ${r.error}`)
            else if (r.failed.length)
              flash(
                `reconciled · ${r.loaded} loaded, ${r.removed} orphans · ${r.failed.length} FAILED to load`,
              )
            else flash(`reconciled · ${r.loaded} loaded, ${r.removed} orphans removed`)
            reload()
          }}
          title="Re-sync launchd with the schedule list (removes orphans)"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60"
        >
          <RefreshCw size={11} strokeWidth={2} />
          Reconcile
        </button>
        <button
          onClick={() => {
            setCreating(true)
            setExpanded(null)
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1 text-[12px] font-semibold text-white"
        >
          <Plus size={13} strokeWidth={2.5} />
          New schedule
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {msg && <div className="px-1 text-[11px] text-[var(--gt-green)]">{msg}</div>}
        {schedules === null ? (
          <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="p-3 text-[12px] text-zinc-600">
            No schedules yet. “New schedule” registers a real macOS launchd job that runs an agent
            on your cadence — even when TerMinal is closed.
          </div>
        ) : shownSchedules.length === 0 ? (
          <div className="p-3 text-[12px] text-zinc-600">No schedules for {repo}.</div>
        ) : (
          shownSchedules.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3"
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-zinc-100">{s.agentTitle}</span>
                    <Badge tone="blue">{s.describe || ''}</Badge>
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase text-zinc-600">
                      <EngineLogo engine={s.engine} size={10} />
                      {engineLabel(s.engine)}
                    </span>
                    {s.lastStatus && s.lastStatus !== 'never' && (
                      <Badge tone={statusTone(s.lastStatus)}>{s.lastStatus}</Badge>
                    )}
                    {disabled.has(s.id) && (
                      <button
                        onClick={async () => {
                          await window.gt.schedules.disabledToggle(s.id, false)
                          reloadDisabled()
                          flash(`${s.agentTitle} · re-enabled`)
                        }}
                        title="Auto-disabled by the circuit-breaker after consecutive failures. Click to re-enable."
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--gt-red)]/60 bg-[var(--gt-red)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gt-red)] hover:bg-[var(--gt-red)]/20"
                      >
                        kill-switch · re-enable
                      </button>
                    )}
                    {/* Enabled but not loaded in launchd → dark, will never fire.
                        Surface it with a one-click reconcile. Suppressed for
                        kill-switched schedules (their own badge explains it). */}
                    {s.enabled && s.loaded === false && !disabled.has(s.id) && (
                      <button
                        onClick={async () => {
                          const r = await window.gt.schedules.reconcile()
                          if ('error' in r) flash(`reconcile failed · ${r.error}`)
                          else if (r.failed.length)
                            flash(`${r.failed.length} schedule(s) still failed to load`)
                          else flash(`${s.agentTitle} · scheduled in launchd`)
                          reload()
                        }}
                        title="This schedule is enabled but has no loaded launchd job — it will NOT fire. Click to reconcile (register it with launchd)."
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--gt-red)]/60 bg-[var(--gt-red)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gt-red)] hover:bg-[var(--gt-red)]/20"
                      >
                        <AlertTriangle size={10} strokeWidth={2.5} />
                        not scheduled · reconcile
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {s.repoLabel} · next {fmtWhen(s.nextRun)}
                    {s.nextRun && !disabled.has(s.id) && (
                      <span className="ml-1 text-zinc-400">({untilFire(s.nextRun)})</span>
                    )}
                    {s.lastRun ? ` · last ${reltime(s.lastRun)}` : ''}
                  </div>
                </div>
                {/* iOS-style pill switch — clearer at a glance than a checkbox */}
                <button
                  onClick={async () => {
                    await window.gt.schedules.toggle(s.id, !s.enabled)
                    reload()
                  }}
                  title={s.enabled ? 'enabled — click to pause' : 'paused — click to enable'}
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                    s.enabled ? 'bg-[var(--gt-green)]/70' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                      s.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Actions strip — icon buttons with consistent hover affordance. */}
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                <button
                  onClick={() => openRuns(s.id)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                >
                  {expanded === s.id ? (
                    <ChevronDown size={12} strokeWidth={2} />
                  ) : (
                    <ChevronRight size={12} strokeWidth={2} />
                  )}
                  Runs
                </button>
                <button
                  onClick={async () => {
                    // Pass the schedule's host binding so a host schedule fires
                    // on ITS host (systemd over SSH), never as a local run (#43).
                    const r = await window.gt.schedules.runNow(s.id, s.host)
                    if (r && 'error' in r) flash(`run now failed · ${r.error}`)
                    else flash(`${s.agentTitle} started — see runs / Activity`)
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-[var(--gt-accent-light)]"
                >
                  <Play size={11} strokeWidth={2.5} />
                  Run now
                </button>
                <div className="flex-1" />
                <button
                  onClick={async () => {
                    await window.gt.schedules.remove(s.id)
                    reload()
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-white/5 hover:text-[var(--gt-red)]"
                  title="Remove this schedule"
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              </div>

              {expanded === s.id && (
                <div className="mt-2 space-y-1 border-t border-[var(--gt-border)]/50 pt-2">
                  {/* Script preview — show the bash body the runner will exec, or the
                      legacy prompt fallback if no .agents/<id>.sh exists yet. Helps
                      the operator confirm what's about to fire before opening logs. */}
                  {scriptByAgent[s.agentId] !== undefined && (
                    <div className="mb-2 space-y-1">
                      <div className="flex items-center gap-1.5 px-1 text-[10px]">
                        {scriptByAgent[s.agentId] ? (
                          <>
                            <Badge tone="blue">Bash script</Badge>
                            <span className="min-w-0 flex-1 truncate font-mono text-zinc-600">
                              {scriptByAgent[s.agentId]!.path}
                            </span>
                            <button
                              onClick={() => window.gt.openInEditor(scriptByAgent[s.agentId]!.path)}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-200"
                              title="Open in your configured editor"
                            >
                              Edit
                            </button>
                          </>
                        ) : (
                          <>
                            <Badge tone="mute">Prompt</Badge>
                            <span className="text-zinc-700">
                              Legacy prompt — runs as a single agent call
                            </span>
                          </>
                        )}
                      </div>
                      {scriptByAgent[s.agentId] && (
                        <BashHighlight code={scriptByAgent[s.agentId]!.body} className="max-h-56" />
                      )}
                    </div>
                  )}
                  {runs.length === 0 ? (
                    <div className="py-2 text-center text-[11px] text-zinc-600">
                      No runs yet. Try “run now” above to fire one.
                    </div>
                  ) : (
                    runs.map((r) => {
                      const open = log?.runId === r.id
                      const dur =
                        r.endedAt && r.startedAt
                          ? fmtDuration(r.endedAt - r.startedAt)
                          : r.status === 'running'
                            ? 'running…'
                            : '—'
                      return (
                        <div key={r.id}>
                          <button
                            onClick={async () =>
                              setLog(
                                open
                                  ? null
                                  : { runId: r.id, text: await window.gt.schedules.runLog(r.id) },
                              )
                            }
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] text-left ${
                              open ? 'bg-white/5' : 'hover:bg-white/5'
                            }`}
                          >
                            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                            <span className="text-zinc-500">{fmtWhen(r.startedAt)}</span>
                            <span className="text-zinc-700">·</span>
                            <span className="font-mono tabular-nums text-zinc-500">{dur}</span>
                            <span className="text-zinc-700">·</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600">
                              {r.branch}
                            </span>
                            <FileText
                              size={11}
                              strokeWidth={2}
                              className={open ? 'text-[var(--gt-accent-light)]' : 'text-zinc-600'}
                            />
                          </button>
                          {open && log && (
                            <div className="mt-1 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-code-bg)]">
                              <div className="flex items-center justify-between border-b border-[var(--gt-border)]/60 px-2 py-1">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                                  log
                                </span>
                                <button
                                  onClick={() => setLog(null)}
                                  className="rounded text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
                                  title="Close log"
                                >
                                  <X size={11} strokeWidth={2} />
                                </button>
                              </div>
                              <div className="max-h-72 overflow-auto p-2">
                                <RunOutputView text={log.text} engine={r.engine} />
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setCreating(false)}
        >
          <div
            className="max-h-[86vh] w-[720px] overflow-y-auto rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-100">New schedule</h2>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
            {agents.length ? (
              <ScheduleForm
                repoRoot={ctx.repoRoot}
                remote={remoteForTabContext(ctx)}
                agents={agents}
                onCancel={() => setCreating(false)}
                onSave={save}
                onCustomSpawned={() => {
                  setCreating(false)
                  flash('designer spawned · schedule will appear when the run completes')
                }}
              />
            ) : (
              <div className="rounded-lg border border-[var(--gt-border)] p-3 text-[12px] text-zinc-600">
                No agents in this repo to schedule.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'schedules',
  title: 'Schedules',
  icon: CalendarClock,
  order: 3.5, // right after Agents — the software-factory backbone
  appliesTo: () => true,
  // Intentionally no badge. The Runs tab badge already surfaces "running
  // now" + failures from the unified view; a schedules count next to the
  // tab is noise (there's almost always >0 schedules).
  Component: SchedulesTab,
}
export default tab
