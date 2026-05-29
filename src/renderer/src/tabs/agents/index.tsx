import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Play,
  BookText,
  ScanSearch,
  ListChecks,
  TestTube2,
  ShieldAlert,
  Gauge,
  PackageCheck,
  Eraser,
  Square,
  Trash2,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Pencil,
  RotateCcw,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import { EnginePicker } from '../../components/EnginePicker'
import { EngineLogo } from '../../components/EngineLogo'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import type { BadgeTone } from '../../components/ui'
import type { Tab, TabContext, Agent, AgentRun, Engine } from '../../lib/types'

const AGENT_ICON: Record<string, LucideIcon> = {
  BookText,
  ScanSearch,
  ListChecks,
  TestTube2,
  ShieldAlert,
  Gauge,
  PackageCheck,
  Eraser,
  Bot,
}
const statusTone = (s: string): BadgeTone =>
  s === 'done'
    ? 'green'
    : s === 'failed'
      ? 'red'
      : s === 'interrupted'
        ? 'yellow'
        : s === 'canceled'
          ? 'mute'
          : 'blue'
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
const repoOf = (root: string) => root.split('/').filter(Boolean).pop() || root

function reltime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const SOURCE: Record<string, { label: string; tone: BadgeTone }> = {
  default: { label: 'default', tone: 'mute' },
  override: { label: 'customized', tone: 'yellow' },
  repo: { label: 'custom', tone: 'accent' },
  global: { label: 'global', tone: 'blue' },
}
// How the engine wraps the prompt at run time (worktree filled in per run).
const runsAs = (engine: Engine): string =>
  engine === 'claude'
    ? "claude -p '<prompt>' --dangerously-skip-permissions"
    : "codex exec -s danger-full-access -C <worktree> '<prompt>'"

const FIELD =
  'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

