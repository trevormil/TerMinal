import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { langs } from '@uiw/codemirror-extensions-langs'
import type { Extension } from '@codemirror/state'
import {
  Bot,
  Brain,
  FileText,
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
  Pencil,
  RotateCcw,
  EyeOff,
  Plus,
  MessageSquare,
  ClipboardList,
  Footprints,
  Swords,
  Telescope,
  Target,
  Lock,
  Languages,
  ScrollText,
  Scissors,
  MessageCircleQuestion,
  Recycle,
  Library,
  Newspaper,
  Factory,
  Wrench,
  Workflow,
  RadioTower,
  AlertOctagon,
  Undo2,
  CheckCircle2,
  Cpu,
  Database,
  type LucideIcon,
} from 'lucide-react'
import { Badge, ForceChip } from '../../components/ui'
import { EnginePicker } from '../../components/EnginePicker'
import { useResizableWidth, ResizeHandle } from '../../components/ResizeHandle'
import { EngineLogo } from '../../components/EngineLogo'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import { CodeEditor } from '../../components/CodeEditor'
import { Markdown } from '../../components/Markdown'
import { BashHighlight } from '../../components/BashHighlight'
import { SkillHint } from '../../components/SkillHint'
import type { BadgeTone } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import { engineLabel } from '../../lib/engines'
import { engineInstanceLabel, openPromptInTerminal, remoteForTabContext, type LaunchMode } from '../../lib/launch'
import { agentPrompt } from '../../lib/agentPrompts'
import type { Tab, TabContext, Agent, AgentDefinition, AgentModelPolicy, AgentQuality, AgentRun, Engine, FileEntry, PersistentAgent, PersistentAgentDetail, PersistentAgentFiles, PersistentArtifact, PersistentArtifactRead } from '../../lib/types'
import { sanitizeLog as stripAnsi } from '../../lib/sanitizeLog'

