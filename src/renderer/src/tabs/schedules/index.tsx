import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Play,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  FileText,
  X,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import { EngineLogo } from '../../components/EngineLogo'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import type { BadgeTone } from '../../components/ui'
import type { Tab, TabContext, Agent, Schedule, ScheduleSpec, CronRun, Engine } from '../../lib/types'

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const FIELD =
  'rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

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
const statusTone = (s?: string): BadgeTone =>
  s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'mute'

// The structured + advanced-cron builder. Produces a ScheduleSpec.
function ScheduleForm({
  agents,
  onCancel,
  onSave,
  onCustomSpawned,
}: {
  agents: Agent[]
  onCancel: () => void
  onSave: (agentId: string, engine: Engine, spec: ScheduleSpec, model?: string) => Promise<void>
  onCustomSpawned: () => void
}) {
  // Plaintext describe-it-in-words is the primary path; the deterministic
  // Form remains available behind the toggle for power users.
  const [mode, setMode] = useState<'form' | 'custom'>('custom')
  const [customText, setCustomText] = useState('')
  const [customBusy, setCustomBusy] = useState(false)
  const [customErr, setCustomErr] = useState('')
  const [agentId, setAgentId] = useState(agents[0]?.id || '')
  const [engine, setEngine] = useState<Engine>('claude')
  const [model, setModel] = useState('')
  useEffect(() => {
    window.gt.settings.get().then((s) => setEngine(s.defaultEngine))
  }, [])
  // Pre-fill model from the selected agent's default whenever the agent changes.
  useEffect(() => {
    const a = agents.find((x) => x.id === agentId)
    setModel(a?.model || '')
  }, [agentId, agents])
  const [kind, setKind] = useState<'interval' | 'calendar' | 'cron'>('calendar')
  const [everyN, setEveryN] = useState(1)
  const [unit, setUnit] = useState<'minutes' | 'hours'>('hours')
  const [time, setTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [cron, setCron] = useState('30 9 * * 1-5')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const toggleWd = (d: number) =>
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b)))

  const buildSpec = (): ScheduleSpec => {
    if (kind === 'interval') return { kind: 'interval', everyMinutes: Math.max(1, unit === 'hours' ? everyN * 60 : everyN) }
    if (kind === 'cron') return { kind: 'cron', expr: cron.trim() }
    const [h, m] = time.split(':').map(Number)
    return { kind: 'calendar', minute: m || 0, hour: h || 0, weekdays: weekdays.length ? weekdays : undefined }
  }

  const submit = async () => {
    if (!agentId) return
    setBusy(true)
    setErr('')
    try {
      await onSave(agentId, engine, buildSpec(), model.trim() || undefined)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCustom = async () => {
    const t = customText.trim()
    if (!t) return
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
    <div className="space-y-3 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      {/* Form / Custom toggle — same UX as the agents tab's new-agent flow. */}
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
        {(['form', 'custom'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-sm px-2 py-0.5 text-[11px] capitalize ${
              mode === m ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
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
            {customErr && <span className="text-[11px] text-[var(--gt-red)]">{customErr}</span>}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={onCancel} className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5">
                cancel
              </button>
              <button
                onClick={submitCustom}
                disabled={!customText.trim() || customBusy}
                className="rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {customBusy ? 'Spawning…' : `Design with ${engine}`}
              </button>
            </div>
          </div>
          <div className="text-[10.5px] text-zinc-600">
            ⌘↵ to submit · the designer reads your agent list + existing schedules, parses the cadence, and writes the new entry directly. After it finishes the app reconciles launchd so the schedule becomes real.
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
      </div>

      <div className="flex items-center gap-1">
        {(['calendar', 'interval', 'cron'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize ${
              kind === k
                ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {k === 'calendar' ? 'at a time' : k === 'interval' ? 'every N' : 'cron'}
          </button>
        ))}
      </div>

      {kind === 'interval' && (
        <div className="flex items-center gap-2 text-[12px] text-zinc-400">
          every
          <input
            type="number"
            min={1}
            value={everyN}
            onChange={(e) => setEveryN(Math.max(1, Number(e.target.value)))}
            className={`${FIELD} w-16`}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours')} className={FIELD}>
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
      )}
      {kind === 'calendar' && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
          at
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
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
          <span className="text-[10px] text-zinc-600">{weekdays.length ? '' : '(every day)'}</span>
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
          <div className="text-[10px] text-zinc-600">5-field cron — ranges/lists/steps ok (e.g. */15, 1-5, 9,17).</div>
        </div>
      )}

      {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !agentId}
          className="rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Schedule it'}
        </button>
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5">
          cancel
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
  const [view, setView] = useState<'schedules' | 'runs'>('schedules')
  const [repo, setRepo] = useState('') // '' = all repos
  const [allRuns, setAllRuns] = useState<CronRun[] | null>(null)
  const [disabled, setDisabledIds] = useState<Set<string>>(new Set())

  const reload = () => window.gt.schedules.list().then(setSchedules)
  const reloadRuns = () => window.gt.schedules.runs().then(setAllRuns)
  const reloadDisabled = () => window.gt.schedules.disabledList().then((ids) => setDisabledIds(new Set(ids)))
  useEffect(() => {
    reload()
    reloadDisabled()
    window.gt.agents.list().then(setAgents)
  }, [ctx.sessionId])
  useEffect(() => {
    if (view === 'runs') reloadRuns()
  }, [view])

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

  // Global view: repo options span every repo that has a schedule or a run —
  // no need to switch the active session to manage another repo's jobs.
  const repoOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of schedules || []) if (s.repoLabel) set.add(s.repoLabel)
    for (const r of allRuns || []) if (r.repoLabel) set.add(r.repoLabel)
    return [...set].sort()
  }, [schedules, allRuns])
  const shownSchedules = (schedules || []).filter((s) => !repo || s.repoLabel === repo)
  const shownRuns = (allRuns || []).filter((r) => !repo || r.repoLabel === repo)

  const openRuns = async (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    setLog(null)
    setRuns(await window.gt.schedules.runs(id))
  }

  const save = async (agentId: string, engine: Engine, spec: ScheduleSpec, model?: string) => {
    const r = await window.gt.schedules.save({ agentId, engine, spec, model })
    if (r && 'error' in r) throw new Error(r.error)
    setCreating(false)
    reload()
  }
  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 5000)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <CalendarClock size={14} strokeWidth={2} className="text-[var(--gt-accent-2)]" />
        <span className="text-[12px] font-semibold text-zinc-200">Schedules</span>
        <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-[var(--gt-border)] p-0.5">
          {(['schedules', 'runs'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v)
                setExpanded(null)
                setLog(null)
              }}
              className={`rounded-md px-2 py-0.5 text-[11px] capitalize ${
                view === v ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {v === 'runs' ? 'All runs' : 'Schedules'}
            </button>
          ))}
        </div>
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
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
        <button
          onClick={async () => {
            if (view === 'runs') {
              reloadRuns()
              return
            }
            const r = await window.gt.schedules.reconcile()
            flash(`reconciled · ${r.loaded} loaded, ${r.removed} orphans removed`)
            reload()
          }}
          title={view === 'runs' ? 'Reload all runs' : 'Re-sync launchd with the schedule list (removes orphans)'}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60"
        >
          <RefreshCw size={11} strokeWidth={2} />
          {view === 'runs' ? 'Refresh' : 'Reconcile'}
        </button>
        {view === 'schedules' && (
          <button
            onClick={() => {
              setCreating((v) => !v)
              setExpanded(null)
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1 text-[12px] font-semibold text-white"
          >
            <Plus size={13} strokeWidth={2.5} />
            New schedule
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {msg && <div className="px-1 text-[11px] text-[var(--gt-green)]">{msg}</div>}
        {view === 'schedules' &&
          creating &&
          (agents.length ? (
            <ScheduleForm
              agents={agents}
              onCancel={() => setCreating(false)}
              onSave={save}
              onCustomSpawned={() => {
                setCreating(false)
                flash('designer spawned · schedule will appear when the run completes')
                // No setTimeout — the useEffect onStatus listener above reconciles
                // launchd + reloads the moment the design-schedule run finishes.
              }}
            />
          ) : (
            <div className="rounded-lg border border-[var(--gt-border)] p-3 text-[12px] text-zinc-600">
              No agents in this repo to schedule.
            </div>
          ))}

        {view === 'runs' ? (
          allRuns === null ? (
            <div className="p-3 text-[12px] text-zinc-600">Loading runs…</div>
          ) : shownRuns.length === 0 ? (
            <div className="p-3 text-[12px] text-zinc-600">No runs{repo ? ` for ${repo}` : ' yet'}.</div>
          ) : (
            shownRuns.map((r) => (
              <div key={r.id} className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="font-semibold text-zinc-200">{r.agentTitle}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{r.repoLabel}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase text-zinc-600">
                    <EngineLogo engine={r.engine} size={10} />
                    {r.engine}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-600">{r.branch}</span>
                  <div className="flex-1" />
                  <span className="text-zinc-500">{fmtWhen(r.startedAt)}</span>
                  <button
                    onClick={async () =>
                      setLog(
                        log?.runId === r.id ? null : { runId: r.id, text: await window.gt.schedules.runLog(r.id) },
                      )
                    }
                    className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
                  >
                    <FileText size={11} strokeWidth={2} />
                    log
                  </button>
                </div>
                {log?.runId === r.id && (
                  <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0c0c11] p-2 font-mono text-[10.5px] leading-relaxed text-zinc-300">
                    {log.text || '… (no output yet)'}
                  </pre>
                )}
              </div>
            ))
          )
        ) : schedules === null ? (
          <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="p-3 text-[12px] text-zinc-600">
            No schedules yet. “New schedule” registers a real macOS launchd job that runs an agent on your
            cadence — even when TerMinal is closed.
          </div>
        ) : shownSchedules.length === 0 ? (
          <div className="p-3 text-[12px] text-zinc-600">No schedules for {repo}.</div>
        ) : (
          shownSchedules.map((s) => (
            <div key={s.id} className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-zinc-100">{s.agentTitle}</span>
                    <Badge tone="blue">{s.describe || ''}</Badge>
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase text-zinc-600">
                      <EngineLogo engine={s.engine} size={10} />
                      {s.engine}
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
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {s.repoLabel} · next {fmtWhen(s.nextRun)}
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
                  runs
                </button>
                <button
                  onClick={async () => {
                    await window.gt.schedules.runNow(s.id)
                    flash(`${s.agentTitle} started — see runs / Activity`)
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-[var(--gt-accent-light)]"
                >
                  <Play size={11} strokeWidth={2.5} />
                  run now
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
                            <div className="mt-1 rounded-lg border border-[var(--gt-border)] bg-[#0c0c11]">
                              <div className="flex items-center justify-between border-b border-[var(--gt-border)]/60 px-2 py-1">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-600">log</span>
                                <button
                                  onClick={() => setLog(null)}
                                  className="rounded text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
                                  title="Close log"
                                >
                                  <X size={11} strokeWidth={2} />
                                </button>
                              </div>
                              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10.5px] leading-relaxed text-zinc-300">
                                {log.text || '… (no output yet)'}
                              </pre>
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
    </div>
  )
}

const tab: Tab = {
  id: 'schedules',
  title: 'Schedules',
  icon: CalendarClock,
  order: 3.5, // right after Agents — the software-factory backbone
  appliesTo: () => true,
  // badge = cron runs that failed in the last 24h
  badge: async (gt) => {
    const day = Date.now() - 86_400_000
    return (await gt.schedules.runs()).filter((r) => r.status === 'failed' && r.startedAt >= day).length
  },
  Component: SchedulesTab,
}
export default tab