// Add / edit an agent. Saving writes <repo>/.agents/agents.json (overriding a
// built-in default = same id). The id is immutable once set.
function AgentDesigner({
  onClose,
  onSpawned,
  onAdvanced,
}: {
  onClose: () => void
  onSpawned: (run: AgentRun) => void
  onAdvanced: () => void
}) {
  const [text, setText] = useState('')
  const [engine, setEngine] = useState<Engine>('claude')
  const [model, setModel] = useState<string | undefined>(undefined)
  const [scope, setScope] = useState<'repo' | 'global'>('repo')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.gt.settings.get().then((s) => setEngine(s.defaultEngine))
  }, [])

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    setErr('')
    const r = await window.gt.agents.design(t, engine, scope, model)
    setBusy(false)
    if (r && 'error' in r) {
      setErr(r.error)
      return
    }
    onSpawned(r as AgentRun)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[640px] flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Bot size={16} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <h2 className="text-sm font-bold text-zinc-100">New agent</h2>
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-zinc-500">
            Describe what it does —
            <EngineLogo engine={engine} size={11} />
            {engine} writes the prompt + saves it
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Description</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
            rows={5}
            autoFocus
            placeholder={
              "e.g. An agent that scans the repo for any TODO/FIXME older than 90 days, files a ticket per cluster, and opens a PR only if it can safely clean up the matching comments without changing behavior. Run weekly."
            }
            className="resize-none rounded-md border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Scope</span>
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
              {(
                [
                  { id: 'repo', label: 'This repo' },
                  { id: 'global', label: 'Global' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  title={
                    s.id === 'repo'
                      ? "Save to this repo's .agents/agents.json"
                      : 'Save to the global registry (~/.config/TerMinal/agents/global.json)'
                  }
                  className={`rounded-sm px-2 py-1 text-[11px] ${
                    scope === s.id
                      ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Engine + model</span>
            <EngineModelPicker engine={engine} model={model} onChange={(e, m) => { setEngine(e); setModel(m) }} size="sm" />
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onAdvanced}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
              title="Skip the designer and write the agent JSON yourself"
            >
              Advanced…
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--gt-border)] px-3 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!text.trim() || busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Bot size={12} strokeWidth={2.5} /> : <EngineLogo engine={engine} size={12} />}
              {busy ? 'Spawning…' : `Design with ${engine}`}
            </button>
          </div>
        </div>

        {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
        <div className="text-[10.5px] text-zinc-600">
          ⌘↵ to submit · the designer reads CLAUDE.md, <span className="font-mono">.agents/forge.md</span>, and
          existing agent specs before writing your agent's prompt so it follows this project's MR + ticket conventions
          (worktree, auto-mergeable label, sole-writer scope, depends_on).
        </div>
      </div>
    </div>
  )
}

function AgentEditor({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | 'new'
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = agent === 'new'
  const a = isNew ? null : (agent as Agent)
  const [id, setId] = useState(a?.id || '')
  const [title, setTitle] = useState(a?.title || '')
  const [description, setDescription] = useState(a?.description || '')
  const [engine, setEngine] = useState<Engine>(a?.engine || 'claude')
  const [model, setModel] = useState(a?.model || '')
  const [opensPr, setOpensPr] = useState(!!a?.opensPr)
  const [prompt, setPrompt] = useState(a?.prompt || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true)
    setErr('')
    const r = await window.gt.agents.save({
      id: id.trim(),
      title: title.trim(),
      description: description.trim(),
      engine,
      model: model.trim() || undefined,
      opensPr,
      prompt,
    })
    setBusy(false)
    if (r && 'error' in r) setErr(r.error)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[640px] flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-100">{isNew ? 'New agent' : `Edit · ${a?.title}`}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5">
            cancel
          </button>
        </div>
        {!isNew && a?.source !== 'repo' && (
          <p className="text-[11px] text-[var(--gt-yellow)]">
            Editing a built-in default — saving writes an override to{' '}
            <span className="font-mono">.agents/agents.json</span>; “Reset” reverts to the default.
          </p>
        )}
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          disabled={!isNew}
          placeholder="id (kebab-case, e.g. triage-issues)"
          className={`${FIELD} font-mono ${isNew ? '' : 'opacity-50'}`}
        />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={FIELD} />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          className={FIELD}
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
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-300">
            <input type="checkbox" checked={opensPr} onChange={(e) => setOpensPr(e.target.checked)} />
            opens a PR
          </label>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder="The full prompt the agent runs (what it should do, what to file/open, how to finish)…"
          className={`${FIELD} resize-y font-mono leading-relaxed`}
        />
        {err && <p className="text-[11px] text-[var(--gt-red)]">{err}</p>}
        <button
          onClick={save}
          disabled={busy || !id.trim() || !title.trim() || !prompt.trim()}
          className="self-start rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save agent'}
        </button>
      </div>
    </div>
  )
}

function AgentsTab({ ctx }: { ctx: TabContext }) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [picking, setPicking] = useState<{ id: string; title: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  const [agentFilter, setAgentFilter] = useState<'all' | 'generic' | 'per-repo'>('all')
  const [designerOpen, setDesignerOpen] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  const reloadAgents = () => window.gt.agents.list().then(setAgents)
  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  useEffect(() => {
    window.gt.agents.list().then(setAgents)
    window.gt.agents.runs().then((rs) => {
      setRuns(rs)
      setOutputs((o) => {
        const next = { ...o }
        for (const r of rs) if (next[r.id] === undefined) next[r.id] = r.output
        return next
      })
      if (rs[0]) setSel((s) => s ?? rs[0].id)
    })
    const offStatus = window.gt.agents.onStatus((run) => {
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === run.id)
        if (i < 0) return [run, ...prev]
        const next = [...prev]
        next[i] = run
        return next
      })
      setOutputs((o) => (o[run.id] === undefined ? { ...o, [run.id]: run.output } : o))
      setSel((s) => s ?? run.id)
      // When a designer run finishes, reload the agents list so the newly-
      // saved entry shows up without a manual refresh.
      if (
        (run.agentId === 'design-repo' || run.agentId === 'design-global') &&
        run.status === 'done'
      ) {
        reloadAgents()
      }
    })
    const offOutput = window.gt.agents.onOutput(({ runId, chunk }) => {
      setOutputs((o) => ({ ...o, [runId]: (o[runId] || '') + chunk }))
    })
    return () => {
      offStatus()
      offOutput()
    }
  }, [ctx.sessionId])

  const [repoFilter, setRepoFilter] = useState('') // '' = all repos
  const selectedRun = runs.find((r) => r.id === sel) || null
  const runningByAgent = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)),
    [runs],
  )
  // Runs are global across every repo; the filter just narrows the list.
  const repoOptions = useMemo(() => [...new Set(runs.map((r) => repoOf(r.repoRoot)))].sort(), [runs])
  const shownRuns = repoFilter ? runs.filter((r) => repoOf(r.repoRoot) === repoFilter) : runs
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sel, selectedRun && outputs[selectedRun.id]])

  const run = async (id: string, engine: Engine, persona: string, pipeline: string, model?: string) => {
    const r = await window.gt.agents.run(id, engine, persona, pipeline, model)
    if ('error' in r) {
      setOutputs((o) => ({ ...o, __err: r.error }))
      return
    }
    setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
    setSel(r.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Bot size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">Agents</span>
        <span className="text-[11px] text-zinc-600">
          own worktree · opens a PR · {ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[44%] min-w-[340px] flex-col border-r border-[var(--gt-border)]">
          <div className="shrink-0 space-y-2 overflow-y-auto p-3" style={{ maxHeight: '58%' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">Agents</span>
                <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
                  {(['all', 'generic', 'per-repo'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setAgentFilter(f)}
                      className={`rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${
                        agentFilter === f
                          ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {f === 'per-repo' ? 'per-repo' : f}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setDesignerOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                title="Design a new agent — describe what it does, claude/codex writes the prompt"
              >
                <Plus size={12} strokeWidth={2.5} />
                New agent
              </button>
            </div>
            {agents === null ? (
              <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
            ) : (
              agents
                .filter((a) => {
                  if (agentFilter === 'all') return true
                  // "generic" = unmodified defaults; "per-repo" = override + custom
                  if (agentFilter === 'generic') return a.source === 'default'
                  return a.source === 'override' || a.source === 'repo'
                })
                .map((a) => {
                const Icon = AGENT_ICON[a.icon || ''] || Bot
                const busy = runningByAgent.has(a.id)
                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-zinc-100">{a.title}</span>
                          {a.source && <Badge tone={SOURCE[a.source].tone}>{SOURCE[a.source].label}</Badge>}
                        </div>
                        {a.description && (
                          <div className="text-[11.5px] leading-snug text-zinc-500">{a.description}</div>
                        )}
                      </div>
                      <button
                        onClick={() => setPicking({ id: a.id, title: a.title })}
                        disabled={busy}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {busy ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-white gt-pulse" />
                            Running
                          </>
                        ) : (
                          <>
                            <Play size={13} strokeWidth={2.5} />
                            Run
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <button
                        onClick={() => toggleExpand(a.id)}
                        className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
                      >
                        {expanded.has(a.id) ? (
                          <ChevronDown size={12} strokeWidth={2} />
                        ) : (
                          <ChevronRight size={12} strokeWidth={2} />
                        )}
                        prompt
                      </button>
                      <button
                        onClick={() => setEditing(a)}
                        className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
                      >
                        <Pencil size={11} strokeWidth={2} />
                        edit
                      </button>
                      {a.source === 'override' && (
                        <button
                          onClick={async () => {
                            await window.gt.agents.reset(a.id)
                            reloadAgents()
                          }}
                          title="Revert to the built-in default"
                          className="inline-flex items-center gap-1 text-zinc-500 hover:text-[var(--gt-yellow)]"
                        >
                          <RotateCcw size={11} strokeWidth={2} />
                          reset
                        </button>
                      )}
                    </div>
                    {expanded.has(a.id) && (
                      <div className="mt-2 space-y-1.5">
                        <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--gt-border)] bg-black/30 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-400">
                          {a.prompt}
                        </pre>
                        <div className="break-all font-mono text-[9.5px] text-zinc-600">
                          runs as: <EngineLogo engine={a.engine || 'codex'} size={9} className="mx-0.5 -mb-0.5" />
                          {runsAs(a.engine || 'codex')}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--gt-border)]">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">Runs</span>
              <span className="text-[10px] text-zinc-700">all repos</span>
              <div className="flex-1" />
              {repoOptions.length > 1 && (
                <select
                  value={repoFilter}
                  onChange={(e) => setRepoFilter(e.target.value)}
                  title="Filter by repo"
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none"
                >
                  <option value="">All repos</option>
                  {repoOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {runs.length === 0 ? (
              <div className="px-3 pb-3 text-[12px] text-zinc-600">No runs yet.</div>
            ) : shownRuns.length === 0 ? (
              <div className="px-3 pb-3 text-[12px] text-zinc-600">No runs for {repoFilter}.</div>
            ) : (
              shownRuns.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSel(r.id)}
                  className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/50 px-3 py-2 text-left hover:bg-white/5 ${
                    sel === r.id ? 'bg-white/5' : ''
                  }`}
                >
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{r.agentTitle}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">{repoOf(r.repoRoot)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] uppercase text-zinc-600">
                    <EngineLogo engine={r.engine} size={10} />
                    {r.engine}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{reltime(r.startedAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedRun ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Run an agent to see its output.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
                <Badge tone={statusTone(selectedRun.status)}>{selectedRun.status}</Badge>
                <span className="text-[12px] font-semibold text-zinc-100">{selectedRun.agentTitle}</span>
                <span className="inline-flex items-center gap-1 text-[9.5px] uppercase text-zinc-600">
                  <EngineLogo engine={selectedRun.engine} size={11} />
                  {selectedRun.engine}
                </span>
                {selectedRun.persona && (
                  <span className="text-[10px] text-[var(--gt-accent-light)]">as {selectedRun.persona}</span>
                )}
                {selectedRun.pipeline && (
                  <span className="text-[10px] text-[var(--gt-accent-light)]">· {selectedRun.pipeline}</span>
                )}
                <span className="font-mono text-[10.5px] text-zinc-600">{selectedRun.branch}</span>
                <div className="flex-1" />
                {selectedRun.status === 'running' && (
                  <button
                    onClick={() => window.gt.agents.cancel(selectedRun.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                  >
                    <Square size={11} strokeWidth={2} />
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => window.gt.openExternal(`file://${selectedRun.worktree}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                >
                  <FolderOpen size={11} strokeWidth={2} />
                  Worktree
                </button>
                {selectedRun.status !== 'running' && (
                  <button
                    onClick={() => window.gt.agents.removeWorktree(selectedRun.id)}
                    title="Remove the worktree (branch/PR stay)"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
              <pre
                ref={logRef}
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#0c0c11] p-4 font-mono text-[11.5px] leading-relaxed text-zinc-300"
              >
                {stripAnsi(outputs[selectedRun.id] || '') || '…'}
              </pre>
            </>
          )}
        </div>
      </div>

      {picking && (
        <EnginePicker
          title={`Run · ${picking.title}`}
          onClose={() => setPicking(null)}
          onPick={(e, persona, pipeline, model) => {
            run(picking.id, e, persona, pipeline, model)
            setPicking(null)
          }}
        />
      )}

      {designerOpen && (
        <AgentDesigner
          onClose={() => setDesignerOpen(false)}
          onSpawned={(r) => {
            setDesignerOpen(false)
            setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
            setSel(r.id)
          }}
          onAdvanced={() => {
            setDesignerOpen(false)
            setEditing('new')
          }}
        />
      )}

      {editing && (
        <AgentEditor
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadAgents()
          }}
        />
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'agents',
  title: 'Agents',
  icon: Bot,
  order: 3,
  appliesTo: (ctx) => ctx.hasAgents,
  badge: async (gt) => (await gt.agents.runs()).filter((r) => r.status === 'running').length,
  Component: AgentsTab,
}
export default tab
