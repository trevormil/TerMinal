import { useEffect, useState, type ReactNode } from 'react'
import {
  X,
  FolderOpen,
  Loader2,
  Send,
  CircleCheck,
  CircleSlash,
  RotateCcw,
  TerminalSquare,
  ClipboardCopy,
  Settings as SettingsIcon,
  FolderTree,
  Cpu,
  GitPullRequest,
  AppWindow,
  Inbox,
  MessageCircle,
  Sparkles,
  PlugZap,
  Rows3,
  Eye,
  Activity,
  PackageOpen,
  Palette,
  Moon,
  Sun,
  Monitor,
  Server,
  Ticket as TicketIcon,
  LayoutGrid,
  Plus,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  Settings,
  SettingsPatch,
  DaemonCfg,
  EnvDetect,
  Engine,
  ForgePref,
  PresetKind,
  PresetPrefs,
  AppearanceMode,
  AppearanceTabLayout,
  RemoteHost,
  RemotePlatform,
  RemoteSettingsProbe,
  ProjectsDirValidation,
  TabContext,
  TicketProviderConfig,
  TicketProviderKind,
  TicketProviderTestResult,
  PinnedPanel,
} from '../lib/types'
import { engineLabel } from '../lib/engines'
import { DEFAULT_HIDDEN_TABS, loadHiddenTabs } from '../lib/tabVisibility'
import { ACCENT_SWATCHES, THEMES } from '../lib/themes'
import { EngineModelPicker } from './EngineModelPicker'

const inp =
  'w-full rounded-md border border-[var(--gt-border)] bg-black/35 px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60 focus:bg-black/45'
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const emptyDaemon = (): DaemonCfg => ({
  projectsDir: '',
  worktreesDir: '',
  harnessDir: '',
  templateRepo: '',
  engines: {
    codex: { path: '', defaultModel: '' },
    claude: { path: '', defaultModel: '' },
    cursor: { path: '', defaultModel: '' },
    openrouter: { path: '', defaultModel: '' },
    hermes: { path: '', defaultModel: '' },
  },
  defaultEngine: 'claude',
  forge: 'auto',
})
const daemonFromSettings = (s: Settings): DaemonCfg => ({
  projectsDir: s.projectsDir,
  worktreesDir: s.worktreesDir,
  harnessDir: s.harnessDir,
  templateRepo: s.templateRepo,
  engines: s.engines,
  defaultEngine: s.defaultEngine,
  forge: s.forge,
})
const mergeDaemon = (base: DaemonCfg, patch: Partial<Omit<DaemonCfg, 'engines'>> & { engines?: Partial<Record<Engine, Partial<DaemonCfg['engines'][Engine]>>> }): DaemonCfg => ({
  ...base,
  ...patch,
  engines: {
    codex: { ...base.engines.codex, ...(patch.engines?.codex || {}) },
    claude: { ...base.engines.claude, ...(patch.engines?.claude || {}) },
    cursor: { ...base.engines.cursor, ...(patch.engines?.cursor || {}) },
    openrouter: { ...base.engines.openrouter, ...(patch.engines?.openrouter || {}) },
    hermes: { ...base.engines.hermes, ...(patch.engines?.hermes || {}) },
  },
})