function fmtRelative(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

const AGENT_ICON: Record<string, LucideIcon> = {
  BookText,
  ScanSearch,
  ListChecks,
  TestTube2,
  ShieldAlert,
  Gauge,
  PackageCheck,
  Eraser,
  Factory,
  Wrench,
  MessageSquare,
  ClipboardList,
  Footprints,
  Swords,
  Telescope,
  Target,
  Lock,
  Languages,
  ScrollText,
  Scissors,
  MessageCircleQuestion,
  Recycle,
  Library,
  Newspaper,
  Workflow,
  RadioTower,
  AlertOctagon,
  Undo2,
  Brain,
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
const repoOf = (root: string) => root.split('/').filter(Boolean).pop() || root

function reltime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const SOURCE: Record<string, { label: string; tone: BadgeTone }> = {
  default: { label: 'default', tone: 'mute' },
  'repo-override': { label: 'repo override', tone: 'yellow' },
  'global-override': { label: 'global override', tone: 'blue' },
  repo: { label: 'custom', tone: 'accent' },
  global: { label: 'global', tone: 'blue' },
  persistent: { label: 'persistent', tone: 'accent' },
}

function SectionKicker({ icon: Icon, title, meta }: { icon?: LucideIcon; title: string; meta?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2">
      {Icon && <Icon size={13} strokeWidth={2.5} className="shrink-0 text-[var(--gt-accent-light)]" />}
      <h3 className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-zinc-500">{title}</h3>
      {meta}
    </div>
  )
}
const FIELD =
  'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
const AGENT_FILE_EXT: Record<string, string> = {
  md: 'markdown',
  mdx: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'js',
  ts: 'ts',
  tsx: 'tsx',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  py: 'py',
  toml: 'toml',
  txt: '',
}
function langForAgentFile(path: string): Extension[] {
  const key = AGENT_FILE_EXT[path.split('.').pop()?.toLowerCase() || ''] as keyof typeof langs | ''
  try {
    return key && langs[key] ? [langs[key]()] : []
  } catch {
    return []
  }
}

function modelPolicyRows(definition: AgentDefinition): { label: string; value: string; tone: BadgeTone }[] {
  const policy = definition.runtime.modelPolicy || {}
  return [
    { label: 'Default', value: policy.default || definition.runtime.model || 'engine default', tone: 'blue' },
    { label: 'Cheap', value: policy.cheap || 'not set', tone: 'mute' },
    { label: 'Deep', value: policy.deep || 'not set', tone: 'accent' },
    { label: 'Judge', value: policy.judge || definition.quality.judge?.model || 'not set', tone: 'yellow' },
  ]
}

function QualityPanel({ quality }: { quality: AgentQuality }) {
  const criteria = quality.acceptanceCriteria || []
  const artifacts = quality.requiredArtifacts || []
  const checks = quality.deterministicChecks || []
  const judge = quality.judge
  return (
    <section className="border-b border-[var(--gt-border)]/60 p-4">
      <SectionKicker icon={CheckCircle2} title="Quality contract" />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Acceptance criteria</div>
          {criteria.length === 0 ? (
            <div className="text-[11px] text-zinc-600">No explicit criteria yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {criteria.map((item, i) => (
                <li key={`${i}-${item}`} className="flex gap-2 text-[11.5px] leading-snug text-zinc-300">
                  <CheckCircle2 size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-green)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Deterministic checks</div>
            {checks.length === 0 ? (
              <div className="text-[11px] text-zinc-600">No shell checks configured.</div>
            ) : (
              <div className="space-y-2">
                {checks.map((check) => (
                  <div key={check.id} className="rounded-md border border-[var(--gt-border)]/70 bg-black/20 p-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-zinc-200">{check.title}</span>
                      <Badge tone={check.required ? 'red' : 'mute'}>{check.required ? 'required' : 'optional'}</Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10.5px] text-zinc-500">{check.command}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Output judge</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={judge?.enabled ? 'accent' : 'mute'}>{judge?.enabled ? 'enabled' : 'off'}</Badge>
              <Badge tone="blue">{judge?.mode || 'deterministic'}</Badge>
              {judge?.passThreshold !== undefined && <Badge tone="yellow">{judge.passThreshold}% pass</Badge>}
            </div>
            {judge?.rubric?.length ? (
              <ul className="mt-2 space-y-1">
                {judge.rubric.map((item, i) => (
                  <li key={`${i}-${item}`} className="text-[11px] leading-snug text-zinc-500">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-[11px] text-zinc-600">No rubric configured.</div>
            )}
          </div>
          {artifacts.length > 0 && (
            <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Required artifacts</div>
              <div className="flex flex-wrap gap-1">
                {artifacts.map((artifact) => (
                  <Badge key={artifact} tone="accent">{artifact}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function DefinitionSummary({ definition }: { definition: AgentDefinition }) {
  const Icon = definition.kind === 'persistent' ? Brain : AGENT_ICON[definition.icon || ''] || Bot
  return (
    <section className="border-b border-[var(--gt-border)]/60 p-4">
      <SectionKicker icon={Icon} title="Agent profile" />
      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_220px]">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Runtime</div>
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">kind</span>
              <span className="capitalize">{definition.kind}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">mode</span>
              <span>{definition.runtime.mode}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">scope</span>
              <span>{definition.scope}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">engine</span>
              <span className="inline-flex items-center gap-1">
                <EngineLogo engine={definition.runtime.engine || 'codex'} size={10} />
                {engineLabel(definition.runtime.engine || 'codex')}
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            <Cpu size={12} strokeWidth={2.5} />
            Model policy
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {modelPolicyRows(definition).map((row) => (
              <div key={row.label} className="flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--gt-border)]/60 px-2 py-1">
                <Badge tone={row.tone}>{row.label}</Badge>
                <span className="min-w-0 truncate font-mono text-[10.5px] text-zinc-400">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            <Database size={12} strokeWidth={2.5} />
            Knowledge
          </div>
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">policy</span>
              <span>{definition.instructions.knowledgePolicy || 'standard'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">memory</span>
              <span>{definition.runtime.memoryDir ? 'persistent' : 'run-local'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">override</span>
              <span>{definition.runtime.modelPolicy?.allowOverride === false ? 'locked' : 'allowed'}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// Add / edit an agent. Saving writes <repo>/.agents/agents.json (overriding a
// built-in default = same id). The id is immutable once set.
function AgentDesigner({
  repoRoot,
  remote,
  onClose,
  onSpawned,
  onAdvanced,
}: {
  repoRoot: string
  remote?: TabContext['remoteSession']
  onClose: () => void
  onSpawned: (run: AgentRun) => void
  onAdvanced: () => void
}) {
  const [text, setText] = useState('')
  const [engine, setEngine] = useState<Engine>('claude')
  const [model, setModel] = useState<string | undefined>(undefined)
  const [launchMode, setLaunchMode] = useState<LaunchMode>('terminal')
  const [scope, setScope] = useState<'repo' | 'global'>('repo')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.gt.settings.get().then((s) => setEngine(s.defaultEngine))
  }, [])

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    if (launchMode === 'terminal') {
      openPromptInTerminal({
        engine,
        cwd: repoRoot,
        name: 'Design agent',
        prompt: `Design a new TerMinal agent for this repository from this request:\n\n${t}\n\nWrite the agent files according to this repo's .agents conventions, commit the result, and summarize what you created.`,
        remote,
      })
      onClose()
      return
    }
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
            {engineLabel(engine)} writes the prompt + saves it
          </span>
        </div>
        <SkillHint>
          You can also ask from the terminal with{' '}
          <code className="font-mono text-zinc-300">/new-agent "Create me an agent that …"</code> in Claude or{' '}
          <code className="font-mono text-zinc-300">$new-agent "Create me an agent that …"</code> in Codex.
        </SkillHint>
        <label className="flex flex-col gap-1">
          <div className="flex items-end justify-between">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Description</span>
            {/* Templates — single click prefills the textarea with a starting
                description that nudges the designer toward a specific shape. */}
            <div className="flex items-center gap-1 text-[10px] text-zinc-600">
              <span>start from:</span>
              {(
                [
                  {
                    label: 'precheck + escalate',
                    text:
                      'A scheduled agent that runs a deterministic precheck first (tsc, tests, lint) and only escalates to an LLM when something fails. On failure, diagnose the failures and apply a small surgical fix if safe, else file a backlog ticket. Default model: haiku.',
                  },
                  {
                    label: 'single LLM call',
                    text: 'A simple agent that runs a single selected-engine prompt to … (fill in the task). Opens a PR with the result. Default model: sonnet.',
                  },
                  {
                    label: 'pure deterministic',
                    text: 'A pure shell agent (no LLM) that runs … (fill in the check), files a HITL via terminal-cli only if a probe fails, and emits an activity event with the summary on success.',
                  },
                ] as const
              ).map((t) => (
                <button
                  key={t.label}
                  onClick={() => setText(t.text)}
                  className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 hover:border-[var(--gt-accent)]/60 hover:text-zinc-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
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
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Launch</span>
            <select
              value={launchMode}
              onChange={(e) => setLaunchMode(e.target.value as LaunchMode)}
              className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60 disabled:opacity-50"
            >
              <option value="terminal">{engineInstanceLabel(engine)} instance</option>
              <option value="process">Process</option>
            </select>
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
              {busy ? 'Spawning…' : launchMode === 'terminal' ? 'Open instance' : `Design with ${engineLabel(engine)}`}
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
  const [outputContract, setOutputContract] = useState(a?.outputContract || '')
  const [modelPolicyJson, setModelPolicyJson] = useState(
    JSON.stringify(
      a?.modelPolicy || {
        default: a?.model || '',
        cheap: '',
        deep: '',
        judge: '',
        allowOverride: true,
      },
      null,
      2,
    ),
  )
  const [qualityJson, setQualityJson] = useState(
    JSON.stringify(
      a?.quality || {
        acceptanceCriteria: a?.acceptanceCriteria || [],
        requiredArtifacts: [],
        deterministicChecks: [],
        judge: {
          enabled: false,
          mode: 'deterministic',
          rubric: [],
        },
      },
      null,
      2,
    ),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    let modelPolicy: AgentModelPolicy | undefined
    let quality: AgentQuality | undefined
    try {
      modelPolicy = modelPolicyJson.trim() ? (JSON.parse(modelPolicyJson) as AgentModelPolicy) : undefined
      quality = qualityJson.trim() ? (JSON.parse(qualityJson) as AgentQuality) : undefined
    } catch (e) {
      setErr((e as Error).message)
      return
    }
    setBusy(true)
    setErr('')
    const r = await window.gt.agents.save({
      id: id.trim(),
      title: title.trim(),
      description: description.trim(),
      engine,
      model: model.trim() || undefined,
      modelPolicy,
      quality,
      outputContract: outputContract.trim() || undefined,
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
        {isNew && (
          <SkillHint>
            You can also create one from the terminal with{' '}
            <code className="font-mono text-zinc-300">/new-agent "Create me an agent that …"</code> or{' '}
            <code className="font-mono text-zinc-300">$new-agent "Create me an agent that …"</code>.
          </SkillHint>
        )}
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
        <textarea
          value={outputContract}
          onChange={(e) => setOutputContract(e.target.value)}
          rows={2}
          placeholder="Output contract: what this agent should leave behind on a successful run"
          className={`${FIELD} resize-none leading-relaxed`}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Model policy JSON</span>
            <textarea
              value={modelPolicyJson}
              onChange={(e) => setModelPolicyJson(e.target.value)}
              rows={8}
              className={`${FIELD} resize-y font-mono leading-relaxed`}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Quality JSON</span>
            <textarea
              value={qualityJson}
              onChange={(e) => setQualityJson(e.target.value)}
              rows={8}
              className={`${FIELD} resize-y font-mono leading-relaxed`}
            />
          </label>
        </div>
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

type PersistentFileKey = keyof PersistentAgentFiles
type PersistentViewKey = PersistentFileKey | 'artifacts' | 'files'

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function PersistentAgentsPanel({ ctx }: { ctx: TabContext }) {
  const railW = useResizableWidth('gt.agentsRailWidth', 288, { min: 220, max: 520, edge: 'right' })
  const [agents, setAgents] = useState<PersistentAgent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem('gt.persistentAgents.sel'))
  const [detail, setDetail] = useState<PersistentAgentDetail | null>(null)
  const [query, setQuery] = useState('')
  const [task, setTask] = useState('')
  const [pickingRun, setPickingRun] = useState(false)
  const [fileKey, setFileKey] = useState<PersistentViewKey>('instructions')
  const [fileDraft, setFileDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMode, setCreateMode] = useState<'ai' | 'custom'>('ai')
  const [createRequest, setCreateRequest] = useState('')
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createEngine, setCreateEngine] = useState<Engine>('claude')
  const [createModel, setCreateModel] = useState<string | undefined>(undefined)
  const [createLaunchMode, setCreateLaunchMode] = useState<LaunchMode>('terminal')
  const [createBusy, setCreateBusy] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  const [err, setErr] = useState('')
  const [fileDir, setFileDir] = useState('')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [agentFilePath, setAgentFilePath] = useState('')
  const [agentFileContent, setAgentFileContent] = useState('')
  const [agentFileDirty, setAgentFileDirty] = useState(false)
  const [agentFileErr, setAgentFileErr] = useState('')
  const [artifacts, setArtifacts] = useState<PersistentArtifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)
  const [artifactBody, setArtifactBody] = useState<PersistentArtifactRead | null>(null)

  const loadList = () =>
    window.gt.persistentAgents.list().then((list) => {
      setAgents(list)
      setSelectedId((prev) => prev || list[0]?.id || null)
    })
  useEffect(() => {
    loadList()
    window.gt.settings.get().then((s) => setCreateEngine(s.defaultEngine)).catch(() => {})
  }, [])
  useEffect(() => {
    if (selectedId) localStorage.setItem('gt.persistentAgents.sel', selectedId)
    else localStorage.removeItem('gt.persistentAgents.sel')
    if (!selectedId) {
      setDetail(null)
      return
    }
    window.gt.persistentAgents.get(selectedId).then(setDetail)
  }, [selectedId])
  useEffect(() => {
    if (fileKey !== 'files' && fileKey !== 'artifacts') setFileDraft(detail?.files[fileKey] || '')
  }, [detail, fileKey])
  const refreshFiles = async (dir = fileDir) => {
    if (!detail) return
    setFileEntries(await window.gt.persistentAgents.files.list(detail.id, dir))
  }
  useEffect(() => {
    setFileDir('')
    setAgentFilePath('')
    setAgentFileContent('')
    setAgentFileDirty(false)
    if (detail) window.gt.persistentAgents.files.list(detail.id, '').then(setFileEntries)
  }, [detail?.id])
  useEffect(() => {
    if (!detail) {
      setArtifacts([])
      setSelectedArtifactId(null)
      setSelectedArtifactPath(null)
      setArtifactBody(null)
      return
    }
    window.gt.persistentAgents.artifacts.list(detail.id).then((list) => {
      setArtifacts(list)
      setSelectedArtifactId((prev) => prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || null)
    })
  }, [detail?.id, detail?.updatedAt])
  useEffect(() => {
    if (detail) refreshFiles(fileDir)
  }, [fileDir]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!detail || !selectedArtifactId) {
      setSelectedArtifactPath(null)
      setArtifactBody(null)
      return
    }
    const artifact = artifacts.find((a) => a.id === selectedArtifactId)
    const path = artifact?.primaryPath || artifact?.files.find((f) => f.name !== 'artifact.json')?.path || null
    setSelectedArtifactPath(path)
  }, [detail?.id, selectedArtifactId, artifacts])
  useEffect(() => {
    if (!detail || !selectedArtifactPath) {
      setArtifactBody(null)
      return
    }
    window.gt.persistentAgents.artifacts.read(detail.id, selectedArtifactPath).then(setArtifactBody)
  }, [detail?.id, selectedArtifactPath])

  const filtered = agents.filter((a) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [a.title, a.id, a.description || '', a.tags.join(' ')].some((v) => v.toLowerCase().includes(q))
  })
  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) || null
  const artifactFile = selectedArtifact?.files.find((f) => f.path === selectedArtifactPath) || null
  const refreshArtifacts = async () => {
    if (!detail) return
    const list = await window.gt.persistentAgents.artifacts.list(detail.id)
    setArtifacts(list)
    setSelectedArtifactId((prev) => prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || null)
  }
  const renderArtifactBody = () => {
    if (!selectedArtifact) {
      return <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">No artifacts yet.</div>
    }
    if (!selectedArtifactPath) {
      return <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">Select an artifact file.</div>
    }
    if (!artifactBody) {
      return <div className="p-4 text-[12px] text-zinc-600">Loading...</div>
    }
    if (!artifactBody.ok) {
      return <div className="p-4 text-[12px] text-[var(--gt-red)]">{artifactBody.reason}</div>
    }
    if (artifactBody.kind === 'markdown') {
      return (
        <div className="h-full overflow-auto p-5">
          <Markdown>{artifactBody.content}</Markdown>
        </div>
      )
    }
    if (artifactBody.kind === 'json') {
      let pretty = artifactBody.content
      try {
        pretty = JSON.stringify(JSON.parse(artifactBody.content), null, 2)
      } catch {
        /* keep raw */
      }
      return <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-[var(--gt-text-soft)]">{pretty}</pre>
    }
    if (artifactBody.kind === 'image' && artifactBody.dataUrl) {
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-[var(--gt-code-bg)] p-4">
          <img src={artifactBody.dataUrl} alt={artifactFile?.name || 'artifact'} className="max-h-full max-w-full object-contain" />
        </div>
      )
    }
    if (artifactBody.kind === 'html') {
      return <iframe sandbox="" srcDoc={artifactBody.content} className="h-full w-full border-0 bg-white" title={artifactFile?.name || 'artifact'} />
    }
    return <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-[var(--gt-text-soft)]">{artifactBody.content}</pre>
  }

  const create = async () => {
    const title = createTitle.trim()
    if (!title) return
    setErr('')
    const r = await window.gt.persistentAgents.save({
      title,
      description: createDescription,
      engine: createEngine,
      model: createModel,
    })
    if ('error' in r) {
      setErr(r.error)
      return
    }
    setCreating(false)
    setCreateTitle('')
    setCreateDescription('')
    setSelectedId(r.id)
    await loadList()
  }

  const launch = async (engine: Engine, model?: string, launchMode: LaunchMode = 'terminal') => {
    if (!detail) return
    if (launchMode === 'process') {
      const r = await window.gt.persistentAgents.run(detail.id, task, engine, model)
      if ('error' in r) {
        setErr(r.error)
        return
      }
      setTask('')
      await loadList()
      navigateTo('runs', { runId: r.id })
      return
    }
    const r = await window.gt.persistentAgents.launchPrompt(detail.id, task, ctx.repoRoot, engine, model)
    if ('error' in r) {
      setErr(r.error)
      return
    }
    openPromptInTerminal({
      engine,
      cwd: ctx.repoRoot,
      name: r.agent.title,
      prompt: r.prompt,
      remote: remoteForTabContext(ctx),
    })
    setTask('')
    await loadList()
  }

  const saveFile = async () => {
    if (!detail || fileKey === 'files' || fileKey === 'artifacts') return
    const r = await window.gt.persistentAgents.updateFile(detail.id, fileKey, fileDraft)
    if ('error' in r) {
      setErr(r.error)
      return
    }
    setDetail(r)
    await loadList()
  }
  const openAgentFile = async (path: string) => {
    if (!detail) return
    setAgentFilePath(path)
    const r = await window.gt.persistentAgents.files.read(detail.id, path)
    if (!r.ok) {
      setAgentFileContent('')
      setAgentFileErr(r.reason || 'unable to read file')
      setAgentFileDirty(false)
      return
    }
    setAgentFileContent(r.content)
    setAgentFileErr('')
    setAgentFileDirty(false)
  }
  const saveAgentFile = async () => {
    if (!detail || !agentFilePath || agentFileErr) return
    if (await window.gt.persistentAgents.files.write(detail.id, agentFilePath, agentFileContent)) {
      setAgentFileDirty(false)
      await refreshFiles()
      const fresh = await window.gt.persistentAgents.get(detail.id)
      if (fresh) setDetail(fresh)
    }
  }
  const design = async () => {
    const text = createRequest.trim()
    if (!text || createBusy) return
    setCreateBusy(true)
    setErr('')
    setCreateMsg('')
    try {
      if (createLaunchMode === 'terminal') {
        const prompt = `Create a new global persistent TerMinal memory agent from this request:

${text}

Target root:
~/.config/TerMinal/persistent-agents

Create exactly one new directory there with:
- agent.json
- INSTRUCTIONS.md
- MEMORY.md
- STATE.md
- JOURNAL.md
- artifacts/

Use the persistent agent schema TerMinal expects. Keep the files concise. Do not open a PR. Do not modify this repo unless explicitly needed. End with the created agent id and absolute directory path.`
        openPromptInTerminal({
          engine: createEngine,
          cwd: ctx.repoRoot,
          name: 'Design persistent agent',
          prompt,
          remote: remoteForTabContext(ctx),
        })
        setCreating(false)
        setCreateRequest('')
        return
      }
      const r = await window.gt.persistentAgents.design(text, createEngine, createModel)
      if ('error' in r) {
        setErr(r.error)
        return
      }
      setCreateMsg(`${engineLabel(createEngine)} is creating the persistent agent`)
      setCreating(false)
      setCreateRequest('')
      navigateTo('runs', { runId: r.id })
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30" style={{ width: railW.width }}>
        <div className="space-y-1.5 border-b border-[var(--gt-border)] p-2">
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search persistent agents…"
              className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
            />
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
            >
              <Plus size={12} strokeWidth={2.5} />
              New
            </button>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] p-2 text-[10.5px] leading-4 text-zinc-500">
            Global memory agents live in <span className="font-mono">~/.config/TerMinal/persistent-agents</span>.
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-3 text-[11px] text-zinc-600">No persistent agents yet.</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-2.5 py-2 text-left ${
                  selectedId === a.id ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                }`}
              >
                <Bot size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-zinc-100">{a.title}</span>
                  <span className="block truncate text-[10.5px] text-zinc-600">
                    {a.lastRunAt ? `ran ${fmtRelative(a.lastRunAt)}` : a.description || a.id}
                  </span>
                </span>
                <EngineLogo engine={a.engine} size={12} className="opacity-80" />
              </button>
            ))
          )}
        </nav>
      </aside>
      <ResizeHandle onMouseDown={railW.onResizeStart} />

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
            Create or select a persistent agent.
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-3">
              <Bot size={18} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <h2 className="text-[14px] font-bold text-zinc-100">{detail.title}</h2>
              <span className="font-mono text-[10px] text-zinc-600">{detail.id}</span>
              <EngineLogo engine={detail.engine} size={13} />
              {detail.model && <span className="text-[10px] text-zinc-600">{detail.model}</span>}
              <div className="flex-1" />
              <button
                onClick={() => setFileKey('files')}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
              >
                <FolderOpen size={12} strokeWidth={2} />
                Files
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete persistent agent "${detail.title}"?`)) return
                  await window.gt.persistentAgents.remove(detail.id)
                  setSelectedId(null)
                  setDetail(null)
                  await loadList()
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </header>
            {detail.description && (
              <div className="border-b border-[var(--gt-border)]/60 px-5 py-2 text-[12px] text-zinc-400">
                {detail.description}
              </div>
            )}
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--gt-border)] p-3">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={3}
                placeholder="Task for this run. Leave blank to continue current STATE.md."
                className="resize-none rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
              />
              <button
                onClick={() => setPickingRun(true)}
                className="inline-flex h-full min-w-28 items-center justify-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90"
              >
                <Play size={13} strokeWidth={2.5} />
                Run
              </button>
            </div>
            {err && <div className="border-b border-[var(--gt-border)] px-5 py-2 text-[11px] text-[var(--gt-red)]">{err}</div>}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-3 py-1.5">
                {(['instructions', 'memory', 'state', 'journal', 'artifacts', 'files'] as PersistentViewKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFileKey(k)}
                    className={`rounded-md px-2 py-1 text-[11px] capitalize ${
                      fileKey === k ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                    }`}
                  >
                    {k}
                  </button>
                ))}
                <div className="flex-1" />
                {fileKey === 'artifacts' ? (
                  <button
                    onClick={refreshArtifacts}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                  >
                    Refresh
                  </button>
                ) : fileKey === 'files' ? (
                  <button
                    onClick={saveAgentFile}
                    disabled={!agentFilePath || !agentFileDirty || !!agentFileErr}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60 disabled:opacity-40"
                  >
                    Save scoped file
                  </button>
                ) : (
                  <button
                    onClick={saveFile}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                  >
                    Save file
                  </button>
                )}
              </div>
              {fileKey === 'artifacts' ? (
                <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30">
                    {artifacts.length === 0 ? (
                      <div className="p-4 text-[12px] leading-relaxed text-zinc-600">
                        No artifacts yet. Persistent agents should write durable output to{' '}
                        <span className="font-mono">artifacts/&lt;run&gt;/report.md</span>.
                      </div>
                    ) : (
                      artifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          onClick={() => setSelectedArtifactId(artifact.id)}
                          className={`block w-full border-b border-[var(--gt-border)]/50 px-3 py-2 text-left ${
                            selectedArtifactId === artifact.id ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <ClipboardList size={12} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">{artifact.title}</span>
                            <Badge tone="blue">{artifact.kind}</Badge>
                          </div>
                          {artifact.summary && (
                            <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-zinc-500">{artifact.summary}</div>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                            <span>{fmtRelative(artifact.createdAt)}</span>
                            <span>{artifact.files.length} file{artifact.files.length === 1 ? '' : 's'}</span>
                            {artifact.runId && <span className="truncate font-mono">{artifact.runId.slice(0, 8)}</span>}
                          </div>
                        </button>
                      ))
                    )}
                  </aside>
                  <section className="flex min-w-0 flex-col">
                    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">
                        {selectedArtifact?.title || 'Artifacts'}
                      </span>
                      {artifactFile && (
                        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                          {artifactFile.name} · {fmtBytes(artifactFile.size)}
                        </span>
                      )}
                    </div>
                    {selectedArtifact && selectedArtifact.files.length > 1 && (
                      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--gt-border)] px-2 py-1">
                        {selectedArtifact.files.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => setSelectedArtifactPath(file.path)}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10.5px] ${
                              selectedArtifactPath === file.path
                                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                            }`}
                          >
                            <FileText size={11} strokeWidth={2} />
                            <span className="max-w-[180px] truncate">{file.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="min-h-0 flex-1 bg-[var(--gt-code-bg)]">{renderArtifactBody()}</div>
                  </section>
                </div>
              ) : fileKey === 'files' ? (
                <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30">
                    <div className="flex items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
                      <button
                        onClick={() => setFileDir(fileDir.includes('/') ? fileDir.slice(0, fileDir.lastIndexOf('/')) : '')}
                        disabled={!fileDir}
                        className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 disabled:opacity-40"
                      >
                        Up
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600">/{fileDir}</span>
                      <button
                        onClick={async () => {
                          if (!detail) return
                          const name = prompt('New file name')
                          if (!name) return
                          const rel = fileDir ? `${fileDir}/${name}` : name
                          await window.gt.persistentAgents.files.create(detail.id, rel, false)
                          await refreshFiles()
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                        title="New file"
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!detail) return
                          const name = prompt('New folder name')
                          if (!name) return
                          const rel = fileDir ? `${fileDir}/${name}` : name
                          await window.gt.persistentAgents.files.create(detail.id, rel, true)
                          await refreshFiles()
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                        title="New folder"
                      >
                        <FolderOpen size={12} strokeWidth={2} />
                      </button>
                    </div>
                    {fileEntries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => (entry.dir ? setFileDir(entry.path) : openAgentFile(entry.path))}
                        className={`group flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/40 px-2 py-1.5 text-left text-[11px] ${
                          agentFilePath === entry.path ? 'bg-[var(--gt-accent)]/15 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                        }`}
                      >
                        {entry.dir ? <FolderOpen size={12} strokeWidth={2} /> : <FileText size={12} strokeWidth={2} />}
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {!entry.dir && !['agent.json', 'INSTRUCTIONS.md', 'MEMORY.md', 'STATE.md', 'JOURNAL.md'].includes(entry.path) && (
                          <span
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!detail || !confirm(`Delete ${entry.path}?`)) return
                              await window.gt.persistentAgents.files.del(detail.id, entry.path)
                              if (agentFilePath === entry.path) {
                                setAgentFilePath('')
                                setAgentFileContent('')
                              }
                              await refreshFiles()
                            }}
                            className="hidden rounded p-0.5 text-zinc-600 hover:text-[var(--gt-red)] group-hover:inline-flex"
                          >
                            <Trash2 size={10} strokeWidth={2} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-zinc-500">
                        {agentFilePath || 'Select a file'}
                      </span>
                      {agentFileDirty && <span className="text-[10px] text-[var(--gt-yellow)]">unsaved</span>}
                    </div>
                    {agentFileErr ? (
                      <div className="p-4 text-[12px] text-[var(--gt-red)]">{agentFileErr}</div>
                    ) : (
                      <div className="min-h-0 flex-1">
                        <CodeEditor
                          value={agentFileContent}
                          onChange={(v) => {
                            setAgentFileContent(v)
                            setAgentFileDirty(true)
                          }}
                          editable={!!agentFilePath}
                          extensions={langForAgentFile(agentFilePath)}
                          wrap
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    value={fileDraft}
                    onChange={setFileDraft}
                    extensions={langForAgentFile(
                      fileKey === 'instructions'
                        ? 'INSTRUCTIONS.md'
                        : fileKey === 'memory'
                          ? 'MEMORY.md'
                          : fileKey === 'state'
                            ? 'STATE.md'
                            : 'JOURNAL.md',
                    )}
                    wrap
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {pickingRun && detail && (
        <EnginePicker
          title={`Run persistent · ${detail.title}`}
          showPersona={false}
          showPipeline={false}
          hint={
            <>
              Runs from the current workspace repo, while reading and updating this agent's global memory files under{' '}
              <code className="font-mono text-zinc-300">~/.config/TerMinal/persistent-agents/{detail.id}</code>.
            </>
          }
          onClose={() => setPickingRun(false)}
          onPick={(engine, _persona, _pipeline, model, launchMode) => {
            setPickingRun(false)
            launch(engine, model, launchMode || 'terminal')
          }}
        />
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setCreating(false)}>
          <div
            className="w-[640px] max-w-full rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100">New persistent agent</h2>
              <div className="ml-auto flex items-center rounded-lg border border-[var(--gt-border)] bg-black/20 p-0.5">
                {(['ai', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCreateMode(mode)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase ${
                      createMode === mode
                        ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {createMode === 'ai' ? (
                <>
                  <SkillHint>
                    You can also create one from a terminal with{' '}
                    <code className="font-mono text-zinc-300">/new-persistent-agent "Create a memory agent that …"</code>{' '}
                    or <code className="font-mono text-zinc-300">$new-persistent-agent "Create a memory agent that …"</code>.
                  </SkillHint>
                  <textarea
                    value={createRequest}
                    onChange={(e) => setCreateRequest(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') design()
                    }}
                    rows={6}
                    autoFocus
                    placeholder="Describe the persistent agent: what it should remember, what it should do over time, and what good state/memory should look like."
                    className={`${FIELD} resize-none`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <EngineModelPicker
                      engine={createEngine}
                      model={createModel}
                      onChange={(e, m) => {
                        setCreateEngine(e)
                        setCreateModel(m)
                      }}
                      size="sm"
                    />
                    <select
                      value={createLaunchMode}
                      onChange={(e) => setCreateLaunchMode(e.target.value as LaunchMode)}
                      className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                    >
                      <option value="terminal">{engineInstanceLabel(createEngine)} instance</option>
                      <option value="process">Process</option>
                    </select>
                    {createMsg && <span className="text-[11px] text-[var(--gt-green)]">{createMsg}</span>}
                  </div>
                </>
              ) : (
                <>
                  <input
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="Agent name"
                    autoFocus
                    className={FIELD}
                  />
                  <textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    rows={4}
                    placeholder="What should this agent remember and improve over time?"
                    className={`${FIELD} resize-none`}
                  />
                  <EngineModelPicker
                    engine={createEngine}
                    model={createModel}
                    onChange={(e, m) => {
                      setCreateEngine(e)
                      setCreateModel(m)
                    }}
                    size="sm"
                  />
                </>
              )}
              {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-md border border-[var(--gt-border)] px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={createMode === 'ai' ? design : create}
                  disabled={createMode === 'ai' ? !createRequest.trim() || createBusy : !createTitle.trim()}
                  className="rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {createMode === 'ai'
                    ? createBusy
                      ? 'Spawning...'
                      : createLaunchMode === 'terminal'
                        ? 'Open instance'
                        : 'Create with AI'
                    : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentsTab({ ctx }: { ctx: TabContext }) {
  const railW = useResizableWidth('gt.agentsRailWidth', 320, { min: 240, max: 560, edge: 'right' })
  const [agentMode, setAgentMode] = useState<'all' | 'classic' | 'persistent'>(() => {
    const saved = localStorage.getItem('gt.agents.mode')
    return saved === 'classic' || saved === 'persistent' || saved === 'all' ? saved : 'all'
  })
  const [definitions, setDefinitions] = useState<AgentDefinition[] | null>(null)
  const [selDefinitionId, setSelDefinitionId] = useState<string | null>(
    () => localStorage.getItem('gt.agents.definitionSel') || null,
  )
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [picking, setPicking] = useState<{ id: string; title: string } | null>(null)
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  // Persist UI position across reloads so coming back to the tab lands on the
  // same agent/filter/search. Cheap localStorage; the values are tiny strings.
  const [agentFilter, setAgentFilter] = useState<'all' | 'generic' | 'per-repo'>(
    () => (localStorage.getItem('gt.agents.filter') as 'all' | 'generic' | 'per-repo') || 'all',
  )
  const [definitionFilter, setDefinitionFilter] = useState<'all' | 'classic' | 'persistent'>(
    () => (localStorage.getItem('gt.agents.definitionFilter') as 'all' | 'classic' | 'persistent') || 'all',
  )
  const [agentSearch, setAgentSearch] = useState<string>(
    () => localStorage.getItem('gt.agents.search') || '',
  )
  const [selAgentId, setSelAgentId] = useState<string | null>(
    () => localStorage.getItem('gt.agents.sel') || null,
  )
  // Detail view is split into horizontal tabs (contract first). Reset to the
  // default tab whenever the selected agent changes.
  const [detailTab, setDetailTab] = useState<'overview' | 'profile' | 'source' | 'runs'>('overview')
  useEffect(() => setDetailTab('overview'), [selAgentId])
  useEffect(() => {
    localStorage.setItem('gt.agents.filter', agentFilter)
  }, [agentFilter])
  useEffect(() => {
    localStorage.setItem('gt.agents.definitionFilter', definitionFilter)
  }, [definitionFilter])
  useEffect(() => {
    localStorage.setItem('gt.agents.mode', agentMode)
  }, [agentMode])
  useEffect(() => {
    if (selDefinitionId) localStorage.setItem('gt.agents.definitionSel', selDefinitionId)
    else localStorage.removeItem('gt.agents.definitionSel')
  }, [selDefinitionId])
  useEffect(() => {
    localStorage.setItem('gt.agents.search', agentSearch)
  }, [agentSearch])
  useEffect(() => {
    if (selAgentId) localStorage.setItem('gt.agents.sel', selAgentId)
    else localStorage.removeItem('gt.agents.sel')
  }, [selAgentId])
  const [designerOpen, setDesignerOpen] = useState(false)
  const [scripts, setScripts] = useState<Record<string, { path: string; body: string } | null>>({})
  const logRef = useRef<HTMLPreElement>(null)

  const reloadDefinitions = () =>
    window.gt.agents.definitions().then((defs) => {
      setDefinitions(defs)
      setSelDefinitionId((prev) => (prev && defs.some((d) => d.id === prev) ? prev : defs[0]?.id || null))
    })
  const reloadAgents = () => {
    window.gt.agents.list().then(setAgents)
    reloadDefinitions()
  }
  // Lazy-load the bash script body the first time we need it; cache the
  // result (including null when definitively no script exists) so we don't
  // re-hit IPC. Triggered on agent select (new master-detail layout) and on
  // expand toggle (legacy paths).
  const loadScript = (id: string) => {
    if (id in scripts) return
    window.gt.agents.script(id).then((r) => setScripts((m) => ({ ...m, [id]: r })))
  }
  // Auto-load script when an agent is selected so the right pane's Script
  // section can show "Loading…" → bash / prompt without a manual click.
  useEffect(() => {
    if (selAgentId) loadScript(selAgentId)
  }, [selAgentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-source last-run status per agent. We already have in-process runs
  // in `runs`; for cron runs, fetch via the unified endpoint so the left rail
  // also covers schedule-fired runs. Refresh on activity:event so a freshly
  // finished cron run updates the status dot immediately.
  const [allRuns, setAllRuns] = useState<
    { id: string; agentId: string; status: string; startedAt: number; endedAt?: number }[]
  >([])
  // Per-agent week-spend from the AI ledger (#0001). Joined into the
  // Recent-runs header so the operator sees "Sonnet eats $4 this week"
  // without flipping to the Spend tab.
  const [agentSpendWeek, setAgentSpendWeek] = useState<
    Record<string, { runs: number; usd: number }>
  >({})
  useEffect(() => {
    const load = () =>
      window.gt.observability.byAgent('week').then((rows) => {
        const m: Record<string, { runs: number; usd: number }> = {}
        for (const r of rows) m[r.agentId] = { runs: r.runs, usd: r.usd }
        setAgentSpendWeek(m)
      })
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const load = () => window.gt.agents.allRuns().then(setAllRuns)
    load()
    const off = window.gt.activity.onEvent(load)
    const t = setInterval(load, 30_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  const lastRunByAgent = useMemo(() => {
    const m = new Map<string, { status: string; startedAt: number }>()
    // allRuns is already startedAt-desc; first hit per agent wins.
    for (const r of allRuns) {
      if (!m.has(r.agentId)) m.set(r.agentId, { status: r.status, startedAt: r.startedAt })
    }
    return m
  }, [allRuns])

  // Per-(repo, agent) state sidecar. Surfaced in the right pane so the
  // operator can see "last scanned X ago" without `cat`-ing the JSON.
  // Re-fetched on select + after a successful run completes (the agent
  // would normally call `terminal-cli state mark-main` at exit).
  const [state, setState] = useState<{
    path: string
    exists: boolean
    state: Record<string, unknown>
  } | null>(null)
  const reloadState = (id: string | null) => {
    if (!id) return setState(null)
    window.gt.agents.state(id).then(setState)
  }
  useEffect(() => {
    reloadState(selAgentId)
  }, [selAgentId])
  // Bump the state view when ANY run for the selected agent finishes — the
  // run almost certainly wrote a new lastScannedSha/lastRunAt.
  //
  // onStatus only fires for IN-PROCESS runs (Run button on this tab, on
  // Tickets, on PRs). Cron runs fire from launchd; their completion never
  // reaches the renderer that way. We ALSO listen on activity:event because
  // every cron run's `check`/`run-failed` activity emit lands here regardless
  // of who started it. The state IPC is one file read — re-running it on
  // every activity tick is dirt-cheap.
  useEffect(() => {
    const offStatus = window.gt.agents.onStatus((run) => {
      const r = run as { agentId?: string; status?: string }
      if (r.agentId === selAgentId && (r.status === 'done' || r.status === 'failed')) {
        reloadState(selAgentId)
      }
    })
    const offAct = window.gt.activity.onEvent(() => {
      if (selAgentId) reloadState(selAgentId)
    })
    return () => {
      offStatus()
      offAct()
    }
  }, [selAgentId])
  useEffect(() => {
    reloadAgents()
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
      // saved entry shows up without a manual refresh — then auto-expand
      // the new agent and load its script so the bash body is immediately
      // visible (closes the loop on the "describe it → see the script" flow).
      if (
        (run.agentId === 'design-repo' || run.agentId === 'design-global') &&
        run.status === 'done'
      ) {
        const priorIds = new Set((agents || []).map((a) => a.id))
        window.gt.agents.list().then((next) => {
          setAgents(next)
          reloadDefinitions()
          const fresh = next.find((a) => !priorIds.has(a.id))
          if (!fresh) return
          setAgentMode('all')
          setSelAgentId(fresh.id)
          setSelDefinitionId(`classic:${fresh.source === 'global' || fresh.source === 'global-override' ? 'global' : 'repo'}:${fresh.id}`)
          window.gt.agents
            .script(fresh.id)
            .then((r) => setScripts((m) => ({ ...m, [fresh.id]: r })))
        })
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

  const selectedRun = runs.find((r) => r.id === sel) || null
  const runningByAgent = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)),
    [runs],
  )
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sel, selectedRun && outputs[selectedRun.id]])
  const selectedDefinition = useMemo(
    () => (definitions || []).find((d) => d.id === selDefinitionId) || null,
    [definitions, selDefinitionId],
  )
  useEffect(() => {
    if (agentMode === 'all' && selectedDefinition?.kind === 'classic' && selectedDefinition.ref.id !== selAgentId) {
      setSelAgentId(selectedDefinition.ref.id)
    }
  }, [agentMode, selectedDefinition, selAgentId])

  const run = async (id: string, engine: Engine, persona: string, pipeline: string, model?: string, openrouterHarness?: 'codex' | 'hermes', extraContext?: string) => {
    const r = await window.gt.agents.run(id, engine, persona, pipeline, model, remoteForTabContext(ctx), openrouterHarness, extraContext)
    if ('error' in r) {
      setOutputs((o) => ({ ...o, __err: r.error }))
      return
    }
    setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
    setSel(r.id)
  }

  const activeRunCount = runs.filter((r) => r.status === 'running').length
  const repoLabel = ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')

  const header = (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/25 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/25">
          <Bot size={15} strokeWidth={2.25} className="text-[var(--gt-accent-light)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-100">Agents</span>
            <span className="truncate font-mono text-[10.5px] text-zinc-600">{repoLabel}</span>
          </div>
          <div className="text-[10.5px] text-zinc-600">Run definitions, memory agents, model policy, and quality gates</div>
        </div>
      </div>
      {activeRunCount > 0 && <Badge tone="green">{activeRunCount} running</Badge>}
      <div className="ml-auto flex items-center rounded-lg border border-[var(--gt-border)] bg-black/20 p-0.5">
        {(['all', 'classic', 'persistent'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setAgentMode(mode)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize ${
              agentMode === mode
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  )

  if (agentMode === 'persistent') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
        {header}
        <PersistentAgentsPanel ctx={ctx} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      {header}

      <div className="flex min-h-0 flex-1">
        {/* ━━ LEFT RAIL: narrow agents list (search + filter + click-to-select) ━━ */}
        <aside className="flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30" style={{ width: railW.width }}>
          <div className="shrink-0 space-y-2 border-b border-[var(--gt-border)] p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder={agentMode === 'all' ? 'Search all agents…' : 'Search classic agents…'}
                className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
              />
              <button
                onClick={() => setDesignerOpen(true)}
                title="Design a new agent — describe what it does, the selected engine writes the bash"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
              >
                <Plus size={12} strokeWidth={2.5} />
                New
              </button>
            </div>
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] bg-black/15 p-0.5">
              {agentMode === 'all'
                ? (['all', 'classic', 'persistent'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setDefinitionFilter(f)}
                      className={`flex-1 rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${
                        definitionFilter === f
                          ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))
                : (['all', 'generic', 'per-repo'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setAgentFilter(f)}
                      className={`flex-1 rounded-sm px-1.5 py-0.5 text-[10px] capitalize ${
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
          <nav className="min-h-0 flex-1 overflow-y-auto">
            {agentMode === 'all' ? (
              definitions === null ? (
                <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
              ) : (
                (() => {
                  const q = agentSearch.trim().toLowerCase()
                  const list = definitions
                    .filter((d) => definitionFilter === 'all' || d.kind === definitionFilter)
                    .filter(
                      (d) =>
                        !q ||
                        d.ref.id.toLowerCase().includes(q) ||
                        d.title.toLowerCase().includes(q) ||
                        (d.description || '').toLowerCase().includes(q) ||
                        (d.metadata.tags || []).join(' ').toLowerCase().includes(q),
                    )
                  if (list.length === 0)
                    return <div className="p-3 text-[11px] text-zinc-600">No agents match.</div>
                  return list.map((d) => {
                    const Icon = d.kind === 'persistent' ? Brain : AGENT_ICON[d.icon || ''] || Bot
                    const on = selDefinitionId === d.id
                    const busy = d.kind === 'classic' && runningByAgent.has(d.ref.id)
                    const last = busy || d.kind !== 'classic' ? null : lastRunByAgent.get(d.ref.id) || null
                    const dot = busy
                      ? 'bg-[var(--gt-green)] gt-pulse'
                      : last?.status === 'done'
                        ? 'bg-[var(--gt-green)]'
                        : last?.status === 'failed'
                          ? 'bg-[var(--gt-red)]'
                          : d.metadata.lastRunAt
                            ? 'bg-[var(--gt-accent-light)]'
                            : ''
                    const dotTitle = busy
                      ? 'run in progress'
                      : last
                        ? `last run: ${last.status} · ${fmtRelative(last.startedAt)}`
                        : d.metadata.lastRunAt
                          ? `last persistent run: ${fmtRelative(d.metadata.lastRunAt)}`
                          : ''
                    return (
                      <button
                        key={d.id}
                        onClick={() => {
                          setSelDefinitionId(d.id)
                          if (d.kind === 'classic') setSelAgentId(d.ref.id)
                          if (d.kind === 'persistent') localStorage.setItem('gt.persistentAgents.sel', d.ref.id)
                        }}
                        title={d.description || d.title}
                        className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-1.5 text-left ${
                          on ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                        }`}
                      >
                        <Icon
                          size={13}
                          strokeWidth={2}
                          className={`shrink-0 ${
                            on ? 'text-[var(--gt-accent-light)]' : d.kind === 'persistent' ? 'text-[var(--gt-accent-light)]/60' : 'text-zinc-500'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">{d.title}</span>
                        {d.runtime.force && <ForceChip />}
                        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} title={dotTitle} />}
                      </button>
                    )
                  })
                })()
              )
            ) : agents === null ? (
              <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
            ) : (
              (() => {
                const q = agentSearch.trim().toLowerCase()
                const list = agents
                  .filter((a) => {
                    if (agentFilter === 'generic') return a.source === 'default'
                    if (agentFilter === 'per-repo') return a.source === 'repo-override' || a.source === 'repo'
                    return true
                  })
                  .filter(
                    (a) =>
                      !q ||
                      a.id.toLowerCase().includes(q) ||
                      a.title.toLowerCase().includes(q) ||
                      (a.description || '').toLowerCase().includes(q),
                  )
                if (list.length === 0)
                  return <div className="p-3 text-[11px] text-zinc-600">No agents match.</div>
                return list.map((a) => {
                  const Icon = AGENT_ICON[a.icon || ''] || Bot
                  const on = selAgentId === a.id
                  const busy = runningByAgent.has(a.id)
                  const last = busy ? null : lastRunByAgent.get(a.id) || null
                  const dot = busy
                    ? 'bg-[var(--gt-green)] gt-pulse'
                    : last?.status === 'done'
                      ? 'bg-[var(--gt-green)]'
                      : last?.status === 'failed'
                        ? 'bg-[var(--gt-red)]'
                        : last
                          ? 'bg-zinc-500'
                          : ''
                  const dotTitle = busy
                    ? 'run in progress'
                    : last
                      ? `last run: ${last.status} · ${fmtRelative(last.startedAt)}`
                      : ''
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelAgentId(a.id)}
                      title={a.description || a.title}
                      className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-1.5 text-left ${
                        on ? 'bg-[var(--gt-accent)]/15' : 'hover:bg-white/5'
                      }`}
                    >
                      <Icon
                        size={13}
                        strokeWidth={2}
                        className={`shrink-0 ${
                          on ? 'text-[var(--gt-accent-light)]' : 'text-zinc-500'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">{a.title}</span>
                      {a.force && <ForceChip />}
                      {dot && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
                          title={dotTitle}
                        />
                      )}
                    </button>
                  )
                })
              })()
            )}
          </nav>
        </aside>
        <ResizeHandle onMouseDown={railW.onResizeStart} />

        {/* ━━ RIGHT PANE: selected-agent detail (header + script + runs + log) ━━ */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {(() => {
            if (agentMode === 'all' && !selectedDefinition) {
              return (
                <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                  Pick an agent on the left, or click <span className="mx-1 font-semibold text-zinc-400">New</span>{' '}
                  to design one.
                </div>
              )
            }
            if (agentMode === 'all' && selectedDefinition?.kind === 'persistent') {
              return (
                <>
                  <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-3">
                    <Brain size={18} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                    <h2 className="text-[14px] font-bold text-zinc-100">{selectedDefinition.title}</h2>
                    <Badge tone="accent">persistent</Badge>
                    <Badge tone="blue">{selectedDefinition.scope}</Badge>
                    <span className="font-mono text-[10px] text-zinc-600">{selectedDefinition.ref.id}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => {
                        localStorage.setItem('gt.persistentAgents.sel', selectedDefinition.ref.id)
                        setAgentMode('persistent')
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90"
                    >
                      <Database size={13} strokeWidth={2.5} />
                      Open memory workspace
                    </button>
                  </header>
                  {selectedDefinition.description && (
                    <div className="shrink-0 border-b border-[var(--gt-border)]/60 px-5 py-2 text-[12px] text-zinc-400">
                      {selectedDefinition.description}
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <DefinitionSummary definition={selectedDefinition} />
                    <section className="border-b border-[var(--gt-border)]/60 p-4">
                      <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        <Brain size={12} strokeWidth={2.5} className="text-[var(--gt-accent-light)]" />
                        Memory surface
                      </h3>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {[
                          ['INSTRUCTIONS.md', 'Stable role and operating contract.'],
                          ['MEMORY.md', 'Durable preferences, facts, and lessons.'],
                          ['STATE.md', 'Current open thread, status, and next actions.'],
                          ['JOURNAL.md', 'Append-only history of runs and decisions.'],
                        ].map(([title, body]) => (
                          <div key={title} className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
                            <div className="font-mono text-[11px] font-semibold text-zinc-200">{title}</div>
                            <div className="mt-1 text-[11px] leading-snug text-zinc-500">{body}</div>
                          </div>
                        ))}
                      </div>
                      {selectedDefinition.runtime.memoryDir && (
                        <div className="mt-3 truncate rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 font-mono text-[10.5px] text-zinc-500">
                          {selectedDefinition.runtime.memoryDir}
                        </div>
                      )}
                    </section>
                    <QualityPanel quality={selectedDefinition.quality} />
                    <section className="p-4">
                      <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        <ClipboardList size={12} strokeWidth={2.5} className="text-[var(--gt-accent-light)]" />
                        Artifact contract
                      </h3>
                      <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[11.5px] leading-relaxed text-zinc-400">
                        Persistent agents should write durable outputs under{' '}
                        <code className="font-mono text-zinc-300">artifacts/&lt;run&gt;/</code> and keep memory files current before ending.
                        The memory workspace view exposes the full file browser, artifact previewer, and run controls for this agent.
                      </div>
                    </section>
                  </div>
                </>
              )
            }
            const selectedAgent =
              (agents || []).find((a) => a.id === (agentMode === 'all' ? selectedDefinition?.ref.id : selAgentId)) || null
            if (!selectedAgent)
              return (
                <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
                  Pick an agent on the left, or click <span className="mx-1 font-semibold text-zinc-400">New</span>{' '}
                  to design one.
                </div>
              )
            const Icon = AGENT_ICON[selectedAgent.icon || ''] || Bot
            const busy = runningByAgent.has(selectedAgent.id)
            const script = scripts[selectedAgent.id]
            const agentRuns = runs.filter((r) => r.agentId === selectedAgent.id)
            const activeDefinition =
              selectedDefinition?.kind === 'classic' && selectedDefinition.ref.id === selectedAgent.id
                ? selectedDefinition
                : (definitions || []).find((d) => d.kind === 'classic' && d.ref.id === selectedAgent.id) || null
            return (
              <>
                {/* Agent header — title + actions */}
                <header className="shrink-0 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/20 px-5 py-4">
                  <div className="flex min-w-0 flex-wrap items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/25">
                      <Icon size={19} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="min-w-0 truncate text-[15px] font-bold text-zinc-100">{selectedAgent.title}</h2>
                        {selectedAgent.force && <ForceChip size="md" />}
                        {selectedAgent.source && (
                          <Badge tone={SOURCE[selectedAgent.source].tone}>{SOURCE[selectedAgent.source].label}</Badge>
                        )}
                        {selectedAgent.hasScript && <Badge tone="blue">script</Badge>}
                        <span className="font-mono text-[10px] text-zinc-600">{selectedAgent.id}</span>
                      </div>
                      {selectedAgent.description && (
                        <div className="mt-1 max-w-4xl text-[12px] leading-relaxed text-zinc-400">{selectedAgent.description}</div>
                      )}
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <EngineLogo engine={selectedAgent.engine || 'codex'} size={11} />
                          {engineLabel(selectedAgent.engine || 'codex')}
                        </span>
                        {selectedAgent.model && (
                          <span className="font-mono text-zinc-600">· {selectedAgent.model}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <button
                        onClick={() => setPicking({ id: selectedAgent.id, title: selectedAgent.title })}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
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
                      {script && (
                        <button
                          onClick={() => window.gt.openInEditor(script.path)}
                          title="Edit the .sh in your configured editor"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                        >
                          <Pencil size={11} strokeWidth={2} />
                          Script
                        </button>
                      )}
                      <button
                        onClick={() => setEditing(selectedAgent)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-accent)]/60"
                        title="Edit the metadata sidecar (title/icon/engine/etc.)"
                      >
                        <Pencil size={11} strokeWidth={2} />
                        Metadata
                      </button>
                      {selectedAgent.source === 'repo-override' && (
                        <button
                          onClick={async () => {
                            await window.gt.agents.reset(selectedAgent.id)
                            reloadAgents()
                          }}
                          title="Revert to the built-in default"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-yellow)]/60 hover:text-[var(--gt-yellow)]"
                        >
                          <RotateCcw size={11} strokeWidth={2} />
                          Reset
                        </button>
                      )}
                      {selectedAgent.source === 'default' && (
                        <button
                          onClick={async () => {
                            await window.gt.presets.hide('agents', selectedAgent.id)
                            reloadAgents()
                          }}
                          title="Hide this built-in preset"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-yellow)]/60 hover:text-[var(--gt-yellow)]"
                        >
                          <EyeOff size={11} strokeWidth={2} />
                          Hide
                        </button>
                      )}
                    </div>
                  </div>
                </header>

                {/* Detail tabs — contract first (the substance), then config,
                    execution source, and run history. */}
                <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/20 px-4 py-1.5">
                  {(
                    [
                      ['overview', 'Overview'],
                      ['profile', 'Profile'],
                      ['source', 'Source'],
                      ['runs', 'Runs'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setDetailTab(id)}
                      className={`inline-flex items-center rounded-md px-3 py-1 text-[12px] font-medium ${
                        detailTab === id ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                      {id === 'runs' && agentRuns.length > 0 && <span className="ml-1 text-zinc-600">· {agentRuns.length}</span>}
                    </button>
                  ))}
                </div>

                {/* Scrollable body — one tab's sections at a time */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {detailTab === 'overview' &&
                    (activeDefinition ? (
                      <QualityPanel quality={activeDefinition.quality} />
                    ) : (
                      <div className="p-6 text-[12px] text-zinc-600">No structured quality contract for this agent.</div>
                    ))}
                  {detailTab === 'profile' &&
                    (activeDefinition ? (
                      <DefinitionSummary definition={activeDefinition} />
                    ) : (
                      <div className="p-6 text-[12px] text-zinc-600">No structured profile for this agent.</div>
                    ))}
                  {detailTab === 'source' && (
                    <>
                  {/* Script preview — script can be undefined (loading), null
                      (definitively no .sh), or {path,body} (script loaded). */}
                  <section className="border-b border-[var(--gt-border)]/60 p-4">
                    <SectionKicker
                      icon={FileText}
                      title="Execution source"
                      meta={
                        <>
                          {script ? (
                            <Badge tone="blue">bash script</Badge>
                          ) : script === null ? (
                            <Badge tone="mute">prompt</Badge>
                          ) : (
                            <Badge tone="mute">loading...</Badge>
                          )}
                        </>
                      }
                    />
                    <div className="mb-2 min-w-0 truncate text-[10.5px] text-zinc-600">
                        {script
                          ? script.path
                          : script === null
                            ? `no .agents/${selectedAgent.id}.sh — runs as a single agent prompt`
                            : `reading .agents/${selectedAgent.id}.sh…`}
                    </div>
                    {script ? (
                      <BashHighlight code={script.body} className="max-h-96" />
                    ) : script === null ? (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--gt-border)] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                        {selectedAgent.prompt}
                      </pre>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-4 text-center text-[11px] text-zinc-600">
                        Loading script…
                      </div>
                    )}
                  </section>

                  {/* Per-(repo, agent) state sidecar — what the agent remembers
                      between runs. Empty = first-time / never `terminal-cli state
                      mark-main`'d. Reset wipes the file so the next run does a
                      cold scan. */}
                  <section className="border-b border-[var(--gt-border)]/60 p-4">
                    <SectionKicker
                      icon={Database}
                      title="State sidecar"
                      meta={
                        <>
                          <Badge tone={state?.exists ? 'accent' : 'mute'}>{state?.exists ? 'active' : 'empty'}</Badge>
                          {state?.exists && (
                            <button
                              onClick={async () => {
                                if (!confirm('Reset state? Next run will scan from cold.')) return
                                await window.gt.agents.stateReset(selectedAgent.id)
                                reloadState(selectedAgent.id)
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-400 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                            >
                              reset
                            </button>
                          )}
                        </>
                      }
                    />
                    <div className="mb-2 truncate font-mono text-[9.5px] text-zinc-600">{state?.path || '...'}</div>
                    {!state ? (
                      <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-center text-[11px] text-zinc-600">
                        loading…
                      </div>
                    ) : !state.exists ? (
                      <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-[11px] leading-relaxed text-zinc-500">
                        No state yet. Cadence agents persist their progress here via{' '}
                        <code className="font-mono text-zinc-300">terminal-cli state mark-main</code>; nothing to show
                        until the first run writes.
                      </div>
                    ) : (
                      (() => {
                        const s = state.state
                        const sha =
                          typeof s.lastScannedSha === 'string' ? s.lastScannedSha : ''
                        const ref = typeof s.lastScannedRef === 'string' ? s.lastScannedRef : ''
                        const at =
                          typeof s.lastRunAt === 'number' ? s.lastRunAt : 0
                        const runId =
                          typeof s.lastRunId === 'string' ? s.lastRunId : ''
                        const reserved = new Set([
                          'lastScannedSha',
                          'lastScannedRef',
                          'lastRunAt',
                          'lastRunId',
                        ])
                        const extras = Object.entries(s).filter(([k]) => !reserved.has(k))
                        const relTime = at ? fmtRelative(at) : ''
                        return (
                          <div className="space-y-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 p-3 text-[11px] text-zinc-300">
                            {sha && (
                              <div className="flex items-center gap-2">
                                <span className="w-28 shrink-0 text-zinc-600">last scanned</span>
                                <span className="font-mono text-zinc-200">{sha.slice(0, 12)}</span>
                                {ref && (
                                  <span className="rounded-md border border-[var(--gt-border)] px-1 py-0.5 text-[9.5px] uppercase text-zinc-500">
                                    {ref}
                                  </span>
                                )}
                              </div>
                            )}
                            {at > 0 && (
                              <div className="flex items-center gap-2">
                                <span className="w-28 shrink-0 text-zinc-600">last run at</span>
                                <span>{new Date(at).toLocaleString()}</span>
                                <span className="text-zinc-600">· {relTime}</span>
                              </div>
                            )}
                            {runId && (
                              <div className="flex items-center gap-2">
                                <span className="w-28 shrink-0 text-zinc-600">last run id</span>
                                <span className="truncate font-mono text-[10px] text-zinc-400">{runId}</span>
                                <button
                                  onClick={() => navigateTo('runs', { runId })}
                                  className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                                >
                                  view run
                                </button>
                              </div>
                            )}
                            {extras.length > 0 && (
                              <div className="mt-2 border-t border-[var(--gt-border)]/40 pt-2">
                                <div className="mb-1 text-[9.5px] uppercase tracking-wider text-zinc-600">
                                  extra keys
                                </div>
                                <div className="space-y-0.5 font-mono text-[10.5px]">
                                  {extras.map(([k, v]) => (
                                    <div key={k} className="flex items-baseline gap-2">
                                      <span className="text-zinc-500">{k}</span>
                                      <span className="text-zinc-300">
                                        {typeof v === 'string' ? v : JSON.stringify(v)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()
                    )}
                  </section>
                    </>
                  )}
                  {detailTab === 'runs' && (
                    <>
                  {/* Recent runs for THIS agent */}
                  <section className="border-b border-[var(--gt-border)]/60 p-4">
                    <SectionKicker
                      icon={ListChecks}
                      title="Recent runs"
                      meta={
                        <div className="flex items-center gap-1.5">
                          <Badge tone="mute">{agentRuns.length}</Badge>
                          {(() => {
                        const s = agentSpendWeek[selectedAgent.id]
                        if (!s || s.usd <= 0) return null
                        return (
                          <>
                            <span
                              className="font-mono tabular-nums text-[10.5px] normal-case text-[var(--gt-accent-light)]"
                              title="Total spend across this agent's runs in the last 7 days"
                            >
                              ${s.usd.toFixed(2)} / 7d
                            </span>
                            <span className="font-mono tabular-nums text-[10.5px] normal-case text-zinc-600">
                              · avg ${(s.usd / Math.max(s.runs, 1)).toFixed(3)}/run
                            </span>
                          </>
                        )
                          })()}
                        </div>
                      }
                    />
                    {/* Sparkline: last 20 runs across cron + in-process, newest
                        on the right. Each bar is a tiny color-coded square
                        sized by duration (longer run = taller bar, capped).
                        Hover shows status + duration + when. */}
                    {(() => {
                      const allForAgent = allRuns
                        .filter((r) => r.agentId === selectedAgent.id)
                        .slice(0, 20)
                        .reverse()
                      if (allForAgent.length === 0) return null
                      // Need durations — refetch from agentRuns/allRuns. allRuns
                      // is the unified-runs shape with optional endedAt.
                      const withDuration = allForAgent.map((r) => {
                        const dur =
                          'endedAt' in r && (r as { endedAt?: number }).endedAt
                            ? (r as { endedAt: number }).endedAt - r.startedAt
                            : null
                        return { ...r, dur }
                      })
                      const maxDur = Math.max(
                        1000,
                        ...withDuration.map((r) => r.dur || 0),
                      )
                      return (
                        <div className="mb-3 flex items-end gap-[3px] rounded-md border border-[var(--gt-border)] bg-black/30 p-2">
                          {withDuration.map((r, i) => {
                            const h =
                              r.dur === null
                                ? 24
                                : Math.max(4, Math.round((r.dur / maxDur) * 32))
                            const tone =
                              r.status === 'done'
                                ? 'bg-[var(--gt-green)]'
                                : r.status === 'failed'
                                  ? 'bg-[var(--gt-red)]'
                                  : r.status === 'running'
                                    ? 'bg-[var(--gt-accent-light)] gt-pulse'
                                    : 'bg-zinc-600'
                            const when = new Date(r.startedAt).toLocaleString()
                            const durLabel = r.dur === null ? 'running' : fmtDuration(r.dur)
                            return (
                              <span
                                key={r.id}
                                title={`${i + 1 + allForAgent.length - withDuration.length}. ${r.status} · ${durLabel} · ${when}`}
                                className={`w-1.5 rounded-sm ${tone}`}
                                style={{ height: `${h}px` }}
                              />
                            )
                          })}
                          <span className="ml-2 text-[9.5px] text-zinc-600">
                            last {withDuration.length} (oldest → newest)
                          </span>
                        </div>
                      )
                    })()}
                    {agentRuns.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-4 text-center text-[11px] text-zinc-600">
                        No runs yet. Click <span className="mx-0.5 font-semibold text-zinc-400">Run</span> above to
                        kick one off.
                      </div>
                    ) : (
                      <div className="space-y-1 rounded-lg border border-[var(--gt-border)] bg-black/20">
                        {agentRuns.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setSel(r.id)}
                            className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-3 py-1.5 text-left last:border-b-0 ${
                              sel === r.id ? 'bg-white/5' : 'hover:bg-white/5'
                            }`}
                          >
                            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                              {r.branch}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] uppercase text-zinc-600">
                              <EngineLogo engine={r.engine} size={10} />
                              {engineLabel(r.engine)}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                              {reltime(r.startedAt)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Selected run output */}
                  {selectedRun && selectedRun.agentId === selectedAgent.id && (
                    <section className="p-4">
                      <SectionKicker
                        icon={Square}
                        title="Run output"
                        meta={
                          <div className="flex items-center gap-1.5">
                            <Badge tone={statusTone(selectedRun.status)}>{selectedRun.status}</Badge>
                            <span className="max-w-[220px] truncate font-mono text-[10px] text-zinc-600">{selectedRun.branch}</span>
                            {selectedRun.status === 'running' && (
                              <button
                                onClick={() => window.gt.agents.cancel(selectedRun.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-300 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                              >
                                <Square size={9} strokeWidth={2} />
                                Cancel
                              </button>
                            )}
                            <button
                              onClick={() => window.gt.openExternal(`file://${selectedRun.worktree}`)}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-300 hover:border-[var(--gt-accent)]/60"
                            >
                              <FolderOpen size={9} strokeWidth={2} />
                              Worktree
                            </button>
                            {selectedRun.status !== 'running' && (
                              <button
                                onClick={() => window.gt.agents.removeWorktree(selectedRun.id)}
                                title="Remove the worktree (branch/PR stay)"
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                              >
                                <Trash2 size={9} strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        }
                      />
                      <pre
                        ref={logRef}
                        className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--gt-text-soft)]"
                      >
                        {stripAnsi(outputs[selectedRun.id] || '') || '…'}
                      </pre>
                    </section>
                  )}
                    </>
                  )}
                </div>
              </>
            )
          })()}
        </section>
      </div>

      {picking && (
        <EnginePicker
          title={`Run · ${picking.title}`}
          showPersona={false}
          showPipeline={false}
          showExtraContext
          onClose={() => setPicking(null)}
          onPick={(e, persona, pipeline, model, launchMode, _ctx, _lanes, openrouterHarness, extraContext) => {
            const selectedAgent = (agents || []).find((a) => a.id === picking.id)
            if (launchMode === 'terminal' && selectedAgent) {
              const prompt = agentPrompt(selectedAgent, { persona, pipeline, model })
              openPromptInTerminal({
                engine: e,
                cwd: ctx.repoRoot,
                name: selectedAgent.title,
                prompt: extraContext ? `${prompt}\n\n--- Additional context for THIS run ---\n${extraContext}` : prompt,
                remote: remoteForTabContext(ctx),
                openrouterHarness,
              })
            } else {
              run(picking.id, e, persona, pipeline, model, openrouterHarness, extraContext)
            }
            setPicking(null)
          }}
        />
      )}

      {designerOpen && (
        <AgentDesigner
          repoRoot={ctx.repoRoot}
          remote={remoteForTabContext(ctx)}
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