function Section({
  id,
  icon: Icon,
  title,
  desc,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)]/55 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <div className="mb-3 flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/30 text-[var(--gt-accent-light)]">
          <Icon size={15} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-zinc-100">{title}</div>
          {desc && <div className="mt-0.5 max-w-[68ch] text-[11px] leading-relaxed text-zinc-500">{desc}</div>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Toggle({ on, onToggle, label, hint }: { on: boolean; onToggle: () => void; label: string; hint?: string }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-2 text-left transition-colors hover:border-[var(--gt-accent)]/40"
    >
      <span className="min-w-0">
        <span className="text-[12px] text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] text-zinc-600">{hint}</span>}
      </span>
      <span
        className={`relative ml-3 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-[var(--gt-accent)]' : 'bg-zinc-700'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}

// Editor for the Panels tab's pinned web dashboards. Local rows while editing;
// persists the cleaned list (rows with a URL) on blur / add / remove. The tab
// itself appears once at least one panel has a URL.
function PanelsSection({ panels, onSave }: { panels: PinnedPanel[]; onSave: (p: PinnedPanel[]) => void }) {
  const [rows, setRows] = useState<PinnedPanel[]>(() => panels)
  const persist = (next: PinnedPanel[]) =>
    onSave(next.filter((p) => p.url.trim()).map((p) => ({ label: p.label.trim(), url: p.url.trim() })))
  const update = (i: number, patch: Partial<PinnedPanel>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number) =>
    setRows((rs) => {
      const next = rs.filter((_, j) => j !== i)
      persist(next)
      return next
    })
  const inputCls =
    'min-w-0 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
  return (
    <Section
      id="panels"
      icon={LayoutGrid}
      title="Panels"
      desc="Pin web dashboards (Grafana, a status page, a fleet dashboard, …) into the Panels tab, each embedded in a sandboxed frame. The tab appears once at least one panel has a URL."
    >
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="text-[11px] text-zinc-600">No panels yet — add one to show the Panels tab.</div>
        )}
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={p.label}
              onChange={(e) => update(i, { label: e.target.value })}
              onBlur={() => persist(rows)}
              placeholder="Label"
              className={`${inputCls} w-40 shrink-0`}
            />
            <input
              value={p.url}
              onChange={(e) => update(i, { url: e.target.value })}
              onBlur={() => persist(rows)}
              onKeyDown={(e) => e.key === 'Enter' && persist(rows)}
              placeholder="https://…"
              className={`${inputCls} flex-1 font-mono`}
            />
            <button
              onClick={() => remove(i)}
              title="Remove panel"
              className="flex shrink-0 items-center rounded p-1.5 text-zinc-500 hover:bg-white/10 hover:text-[var(--gt-red)]"
            >
              <Trash2 size={13} strokeWidth={2} />
            </button>
          </div>
        ))}
        <button
          onClick={() => setRows((rs) => [...rs, { label: '', url: '' }])}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
        >
          <Plus size={12} strokeWidth={2} />
          Add panel
        </button>
      </div>
    </Section>
  )
}

const SETTING_NAV: { id: string; title: string; icon: LucideIcon }[] = [
  { id: 'paths', title: 'Paths', icon: FolderTree },
  { id: 'appearance', title: 'Appearance', icon: Palette },
  { id: 'engines', title: 'Engines', icon: Cpu },
  { id: 'remote', title: 'SSH Hosts', icon: Server },
  { id: 'forge', title: 'Forge', icon: GitPullRequest },
  { id: 'tickets', title: 'Tickets', icon: TicketIcon },
  { id: 'apps', title: 'Apps', icon: AppWindow },
  { id: 'panels', title: 'Panels', icon: LayoutGrid },
  { id: 'inbox', title: 'Inbox', icon: Inbox },
  { id: 'suggestions', title: 'Replies', icon: Sparkles },
  { id: 'telegram', title: 'Telegram', icon: MessageCircle },
  { id: 'integrations', title: 'Setup', icon: PlugZap },
  { id: 'tabs', title: 'Tabs', icon: Rows3 },
  { id: 'presets', title: 'Presets', icon: Eye },
  { id: 'status', title: 'Status', icon: Activity },
  { id: 'rebuild', title: 'Rebuild', icon: PackageOpen },
]

function Readiness({ ok, name, hint }: { ok: boolean; name: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      {ok ? (
        <CircleCheck size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
      ) : (
        <CircleSlash size={14} strokeWidth={2} className="shrink-0 text-zinc-600" />
      )}
      <span className="font-mono text-zinc-300">{name}</span>
      <span className="truncate text-zinc-600">{hint}</span>
    </div>
  )
}

// Tab visibility — let the user hide tabs they never use. Persists to
// localStorage and broadcasts a synthetic event so SessionView re-renders
// without a window reload.
function TabsVisibilityPanel() {
  const [hidden, setHidden] = useState<string[]>(() => loadHiddenTabs())
  // ALL_TABS is the source of truth for the tab list — import lazily to avoid
  // a circular import (tabs/registry → tabs/* → components/SettingsPanel).
  const [allTabs, setAllTabs] = useState<{ id: string; title: string; order: number }[]>([])
  useEffect(() => {
    import('../tabs/registry').then((m) => {
      setAllTabs(
        [...m.ALL_TABS]
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          .map((t) => ({ id: t.id, title: t.title, order: t.order ?? 99 })),
      )
    })
  }, [])
  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      localStorage.setItem('gt.tabs.hidden', JSON.stringify(next))
      window.dispatchEvent(new Event('gt.tabs.hidden.changed'))
      return next
    })
  }
  if (allTabs.length === 0)
    return <div className="text-[11px] text-zinc-600">loading…</div>
  return (
    <div className="grid grid-cols-2 gap-1">
      <div className="col-span-2 mb-1 text-[10.5px] text-zinc-600">
        New installs hide {DEFAULT_HIDDEN_TABS.join(', ')} by default. Toggle them on here when needed.
      </div>
      {allTabs.map((t) => {
        const off = hidden.includes(t.id)
        return (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className={`flex items-center justify-between rounded-md border px-2 py-1 text-[11px] ${
              off
                ? 'border-[var(--gt-border)] bg-black/20 text-zinc-500 line-through'
                : 'border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 text-zinc-100'
            }`}
          >
            <span className="truncate">{t.title}</span>
            <span className="text-[9.5px] text-zinc-600">{off ? 'hidden' : 'shown'}</span>
          </button>
        )
      })}
    </div>
  )
}

// Harness self-status: meta-observability snapshot of how TerMinal's own
// infrastructure is doing. Refreshes on mount + every 5s while visible.
function HarnessStatusPanel() {
  const [s, setS] = useState<Awaited<ReturnType<typeof window.gt.harnessStatus>> | null>(null)
  useEffect(() => {
    const load = () => window.gt.harnessStatus().then(setS)
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])
  if (!s)
    return (
      <div className="rounded-md border border-dashed border-[var(--gt-border)] p-3 text-[11px] text-zinc-600">
        loading…
      </div>
    )
  const Cell = ({
    label,
    value,
    tone = 'mute',
  }: {
    label: string
    value: number | string
    tone?: 'mute' | 'green' | 'red' | 'yellow' | 'blue'
  }) => {
    const cls =
      tone === 'green'
        ? 'text-[var(--gt-green)]'
        : tone === 'red'
          ? 'text-[var(--gt-red)]'
          : tone === 'yellow'
            ? 'text-[var(--gt-yellow)]'
            : tone === 'blue'
              ? 'text-[var(--gt-accent-light)]'
              : 'text-zinc-200'
    return (
      <div className="flex flex-col items-start gap-0.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5">
        <span className="text-[9.5px] uppercase tracking-wider text-zinc-500">{label}</span>
        <span className={`tabular-nums text-[15px] font-semibold ${cls}`}>{value}</span>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-zinc-300">
        <Cell label="cron records" value={s.cronRunFiles} />
        <Cell
          label="cron running"
          value={s.cronRunsRunning}
          tone={s.cronRunsRunning > 0 ? 'blue' : 'mute'}
        />
        <Cell
          label="in-proc running"
          value={s.inProcessRunning}
          tone={s.inProcessRunning > 0 ? 'blue' : 'mute'}
        />
        <Cell
          label="failed (24h)"
          value={s.cronFailed24h}
          tone={s.cronFailed24h > 0 ? 'red' : 'green'}
        />
        <Cell
          label="paused schedules"
          value={s.schedulesPaused}
          tone={s.schedulesPaused > 0 ? 'yellow' : 'mute'}
        />
        <Cell label="cron worktrees" value={s.cronWorktrees} />
      </div>
      <div className="text-[10px] text-zinc-600">
        Updated live · stored in <code className="font-mono">{tilde(s.configDir)}</code>
      </div>
    </div>
  )
}

// In-app rebuild panel. Kicks off bin/release as a detached daemon, tails the
// log live in the UI, and prepares the user for the imminent app quit. The
// release script kills the running TerMinal halfway through to replace
// /Applications — that's expected, and the relaunch is the script's job.
function RebuildPanel() {
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Tail the log every second while a rebuild is going. We also keep polling
  // status:running so the indicator clears once bin/release finishes (in
  // practice the app gets quit + relaunched, so this UI is mostly seen for
  // the "build…" phase before the kill lands).
  useEffect(() => {
    if (!running) return
    let alive = true
    const tick = async () => {
      const text = await window.gt.release.tail()
      const st = await window.gt.release.status()
      if (!alive) return
      setLog(text)
      if (!st.running) setRunning(false)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [running])

  const start = async () => {
    setError(null)
    setBusy(true)
    const r = await window.gt.release.start()
    setBusy(false)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setRunning(true)
  }

  return (
    <div className="space-y-2">
      <button
        onClick={start}
        disabled={busy || running}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-3 py-2 text-left text-[12px] text-zinc-100 hover:bg-[var(--gt-accent)]/20 disabled:opacity-50"
      >
        {busy || running ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} strokeWidth={2} />}
        {running ? 'Rebuilding… (app will quit + relaunch automatically)' : 'Rebuild + reinstall now'}
        <span className="ml-auto text-[10.5px] text-zinc-600">bun run release</span>
      </button>
      {error && <div className="text-[11px] text-amber-400">{error}</div>}
      {(running || log) && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--gt-text-soft)]">
          {log || '(starting…)'}
        </pre>
      )}
      <div className="text-[10.5px] leading-4 text-zinc-600">
        Checks origin first and fast-forwards clean main/master checkouts before building.
        Reinstall replaces only the app bundle and TerMinal-owned helper binaries.
        Settings, custom agents, scripts, snippets, widgets, schedules, inbox, and run state in
        <span className="font-mono"> ~/.config/TerMinal</span> are preserved.
      </div>
    </div>
  )
}

function PresetVisibilityPanel() {
  const [data, setData] = useState<{
    prefs: PresetPrefs
    catalog: Record<PresetKind, { id: string; title: string; group?: string }[]>
  } | null>(null)
  const load = () => window.gt.presets.get().then(setData)
  useEffect(() => {
    load()
  }, [])
  if (!data) return <div className="text-[11px] text-zinc-600">Loading presets...</div>
  const block = (kind: PresetKind, title: string) => {
    const hidden = data.prefs.hidden[kind]
    const byId = new Map(data.catalog[kind].map((p) => [p.id, p]))
    return (
      <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-zinc-200">{title}</span>
          <span className="text-[10.5px] tabular-nums text-zinc-600">
            {hidden.length} hidden
          </span>
          <div className="flex-1" />
          <button
            onClick={async () => {
              await window.gt.presets.restore(kind)
              await load()
            }}
            disabled={hidden.length === 0}
            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
          >
            Restore all
          </button>
        </div>
        {hidden.length === 0 ? (
          <div className="text-[11px] text-zinc-600">All presets are visible.</div>
        ) : (
          <div className="space-y-1">
            {hidden.map((id) => {
              const preset = byId.get(id)
              return (
                <div key={id} className="flex items-center gap-2 rounded-md bg-black/25 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-300">
                    {preset?.title || id}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-600">{id}</span>
                  <button
                    onClick={async () => {
                      await window.gt.presets.restore(kind, id)
                      await load()
                    }}
                    className="rounded-md px-2 py-1 text-[11px] text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/10"
                  >
                    Restore
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {block('snippets', 'Prompt snippets')}
      {block('agents', 'Agents')}
    </div>
  )
}

const defaultLinearConfig = (team = ''): NonNullable<TicketProviderConfig['linear']> => ({
  mcp: {
    command: 'bunx',
    args: ['mcp-remote@0.1.38', 'https://mcp.linear.app/mcp'],
  },
  tools: {
    list: 'list_issues',
    get: 'get_issue',
    create: 'save_issue',
    update: 'save_issue',
  },
  ...(team ? { team } : {}),
})

function normalizeTicketConfig(cfg: TicketProviderConfig | { error: string } | null): TicketProviderConfig {
  if (!cfg || 'error' in cfg) return { provider: 'local' }
  if (cfg.provider === 'github') return { provider: 'github', github: cfg.github || {} }
  if (cfg.provider === 'linear') return { provider: 'linear', linear: { ...defaultLinearConfig(), ...(cfg.linear || {}) } }
  return { provider: 'local' }
}

function TicketProviderPanel() {
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [draft, setDraft] = useState<TicketProviderConfig>({ provider: 'local' })
  const [saved, setSaved] = useState<TicketProviderConfig>({ provider: 'local' })
  const [teams, setTeams] = useState<{ id: string; name: string; key?: string }[]>([])
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'smoke' | 'teams' | null>('load')
  const [result, setResult] = useState<TicketProviderTestResult | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setBusy('load')
    setError('')
    try {
      const [nextCtx, cfg] = await Promise.all([window.gt.tabContext(), window.gt.tickets.providerGet()])
      setCtx(nextCtx)
      const normalized = normalizeTicketConfig(cfg)
      setDraft(normalized)
      setSaved(normalized)
      if (normalized.provider === 'linear') {
        const list = await window.gt.tickets.linearTeams(normalized).catch(() => [])
        setTeams(list)
      }
    } catch (e) {
      setError((e as Error).message || 'Could not load ticket provider.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const provider = draft.provider || 'local'
  const setProvider = (next: TicketProviderKind) => {
    setResult(null)
    if (next === 'linear') setDraft({ provider: next, linear: { ...defaultLinearConfig(draft.linear?.team || draft.linear?.teamKey || '') } })
    else if (next === 'github') setDraft({ provider: next, github: draft.github || {} })
    else setDraft({ provider: 'local' })
  }
  const loadTeams = async () => {
    setBusy('teams')
    setError('')
    try {
      const list = await window.gt.tickets.linearTeams(draft)
      setTeams(list)
      setResult({
        ok: list.length > 0,
        provider: 'linear',
        message: list.length ? `Found ${list.length} Linear team${list.length === 1 ? '' : 's'}.` : 'No Linear teams returned.',
        teams: list,
      })
    } catch (e) {
      setError((e as Error).message || 'Could not list Linear teams.')
    } finally {
      setBusy(null)
    }
  }
  const saveProvider = async () => {
    setBusy('save')
    setError('')
    try {
      const res = await window.gt.tickets.providerSave(draft)
      if ('error' in res) setError(res.error)
      else {
        const normalized = normalizeTicketConfig(res)
        setSaved(normalized)
        setDraft(normalized)
        window.dispatchEvent(new Event('gt.ticket-provider.changed'))
        setResult({ ok: true, provider: normalized.provider || 'local', message: `Saved ${normalized.provider || 'local'} as this repo's ticket source.` })
      }
    } catch (e) {
      setError((e as Error).message || 'Could not save ticket provider.')
    } finally {
      setBusy(null)
    }
  }
  const runTest = async (smoke = false) => {
    setBusy(smoke ? 'smoke' : 'test')
    setError('')
    try {
      setResult(await window.gt.tickets.providerTest(draft, smoke))
    } catch (e) {
      setError((e as Error).message || 'Ticket provider test failed.')
    } finally {
      setBusy(null)
    }
  }
  const providerOpt = (kind: TicketProviderKind, title: string, detail: string) => (
    <button
      onClick={() => setProvider(kind)}
      className={`min-h-[70px] rounded-lg border px-3 py-2 text-left transition-colors ${
        provider === kind
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-500">{detail}</div>
    </button>
  )

  const action =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[12px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50'
  const providerChanged = JSON.stringify(saved) !== JSON.stringify(draft)
  const repoLabel = ctx?.repoPath || ctx?.repoRoot || 'current repo'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-zinc-200">{repoLabel}</div>
          <div className="text-[10.5px] text-zinc-600">
            One source of truth per repo. Switching providers changes where tickets are read and written; it does not sync old tickets.
          </div>
        </div>
        <span className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          saved: {saved.provider || 'local'}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {providerOpt('local', 'Local backlog', '.TerMinal/backlog markdown files. Default for every repo.')}
        {providerOpt('github', 'GitHub Issues', 'Uses the gh CLI. Best when GitHub issues are the repo tracker.')}
        {providerOpt('linear', 'Linear', 'Uses Linear MCP. Pick a team and file issues directly in Linear.')}
      </div>

      {provider === 'github' && (
        <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[11px] text-zinc-500">
          TerMinal will check <span className="font-mono text-zinc-300">gh auth status</span> and issue availability for this repo. Priority/status are represented as managed labels.
        </div>
      )}

      {provider === 'linear' && (
        <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Team</span>
              <select
                value={draft.linear?.team || draft.linear?.teamKey || ''}
                onChange={(e) => setDraft({ provider: 'linear', linear: { ...defaultLinearConfig(), ...(draft.linear || {}), team: e.target.value } })}
                className="h-[33px] w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
              >
                <option value="" className="bg-[var(--gt-panel)]">Pick a team…</option>
                {teams.map((team) => (
                  <option key={team.id || team.name} value={team.name || team.key || team.id} className="bg-[var(--gt-panel)]">
                    {team.name || team.key || team.id}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={loadTeams} disabled={busy === 'teams'} className={action}>
              {busy === 'teams' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} strokeWidth={2} />}
              Teams
            </button>
          </div>
          <details>
            <summary className="cursor-pointer text-[10.5px] text-zinc-600 hover:text-zinc-400">Advanced MCP command</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-[0.8fr_1.2fr]">
              <input
                value={draft.linear?.mcp?.command || 'bunx'}
                onChange={(e) => setDraft({ provider: 'linear', linear: { ...defaultLinearConfig(), ...(draft.linear || {}), mcp: { ...(draft.linear?.mcp || {}), command: e.target.value } } })}
                className={`${inp} font-mono`}
                spellCheck={false}
              />
              <input
                value={(draft.linear?.mcp?.args || ['mcp-remote@0.1.38', 'https://mcp.linear.app/mcp']).join(' ')}
                onChange={(e) => setDraft({ provider: 'linear', linear: { ...defaultLinearConfig(), ...(draft.linear || {}), mcp: { ...(draft.linear?.mcp || {}), args: e.target.value.split(/\s+/).filter(Boolean) } } })}
                className={`${inp} font-mono`}
                spellCheck={false}
              />
            </div>
          </details>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={saveProvider} disabled={busy === 'save'} className={action}>
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <CircleCheck size={13} strokeWidth={2} />}
          Save
        </button>
        <button onClick={() => runTest(false)} disabled={busy === 'test' || providerChanged} className={action} title={providerChanged ? 'Save before testing this provider.' : 'Non-mutating connection check.'}>
          {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} strokeWidth={2} />}
          Test
        </button>
        <button onClick={() => runTest(true)} disabled={busy === 'smoke' || providerChanged} className={action} title={providerChanged ? 'Save before running smoke.' : 'Creates, updates, and closes a real smoke ticket.'}>
          {busy === 'smoke' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={2} />}
          Smoke
        </button>
        {providerChanged && <span className="text-[10.5px] text-amber-300">Save changes before testing.</span>}
      </div>

      {error && <div className="rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 px-2.5 py-1.5 text-[11px] text-[var(--gt-red)]">{error}</div>}
      {result && (
        <div className={`rounded-md border px-2.5 py-1.5 text-[11px] ${result.ok ? 'border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)]' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
          {result.message}
          {typeof result.count === 'number' && <span className="ml-1 text-zinc-500">({result.count} tickets)</span>}
          {result.smoke?.key && (
            <button onClick={() => result.smoke?.url && window.gt.openExternal(result.smoke.url)} className="ml-2 underline underline-offset-2">
              {result.smoke.key}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SettingsPanel({ onClose, onRerunSetup }: { onClose: () => void; onRerunSetup: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [tg, setTg] = useState<{ busy?: boolean; ok?: boolean; error?: string } | null>(null)
  const [notify, setNotify] = useState<{ busy?: boolean; ok?: boolean; path?: string; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [profile, setProfile] = useState('local')
  const [remoteProbe, setRemoteProbe] = useState<Record<string, RemoteSettingsProbe | { loading: true }>>({})
  const [projectsDirValidation, setProjectsDirValidation] = useState<ProjectsDirValidation | null>(null)
  const [remoteDraft, setRemoteDraft] = useState({
    label: '',
    sshTarget: '',
    defaultCwd: '',
    platform: 'linux' as RemotePlatform,
  })

  useEffect(() => {
    window.gt.settings.get().then(setS)
    window.gt.detectEnv().then(setEnv)
  }, [])
  useEffect(() => {
    if (s && profile !== 'local' && !s.remoteHosts.some((h) => h.id === profile)) setProfile('local')
  }, [s, profile])

  const save = async (patch: SettingsPatch) => {
    const next = await window.gt.settings.patch(patch)
    setS(next)
    window.dispatchEvent(new CustomEvent('gt.settings.changed', { detail: next }))
  }
  useEffect(() => {
    if (!s || profile === 'local') return
    const host = s.remoteHosts.find((h) => h.id === profile)
    if (!host || remoteProbe[host.id]) return
    setRemoteProbe((cur) => ({ ...cur, [host.id]: { loading: true } }))
    window.gt.settings.remoteProbe(host.id).then((probe) =>
      setRemoteProbe((cur) => ({ ...cur, [host.id]: probe })),
    )
  }, [s, profile, remoteProbe])
  const selectedHost = s?.remoteHosts.find((h) => h.id === profile) || null
  const selectedDaemon = s ? (selectedHost ? selectedHost.daemon : daemonFromSettings(s)) : emptyDaemon()
  const selectedProbe = selectedHost ? remoteProbe[selectedHost.id] : null
  const selectedIsRemote = !!selectedHost
  useEffect(() => {
    let alive = true
    window.gt.settings
      .validateProjectsDir({ dir: selectedDaemon.projectsDir, hostId: selectedHost?.id })
      .then((v) => {
        if (alive) setProjectsDirValidation(v)
      })
    return () => {
      alive = false
    }
  }, [selectedDaemon.projectsDir, selectedHost?.id])
  const saveDaemon = async (
    patch: Partial<Omit<DaemonCfg, 'engines'>> & { engines?: Partial<Record<Engine, Partial<DaemonCfg['engines'][Engine]>>> },
  ) => {
    if (!s) return
    if (!selectedHost) {
      const next = mergeDaemon(daemonFromSettings(s), patch)
      await save({
        projectsDir: next.projectsDir,
        worktreesDir: next.worktreesDir,
        harnessDir: next.harnessDir,
        templateRepo: next.templateRepo,
        engines: next.engines,
        defaultEngine: next.defaultEngine,
        forge: next.forge,
      })
      return
    }
    const hosts = s.remoteHosts.map((h) =>
      h.id === selectedHost.id ? { ...h, daemon: mergeDaemon(h.daemon || emptyDaemon(), patch) } : h,
    )
    await save({ remoteHosts: hosts })
  }
  const refreshRemoteProbe = (host: RemoteHost) => {
    setRemoteProbe((cur) => ({ ...cur, [host.id]: { loading: true } }))
    window.gt.settings.remoteProbe(host.id).then((probe) =>
      setRemoteProbe((cur) => ({ ...cur, [host.id]: probe })),
    )
  }
  const remoteId = (value: string) =>
    value
      .trim()
      .replace(/[^\w.-]/g, '-')
      .replace(/^-+|-+$/g, '')
  const saveRemoteDraft = () => {
    if (!s || !remoteDraft.sshTarget.trim()) return
    const id = remoteId(remoteDraft.label || remoteDraft.sshTarget)
    if (!id) return
    const existing = s.remoteHosts.find((h) => h.id === id)
    const next = [
      ...s.remoteHosts.filter((h) => h.id !== id),
      {
        id,
        label: remoteDraft.label.trim() || remoteDraft.sshTarget.trim(),
        sshTarget: remoteDraft.sshTarget.trim(),
        defaultCwd: remoteDraft.defaultCwd.trim(),
        platform: remoteDraft.platform,
        daemon: existing?.daemon || emptyDaemon(),
      },
    ]
    save({ remoteHosts: next })
    setRemoteDraft({ label: '', sshTarget: '', defaultCwd: '', platform: 'linux' })
  }
  const removeRemoteHost = (id: string) => {
    if (!s) return
    save({ remoteHosts: s.remoteHosts.filter((h) => h.id !== id) })
  }
  const appOptions = (detected: string[] | undefined, fallback: string[], current: string) => {
    const list = [...new Set([...(detected?.length ? detected : fallback), ...(current ? [current] : [])])]
    return list.map((a) => (
      <option key={a} value={a} className="bg-[var(--gt-panel)]">
        {a}
      </option>
    ))
  }
  const browseDaemon = async (key: 'projectsDir' | 'worktreesDir' | 'harnessDir') => {
    if (selectedIsRemote) return
    const d = await window.gt.pickDir()
    if (d) saveDaemon({ [key]: d })
  }
  const testTelegram = async () => {
    setTg({ busy: true })
    setTg(await window.gt.telegram.test())
  }
  const installNotify = async () => {
    setNotify({ busy: true })
    setNotify(await window.gt.installGtNotify())
  }
  const [mcpState, setMcpState] = useState<{ busy?: boolean; ok?: boolean; installed?: string[]; error?: string } | null>(null)
  const installMcp = async () => {
    setMcpState({ busy: true })
    const r = await window.gt.mcpInstall()
    if ('error' in r) setMcpState({ error: r.error })
    else setMcpState({ ok: true, installed: r.installed })
  }
  const copySetupPrompt = async () => {
    const repo = s?.templateRepo || 'https://github.com/trevormil/project-template'
    const prompt = [
      'I just installed TerMinal (an Electron alt-terminal for AI coding agents).',
      'Help me finish one-time setup on this machine. Check what already exists before changing anything.',
      '',
      '1. CLIs: ensure `claude` (required) is installed + logged in, plus any of `codex`, `gh`, `glab` I plan to use. Walk me through `gh auth login` / `glab auth login` if needed.',
      `2. Global agent skills: clone ${repo} and follow its setup docs to install the project-template workflow skills (code-review, iterate, test-suite, document, pr-creation, stacked-mr, notify) into ~/.claude/skills (and ~/.codex/skills for codex). Verify each resolves.`,
      '3. (Optional) Telegram: help me create a bot with @BotFather and find my numeric chat id, so I can paste the token + id into TerMinal → Settings → Telegram.',
      '',
      'Summarize what you did and what is left for me.',
    ].join('\n')
    await window.gt.clipboardWrite(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (!s)
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        <Loader2 className="animate-spin text-zinc-500" />
      </div>
    )

  const buttonSoft =
    'inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-zinc-100'
  const actionButton =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[12px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50'
  const scalePct = Math.round((s.appearance.uiScale || 1) * 100)
  const valueText = (value: string, fallback: string) => (
    <span className={`min-w-0 truncate font-mono text-[11.5px] ${value ? 'text-zinc-300' : 'text-zinc-500'}`}>
      {value ? tilde(value) : fallback}
    </span>
  )
  const EditDetails = ({ children, label = 'Edit manually' }: { children: ReactNode; label?: string }) => (
    <details className="group">
      <summary className="cursor-pointer list-none text-[10.5px] text-zinc-600 transition-colors hover:text-zinc-400">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Hide editor</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
  const PathSetting = ({
    label,
    value,
    fallback,
    detail,
    onBrowse,
    onClear,
    children,
  }: {
    label: string
    value: string
    fallback: string
    detail?: string
    onBrowse?: () => void
    onClear?: () => void
    children?: ReactNode
  }) => (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{label}</div>
          <div className="flex min-w-0 items-center gap-2">
            {valueText(value, fallback)}
            {!value && <span className="rounded border border-[var(--gt-border)] px-1 py-px text-[9.5px] text-zinc-600">default</span>}
          </div>
          {detail && <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">{detail}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onBrowse && (
            <button onClick={onBrowse} className={buttonSoft}>
              <FolderOpen size={12} strokeWidth={2} />
              Browse
            </button>
          )}
          {value && onClear && (
            <button onClick={onClear} className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300">
              Use default
            </button>
          )}
        </div>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )

  const MODEL_OPTIONS: Record<Engine, string[]> = {
    claude: ['', 'haiku', 'sonnet', 'opus', 'fable'],
    codex: ['', 'gpt-5', 'gpt-5-codex', 'gpt-5.1-codex', 'o4-mini'],
    cursor: [
      '',
      'auto',
      'composer-2.5-fast',
      'composer-2.5',
      'gpt-5.3-codex',
      'gpt-5.3-codex-high',
      'gpt-5.2',
      'gpt-5.5-medium',
      'claude-opus-4-8-high',
      'claude-opus-4-8-thinking-high',
      'claude-4.6-sonnet-medium',
      'gemini-3.1-pro',
      'grok-4.3',
      'kimi-k2.5',
    ],
    openrouter: [
      '',
      'deepseek/deepseek-v3.2',
      'deepseek/deepseek-chat',
      'qwen/qwen3-coder-next',
      'z-ai/glm-4.7-flash',
      'minimax/minimax-m2.5',
      'moonshotai/kimi-k2.5',
      'mistralai/codestral-2508',
      'google/gemini-3.1-flash-lite',
      'openai/gpt-5.1-codex-mini',
    ],
    hermes: ['', 'anthropic/claude-sonnet-4.6', 'openai/gpt-5.1', 'deepseek/deepseek-v3.2', 'moonshotai/kimi-k2.5'],
  }
  const engineRow = (e: Engine, vendor: string) => {
    const remoteDetected =
      selectedProbe && !('loading' in selectedProbe) && selectedProbe.ok ? selectedProbe.engines[e] || '' : ''
    // OpenRouter (or-agent) rides on Codex being present, so track codex detection.
    const localFound = env ? (e === 'codex' || e === 'openrouter' ? env.codex.found : e === 'cursor' ? env.cursor.found : env.claude.found) : true
    const found = selectedIsRemote ? !!remoteDetected : localFound
    const detPath = selectedIsRemote
      ? remoteDetected
      : env
        ? e === 'codex' || e === 'openrouter'
          ? env.codex.path
          : e === 'cursor'
            ? env.cursor.path
            : env.claude.path
        : ''
    const defModel = selectedDaemon.engines[e].defaultModel
    const overridePath = selectedDaemon.engines[e].path
    return (
      <div key={e} className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <Readiness ok={found} name={engineLabel(e)} hint={found ? detPath || vendor : 'not on PATH'} />
            <div className="mt-0.5 text-[10.5px] text-zinc-600">
              {overridePath ? <>override: <span className="font-mono text-zinc-500">{tilde(overridePath)}</span></> : 'using detected binary'}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[10.5px] text-zinc-500">
            default model
            <select
              value={defModel}
              onChange={(ev) =>
                saveDaemon({ engines: { [e]: { defaultModel: ev.target.value } } })
              }
              className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none"
            >
              {MODEL_OPTIONS[e].map((m) => (
                <option key={m} value={m}>
                  {m || '(engine default)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <EditDetails label="Override binary path">
          <input
            key={`${profile}-${e}-path-${overridePath}`}
            defaultValue={overridePath}
            onBlur={(ev) => ev.target.value !== overridePath && saveDaemon({ engines: { [e]: { path: ev.target.value.trim() } } })}
            placeholder={`${e} or /absolute/path/to/${e}`}
            spellCheck={false}
            className={`${inp} font-mono`}
          />
        </EditDetails>
      </div>
    )
  }

  const forgeOpt = (val: ForgePref, label: string, hint: string) => (
    <button
      key={val}
      onClick={() => saveDaemon({ forge: val })}
      className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
        selectedDaemon.forge === val
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50'
      }`}
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[10.5px] text-zinc-500">{hint}</div>
    </button>
  )
  const modeOpt = (mode: AppearanceMode, label: string, Icon: LucideIcon) => (
    <button
      key={mode}
      onClick={() => save({ appearance: { mode } })}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
        s.appearance.mode === mode
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} strokeWidth={2} className="shrink-0" />
      <span className="text-[12px] font-semibold">{label}</span>
    </button>
  )
  const tabLayoutOpt = (layout: AppearanceTabLayout, label: string, hint: string) => (
    <button
      key={layout}
      onClick={() => save({ appearance: { tabLayout: layout } })}
      className={`flex min-w-0 flex-1 flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
        s.appearance.tabLayout === layout
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <span className="text-[12px] font-semibold">{label}</span>
      <span className="mt-0.5 text-[10.5px] text-zinc-500">{hint}</span>
    </button>
  )
  const SuggestionModelSetting = ({
    label,
    engine,
    model,
    onPick,
    hint,
  }: {
    label: string
    engine: Engine
    model: string
    onPick: (engine: Engine, model: string | undefined) => void
    hint: string
  }) => (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold text-zinc-200">{label}</div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">{hint}</div>
        </div>
        <EngineModelPicker engine={engine} model={model || undefined} onChange={onPick} size="sm" align="right" />
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[min(860px,calc(100vh-32px))] w-[min(1080px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/80 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/30 text-[var(--gt-accent-light)]">
            <SettingsIcon size={16} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-zinc-100">Settings</h2>
            <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
              Configure engines, workflow surfaces, notifications, and local infrastructure.
            </div>
          </div>
          <div
            className="mr-2 shrink-0 text-right font-mono text-[9.5px] leading-tight text-zinc-600"
            title={`Installed build — commit ${__BUILD_SHA__} on ${__BUILD_BRANCH__}, built ${__BUILD_TIME__}`}
          >
            <div className="text-zinc-400">build {__BUILD_SHA__}</div>
            <div>{__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-52 shrink-0 border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/35 p-3 md:block">
            <div className="mb-2 px-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-zinc-600">Categories</div>
            <nav className="space-y-0.5">
              {SETTING_NAV.map(({ id, title, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
                >
                  <Icon size={13} strokeWidth={2} className="text-zinc-600" />
                  <span>{title}</span>
                </a>
              ))}
            </nav>
            <div className="mt-4 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2 text-[10.5px] leading-relaxed text-zinc-600">
              User-owned config lives in <span className="font-mono text-zinc-500">~/.config/TerMinal</span> and survives app updates.
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-[760px] space-y-3">
          <section className="overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)]/70">
            <div className="flex items-start gap-3 border-b border-[var(--gt-border)] px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/30 text-[var(--gt-accent-light)]">
                <Server size={15} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-zinc-100">Daemon profile</div>
                <div className="mt-0.5 max-w-[58ch] text-[10.5px] leading-relaxed text-zinc-500">
                  Choose where TerMinal reads paths, engines, models, forge settings, and template defaults.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                  {selectedHost ? 'SSH' : 'Local'}
                </span>
                {selectedHost && (
                  <button onClick={() => refreshRemoteProbe(selectedHost)} className={buttonSoft}>
                    {selectedProbe && 'loading' in selectedProbe ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Probe
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => setProfile('local')}
                  className={`flex min-h-[58px] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    profile === 'local'
                      ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                      : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                  }`}
                >
                  <Monitor size={16} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">Local machine</span>
                    <span className="block truncate text-[10.5px] text-zinc-600">this Mac · ~/.config/TerMinal</span>
                  </span>
                  {profile === 'local' && <span className="rounded bg-[var(--gt-accent)]/20 px-1.5 py-0.5 text-[9.5px] text-[var(--gt-accent-light)]">Active</span>}
                </button>
                {s.remoteHosts.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setProfile(h.id)}
                    className={`flex min-h-[58px] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                      profile === h.id
                        ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                        : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                    }`}
                  >
                    <Server size={16} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{h.label || h.id}</span>
                      <span className="block truncate font-mono text-[10.5px] text-zinc-600">{h.sshTarget}</span>
                    </span>
                    {profile === h.id && <span className="rounded bg-[var(--gt-accent)]/20 px-1.5 py-0.5 text-[9.5px] text-[var(--gt-accent-light)]">Active</span>}
                  </button>
                ))}
              </div>
              {selectedHost && selectedProbe && !('loading' in selectedProbe) && (
                <div className={`rounded-md border px-2.5 py-1.5 text-[10.5px] ${selectedProbe.ok ? 'border-[var(--gt-border)] bg-black/20 text-zinc-500' : 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-amber-400'}`}>
                  {selectedProbe.ok
                    ? `Connected to ${selectedHost.sshTarget} · cwd ${selectedProbe.cwd || '~'} · ${Object.values(selectedProbe.engines).filter(Boolean).length}/3 engines detected`
                    : selectedProbe.error}
                </div>
              )}
            </div>
          </section>

          {/* Projects & worktrees */}
          <Section id="paths" icon={FolderTree} title="Projects & worktrees" desc={selectedIsRemote ? 'Remote daemon paths. Enter paths as they exist on the SSH host.' : 'Where the entry screen looks for repos, and where agent worktrees are created.'}>
            <div className="space-y-2">
              <PathSetting
                label="Projects directory"
                value={selectedDaemon.projectsDir}
                fallback={selectedIsRemote ? 'Remote home folder' : 'Home folder'}
                detail={selectedIsRemote ? 'Default remote workspace directory for this SSH profile.' : 'Used by the entry screen for new workspaces and scaffold destinations.'}
                onBrowse={selectedIsRemote ? undefined : () => browseDaemon('projectsDir')}
                onClear={() => saveDaemon({ projectsDir: '' })}
              >
                {projectsDirValidation && !projectsDirValidation.ok && projectsDirValidation.reason === 'is-repo' && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-200">
                    <span className="min-w-0 flex-1">{projectsDirValidation.message}</span>
                    {projectsDirValidation.suggestedParent && (
                      <button
                        onClick={() => saveDaemon({ projectsDir: projectsDirValidation.suggestedParent || '' })}
                        className="rounded border border-amber-400/40 bg-black/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-100 hover:bg-amber-400/10"
                      >
                        Use parent
                      </button>
                    )}
                  </div>
                )}
                <EditDetails>
                  <input
                    key={`${profile}-projectsDir-${selectedDaemon.projectsDir}`}
                    defaultValue={selectedDaemon.projectsDir}
                    onBlur={(e) => e.target.value !== selectedDaemon.projectsDir && saveDaemon({ projectsDir: e.target.value.trim() })}
                    placeholder={selectedIsRemote ? "~/projects" : "/path/to/projects"}
                    spellCheck={false}
                    className={`${inp} font-mono`}
                  />
                </EditDetails>
              </PathSetting>
              <PathSetting
                label="Worktrees directory"
                value={selectedDaemon.worktreesDir}
                fallback={`${tilde(selectedDaemon.projectsDir) || '<projects>'}/.worktrees`}
                detail="Agent process worktrees are created here."
                onBrowse={selectedIsRemote ? undefined : () => browseDaemon('worktreesDir')}
                onClear={() => saveDaemon({ worktreesDir: '' })}
              >
                <EditDetails>
                  <input
                    key={`${profile}-worktreesDir-${selectedDaemon.worktreesDir}`}
                    defaultValue={selectedDaemon.worktreesDir}
                    onBlur={(e) => e.target.value !== selectedDaemon.worktreesDir && saveDaemon({ worktreesDir: e.target.value.trim() })}
                    placeholder={selectedIsRemote ? "~/.worktrees" : "/path/to/worktrees"}
                    spellCheck={false}
                    className={`${inp} font-mono`}
                  />
                </EditDetails>
              </PathSetting>
              <PathSetting
                label="Template repository"
                value={selectedDaemon.templateRepo}
                fallback="trevormil/project-template"
                detail="Used when creating a new project from template."
                onClear={() => saveDaemon({ templateRepo: '' })}
              >
                <EditDetails>
                  <input
                    key={`${profile}-templateRepo-${selectedDaemon.templateRepo}`}
                    defaultValue={selectedDaemon.templateRepo}
                    onBlur={(e) => e.target.value !== selectedDaemon.templateRepo && saveDaemon({ templateRepo: e.target.value.trim() })}
                    placeholder="owner/repo or https://github.com/owner/repo"
                    spellCheck={false}
                    className={`${inp} font-mono`}
                  />
                </EditDetails>
              </PathSetting>
              <PathSetting
                label="Harness directory"
                value={selectedDaemon.harnessDir}
                fallback="Not set"
                detail="Optional review artifact harness path."
                onBrowse={selectedIsRemote ? undefined : () => browseDaemon('harnessDir')}
                onClear={() => saveDaemon({ harnessDir: '' })}
              >
                <EditDetails>
                  <input
                    key={`${profile}-harnessDir-${selectedDaemon.harnessDir}`}
                    defaultValue={selectedDaemon.harnessDir}
                    onBlur={(e) => e.target.value !== selectedDaemon.harnessDir && saveDaemon({ harnessDir: e.target.value.trim() })}
                    placeholder={selectedIsRemote ? "~/autopilot-harness" : "/path/to/autopilot-harness"}
                    spellCheck={false}
                    className={`${inp} font-mono`}
                  />
                </EditDetails>
              </PathSetting>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => window.gt.openConfigDir()}
                  title="Reveal ~/.config/TerMinal/ in Finder — edit schedules.json, settings.json, or agent-state/ sidecars by hand"
                  className={buttonSoft}
                >
                  Open TerMinal config dir
                </button>
                <span className="text-[10.5px] text-zinc-600">
                  schedules · settings · cron logs · agent state
                </span>
              </div>
            </div>
          </Section>

          <Section
            id="appearance"
            icon={Palette}
            title="Appearance"
            desc="Color mode and theme tokens. New installs default to dark; system follows the OS setting."
          >
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {modeOpt('dark', 'Dark', Moon)}
                {modeOpt('light', 'Light', Sun)}
                {modeOpt('system', 'System', Monitor)}
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1.2fr]">
                <div className="grid grid-cols-2 gap-2">
                  {tabLayoutOpt('horizontal', 'Top tabs', 'Classic row across the session header')}
                  {tabLayoutOpt('sidebar', 'Sidebar tabs', 'Vertical nav beside the active view')}
                </div>
                <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-200">UI scale</div>
                      <div className="text-[10.5px] text-zinc-500">Scales the whole app shell.</div>
                    </div>
                    <button
                      onClick={() => save({ appearance: { uiScale: 1 } })}
                      className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                    >
                      {scalePct}%
                    </button>
                  </div>
                  <input
                    type="range"
                    min={85}
                    max={135}
                    step={5}
                    value={scalePct}
                    onChange={(e) => save({ appearance: { uiScale: Number(e.target.value) / 100 } })}
                    className="w-full accent-[var(--gt-accent)]"
                  />
                  <div className="mt-1 flex justify-between text-[9.5px] text-zinc-600">
                    <span>85</span>
                    <span>100</span>
                    <span>135</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-2 text-[12px] text-zinc-400">
                  Theme
                  <select
                    value={s.appearance.theme}
                    onChange={(e) => save({ appearance: { theme: e.target.value } })}
                    className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                  >
                    {THEMES.map((theme) => (
                      <option key={theme.id} value={theme.id} className="bg-[var(--gt-panel)]">
                        {theme.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  {ACCENT_SWATCHES.map((swatch) => {
                    const on = s.appearance.accent === swatch.id
                    return (
                      <button
                        key={swatch.title}
                        onClick={() => save({ appearance: { accent: swatch.id } })}
                        title={swatch.title}
                        className={`h-6 w-6 rounded-md border transition-colors ${
                          on ? 'border-[var(--gt-accent-light)]' : 'border-[var(--gt-border)] hover:border-[var(--gt-accent)]/60'
                        }`}
                        style={{ background: swatch.color || 'var(--gt-grad)' }}
                      />
                    )
                  })}
                </div>
              </div>
              <div className="grid gap-2 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel-2)]/70 p-2 md:grid-cols-[1fr_1.2fr]">
                <div className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-100">Preview</span>
                    <span className="rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[9.5px] text-zinc-500">
                      {s.appearance.mode}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-[var(--gt-accent)]" />
                    <div className="h-2 w-4/5 rounded-full bg-[var(--gt-border-strong)]" />
                    <div className="h-2 w-2/3 rounded-full bg-[var(--gt-surface-hover)]" />
                  </div>
                </div>
                <div className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-terminal-bg)] p-2 font-mono text-[11px] text-[var(--gt-terminal-fg)]">
                  <div className="text-[var(--gt-green)]">$ terminal theme check</div>
                  <div className="text-[var(--gt-text-muted)]">tokens apply to chrome, panes, scrollbars, and terminals</div>
                  <div>
                    <span className="text-[var(--gt-accent-light)]">accent</span>
                    <span className="text-[var(--gt-text-muted)]"> / </span>
                    <span className="text-[var(--gt-blue)]">info</span>
                    <span className="text-[var(--gt-text-muted)]"> / </span>
                    <span className="text-[var(--gt-yellow)]">warn</span>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          {/* Engines */}
          <Section
            id="engines"
            icon={Cpu}
            title="Engines"
            desc={selectedIsRemote ? 'Detected on the selected SSH host; override paths as remote paths.' : 'The agent backends. Detected on your PATH; override the binary path if needed.'}
          >
            <div className="space-y-2">
              {engineRow('codex', 'OpenAI Codex')}
              {engineRow('claude', 'Anthropic Claude')}
              {engineRow('cursor', 'Cursor Agent')}
              {!selectedIsRemote && engineRow('openrouter', 'OpenRouter · Codex or Hermes harness')}
              {!selectedIsRemote && engineRow('hermes', 'Nous Hermes')}
            </div>
            {!selectedIsRemote && (
              <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
                <label className="block text-[11px] font-medium text-zinc-300">OpenRouter API key</label>
                <div className="mt-0.5 text-[10.5px] text-zinc-600">
                  Stored in your OS keychain. Used only for OpenRouter (or-agent) runs. Empty → falls back to the shell&apos;s OPENROUTER_API_KEY.
                </div>
                <input
                  key={`or-key-${s?.openrouterApiKey ? 'set' : 'unset'}`}
                  type="password"
                  defaultValue={s?.openrouterApiKey || ''}
                  onBlur={(ev) => ev.target.value !== (s?.openrouterApiKey || '') && save({ openrouterApiKey: ev.target.value.trim() })}
                  placeholder="sk-or-v1-…"
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inp} mt-1.5 font-mono`}
                />
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">Default:</span>
              {(['codex', 'claude', 'cursor', 'hermes'] as Engine[]).map((e) => (
                <button
                  key={e}
                  onClick={() => saveDaemon({ defaultEngine: e })}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    selectedDaemon.defaultEngine === e
                      ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                      : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {engineLabel(e)}
                </button>
              ))}
            </div>
          </Section>

          {/* Remote hosts */}
          <Section
            id="remote"
            icon={Server}
            title="SSH hosts"
            desc="Remote profiles for terminal sessions and daemon-backed tabs. Pick a host here, then use Daemon profile to tune its paths, engines, models, forge mode, and template repo."
          >
            <div className="space-y-3">
              {s.remoteHosts.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {s.remoteHosts.map((h) => (
                    <div
                      key={h.id}
                      className={`rounded-lg border p-3 ${
                        profile === h.id
                          ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10'
                          : 'border-[var(--gt-border)] bg-black/20'
                      }`}
                    >
                      <div className="mb-2 flex items-start gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/25 text-[var(--gt-accent-2)]">
                          <Server size={14} strokeWidth={2} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-zinc-100">{h.label}</div>
                          <div className="truncate font-mono text-[10.5px] text-zinc-600">{h.sshTarget}</div>
                        </div>
                        <span className="rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-zinc-500">
                          {h.platform}
                        </span>
                      </div>
                      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md bg-black/20 px-2 py-1.5 text-[10.5px]">
                        <span className="text-zinc-600">cwd</span>
                        <span className="truncate font-mono text-zinc-400">{h.defaultCwd || h.daemon.projectsDir || '~'}</span>
                        <span className="text-zinc-600">id</span>
                        <span className="truncate font-mono text-zinc-500">{h.id}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={() => setProfile(h.id)}
                          className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
                        >
                          Use profile
                        </button>
                        <button
                          onClick={() =>
                            setRemoteDraft({
                              label: h.label,
                              sshTarget: h.sshTarget,
                              defaultCwd: h.defaultCwd,
                              platform: h.platform,
                            })
                          }
                          className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeRemoteHost(h.id)}
                          className="ml-auto rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:border-[var(--gt-red)]/50 hover:text-[var(--gt-red)]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-[11px] text-zinc-600">
                  No remote hosts yet. Add one with an SSH config alias like <span className="font-mono">tm</span> or a target like <span className="font-mono">user@example.com</span>.
                </div>
              )}
              <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-200">Add or update host</div>
                    <div className="text-[10.5px] text-zinc-600">Using the same label replaces an existing profile.</div>
                  </div>
                  <button onClick={saveRemoteDraft} disabled={!remoteDraft.sshTarget.trim()} className={actionButton}>
                    Save host
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Label</span>
                    <input
                      value={remoteDraft.label}
                      onChange={(e) => setRemoteDraft((d) => ({ ...d, label: e.target.value }))}
                      placeholder="remote desktop"
                      className={`${inp} font-mono`}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">SSH target</span>
                    <input
                      value={remoteDraft.sshTarget}
                      onChange={(e) => setRemoteDraft((d) => ({ ...d, sshTarget: e.target.value }))}
                      placeholder="tm or user@example.com"
                      spellCheck={false}
                      className={`${inp} font-mono`}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Default cwd</span>
                    <input
                      value={remoteDraft.defaultCwd}
                      onChange={(e) => setRemoteDraft((d) => ({ ...d, defaultCwd: e.target.value }))}
                      placeholder="~"
                      spellCheck={false}
                      className={`${inp} font-mono`}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Platform</span>
                    <select
                      value={remoteDraft.platform}
                      onChange={(e) => setRemoteDraft((d) => ({ ...d, platform: e.target.value as RemotePlatform }))}
                      className="h-[33px] w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                    >
                      <option value="linux" className="bg-[var(--gt-panel)]">Linux</option>
                      <option value="macos" className="bg-[var(--gt-panel)]">macOS</option>
                      <option value="auto" className="bg-[var(--gt-panel)]">Auto</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </Section>

          {/* Forge */}
          <Section id="forge" icon={GitPullRequest} title="Code forge" desc="Auto picks gh for GitHub remotes and glab otherwise — per repo.">
            <div className="flex gap-2">
              {forgeOpt('auto', 'Auto', 'detect per repo')}
              {forgeOpt('github', 'GitHub', 'force gh / PRs')}
              {forgeOpt('gitlab', 'GitLab', 'force glab / MRs')}
            </div>
            {selectedIsRemote && selectedProbe && !('loading' in selectedProbe) ? (
              <div className="mt-3 space-y-1">
                <Readiness ok={!!selectedProbe.tools.gh} name="gh" hint={selectedProbe.tools.gh || 'not detected on remote PATH'} />
                <Readiness ok={!!selectedProbe.tools.glab} name="glab" hint={selectedProbe.tools.glab || 'not detected on remote PATH'} />
              </div>
            ) : env && (
              <div className="mt-3 space-y-1">
                <Readiness ok={env.gh.found && env.gh.authed} name="gh" hint={env.gh.found ? (env.gh.authed ? `authenticated${env.gh.authHost ? ` (${env.gh.authHost})` : ''}` : 'installed — run `gh auth login`') : 'not installed — `brew install gh`'} />
                <Readiness ok={env.glab.found && env.glab.authed} name="glab" hint={env.glab.found ? (env.glab.authed ? `authenticated${env.glab.authHost ? ` (${env.glab.authHost})` : ''}` : 'installed — run `glab auth login`') : 'not installed — `brew install glab`'} />
              </div>
            )}
          </Section>

          <Section
            id="tickets"
            icon={TicketIcon}
            title="Tickets"
            desc="Pick the repo's ticket source of truth. Local backlog is the default; GitHub and Linear use their existing CLIs/MCPs."
          >
            <TicketProviderPanel />
          </Section>

          {/* External apps */}
          <Section
            id="apps"
            icon={AppWindow}
            title="External apps"
            desc="Which app the Files tab's 'Open in editor' and the Browser tab's 'Open in browser' hand off to. Runs `open -a <app>` (works for any installed macOS app)."
          >
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-[12px] text-zinc-400">
                Editor
                <select
                  value={s.apps.editor || 'Cursor'}
                  onChange={(e) => save({ apps: { editor: e.target.value } })}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                >
                  {appOptions(env?.apps.editors, ['Cursor', 'Visual Studio Code'], s.apps.editor)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-zinc-400">
                Browser
                <select
                  value={s.apps.browser || 'Brave Browser'}
                  onChange={(e) => save({ apps: { browser: e.target.value } })}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                >
                  {appOptions(env?.apps.browsers, ['Brave Browser'], s.apps.browser)}
                </select>
              </label>
            </div>
          </Section>

          <PanelsSection panels={s.pinnedPanels} onSave={(pinnedPanels) => save({ pinnedPanels })} />

          {/* Inbox */}
          <Section
            id="inbox"
            icon={Inbox}
            title="Inbox"
            desc="Global human-needed queue. Manual blockers, cron failures, and budget alerts always go here; completion hooks are configurable."
          >
            <div className="space-y-2">
              <Toggle
                on={s.inbox.completionHook}
                onToggle={() => save({ inbox: { completionHook: !s.inbox.completionHook } })}
                label="File completion hooks to Inbox"
                hint="Claude, Codex, and Cursor turns launched through TerMinal create review items when they complete."
              />
              <Toggle
                on={s.inbox.agentContextPreamble}
                onToggle={() => save({ inbox: { agentContextPreamble: !s.inbox.agentContextPreamble } })}
                label="Add repo context to prompt agents"
                hint="Prompt-style agent runs get a small capped preamble from docs/learnings, docs/decisions, and docs/runbooks. Script agents are unchanged."
              />
              <div className="grid grid-cols-2 gap-1.5 text-[10.5px] text-zinc-500">
                <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  <span className="block text-zinc-300">Always on</span>
                  <span>human blockers, cron failures, spend alerts</span>
                </div>
                <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  <span className="block text-zinc-300">This toggle</span>
                  <span>post-completion review prompts only</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Suggested replies */}
          <Section
            id="suggestions"
            icon={Sparkles}
            title="Suggested replies"
            desc="Per-terminal modes decide when to use these standalone engines. Enhance mode rewrites a draft prompt through the configured AI suggestion engine before sending."
          >
            <div className="space-y-2">
              <SuggestionModelSetting
                label="AI suggestion model"
                engine={s.suggestions.aiEngine}
                model={s.suggestions.aiModel}
                onPick={(aiEngine, aiModel) => save({ suggestions: { aiEngine, aiModel: aiModel || '' } })}
                hint="Used when a terminal is set to AI mode and shows 1-5 suggested next replies."
              />
              <SuggestionModelSetting
                label="Auto-send model"
                engine={s.suggestions.autoEngine}
                model={s.suggestions.autoModel}
                onPick={(autoEngine, autoModel) => save({ suggestions: { autoEngine, autoModel: autoModel || '' } })}
                hint="Used when a terminal is set to Auto mode. TerMinal asks for one best reply and submits it after completion."
              />
              <div className="grid gap-1.5 text-[10.5px] text-zinc-500 sm:grid-cols-3">
                <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  <span className="block text-zinc-300">Rules</span>
                  <span>deterministic suggestions only</span>
                </div>
                <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  <span className="block text-zinc-300">AI</span>
                  <span>shows suggestions for you to choose</span>
                </div>
                <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
                  <span className="block text-zinc-300">Enhance / Auto</span>
                  <span>rewrite a draft prompt; auto submits one reply</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Telegram */}
          <Section id="telegram" icon={MessageCircle} title="Telegram" desc="Create a bot with @BotFather, paste its token and your chat id. Leave blank to use the legacy ~/.claude scripts if present.">
            <div className="space-y-2">
              <Toggle on={s.telegram.notify} onToggle={() => save({ telegram: { notify: !s.telegram.notify } })} label="Mirror notifications to Telegram" />
              <Toggle on={s.telegram.control} onToggle={() => save({ telegram: { control: !s.telegram.control } })} label="Remote control (AFK)" hint="Launch/cancel agents by texting the bot" />
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Bot token</span>
                <input
                  defaultValue={s.telegram.botToken}
                  onBlur={(e) => e.target.value !== s.telegram.botToken && save({ telegram: { botToken: e.target.value.trim() } })}
                  placeholder="123456:ABC-DEF..."
                  spellCheck={false}
                  className={`${inp} font-mono`}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block min-w-0 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Chat id</span>
                  <input
                    defaultValue={s.telegram.chatId}
                    onBlur={(e) => e.target.value !== s.telegram.chatId && save({ telegram: { chatId: e.target.value.trim() } })}
                    placeholder="your numeric chat id"
                    spellCheck={false}
                    className={`${inp} font-mono`}
                  />
                </label>
                <button onClick={testTelegram} disabled={tg?.busy} className={actionButton}>
                  {tg?.busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={2} />}
                  Test
                </button>
              </div>
              {tg && !tg.busy && (
                <div className={`text-[11px] ${tg.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
                  {tg.ok ? '✓ Sent — check your chat.' : tg.error}
                </div>
              )}
              {!!s.telegram.chatId && s.telegram.chatId === s.telegram.botToken.split(':')[0] && (
                <div className="text-[11px] text-amber-400">
                  ⚠ That Chat id is the bot's own id. Use <em>your</em> chat id — message @userinfobot to get it.
                </div>
              )}
              {s.telegram.control && (
                <details className="mt-1 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5">
                  <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200">
                    Command reference (send /help in the chat)
                  </summary>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-zinc-500">
                    <span className="col-span-2 text-[var(--gt-accent-light)]">
                      /feature &lt;what you want built&gt; [@repo]
                    </span>
                    <span>/repos · /cd &lt;repo&gt;</span>
                    <span>/sessions · /about</span>
                    <span>/runs · /cancel &lt;n&gt;</span>
                    <span>/tail &lt;id|n&gt;</span>
                    <span>/agents [@repo]</span>
                    <span>/run &lt;agent&gt; [opts]</span>
                    <span>/tickets [@repo]</span>
                    <span>/ticket &lt;slug|n&gt;</span>
                    <span>/ticket new &lt;title&gt;</span>
                    <span>/close &lt;slug|n&gt;</span>
                    <span>/schedules</span>
                    <span>/pause · /resume · /runnow</span>
                    <span>/hitl · /resolve &lt;n|all&gt; · /reopen</span>
                    <span>/mrs [@repo] · /mr &lt;iid&gt;</span>
                    <span>/state &lt;agent&gt;</span>
                    <span>/reset-state &lt;agent&gt;</span>
                    <span>/bg [@repo] &lt;prompt&gt;</span>
                    <span>/bg list · /bg cancel &lt;n&gt;</span>
                    <span>/budget [set &lt;usd&gt;]</span>
                    <span>/status · /harness · /activity</span>
                    <span>/install &lt;agent&gt;</span>
                    <span>/rebuild</span>
                  </div>
                  <div className="mt-1.5 text-[10px] text-zinc-600">
                    <span className="text-zinc-500">/feature</span> drafts a ticket from plain text, then
                    offers a 🚀 Start work button that builds it and links the PR back. Plain English works
                    too — it's translated to a command. HITL pings include inline ✅ Resolve / 🪵 Tail run
                    buttons.
                  </div>
                </details>
              )}
            </div>
          </Section>

          {/* Setup / integrations */}
          <Section id="integrations" icon={PlugZap} title="Setup & integrations" desc="One-time helpers for a fresh machine. Agents inherit your global ~/.claude and ~/.codex config + skills.">
            <div className="space-y-2">
              <button onClick={copySetupPrompt} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40">
                {copied ? <CircleCheck size={14} strokeWidth={2} className="text-[var(--gt-green)]" /> : <ClipboardCopy size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />}
                Copy global-skills setup prompt
                <span className="ml-auto text-[10.5px] text-zinc-600">{copied ? 'copied — paste into Claude' : 'paste into Claude'}</span>
              </button>
              <button onClick={installNotify} disabled={notify?.busy} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40 disabled:opacity-50">
                {notify?.busy ? <Loader2 size={14} className="animate-spin" /> : <TerminalSquare size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />}
                Install <span className="font-mono">gt-notify</span> to ~/.local/bin
                <span className="ml-auto text-[10.5px] text-zinc-600">activity feed hook</span>
              </button>
              {notify && !notify.busy && (
                <div className={`text-[11px] ${notify.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
                  {notify.ok ? `✓ Installed at ${tilde(notify.path || '')}` : notify.error}
                </div>
              )}
              <button
                onClick={installMcp}
                disabled={mcpState?.busy}
                className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40 disabled:opacity-50"
              >
                {mcpState?.busy ? <Loader2 size={14} className="animate-spin" /> : <TerminalSquare size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />}
                Install MCP server (Claude Code + Codex)
                <span className="ml-auto text-[10.5px] text-zinc-600">cross-session views</span>
              </button>
              {mcpState && !mcpState.busy && (
                <div className={`text-[11px] ${mcpState.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
                  {mcpState.ok
                    ? `✓ Installed to ${mcpState.installed?.join(', ') || ''}. Restart any open Claude session to pick it up.`
                    : mcpState.error}
                </div>
              )}
              <button onClick={onRerunSetup} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40">
                <RotateCcw size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                Re-run first-time setup
              </button>
            </div>
          </Section>

          {/* Tab visibility — hide tabs you never use. */}
          <Section
            id="tabs"
            icon={Rows3}
            title="Tabs"
            desc="Hide tabs you don't use. They stay registered (so cross-tab nav still works); they just don't render in the tab bar."
          >
            <TabsVisibilityPanel />
          </Section>

          <Section
            id="presets"
            icon={Eye}
            title="Presets"
            desc="App-provided snippets and agents update with TerMinal. Hide the ones you do not want; custom global/repo items remain user-owned."
          >
            <PresetVisibilityPanel />
          </Section>

          {/* Harness self-status — meta-observability snapshot. */}
          <Section
            id="status"
            icon={Activity}
            title="Harness status"
            desc="How TerMinal's own infrastructure is doing right now. Refreshes every 5s."
          >
            <HarnessStatusPanel />
          </Section>

          {/* In-app rebuild — eats own dog food. Spawns bin/release fully
              detached so it survives the pkill mid-flow + lands a fresh app
              in /Applications + relaunches. */}
          <Section
            id="rebuild"
            icon={PackageOpen}
            title="Rebuild + reinstall"
            desc="Run bin/release from inside the app — fetches latest when safe, builds, signs, replaces the installed app, relaunches. Source checkout must be on this machine."
          >
            <RebuildPanel />
          </Section>

          <div className="px-5 py-3 text-center text-[10.5px] text-zinc-600">
            TerMinal · settings stored in ~/.config/TerMinal/settings.json
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
