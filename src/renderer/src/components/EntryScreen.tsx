import { useEffect, useState } from 'react'
import {
  X,
  FolderOpen,
  Plus,
  GitBranch,
  SquareTerminal,
  RefreshCw,
  Server,
  ArrowUp,
  Home,
  Check,
  Search,
  Zap,
  Pin,
  Repeat,
} from 'lucide-react'
import type {
  Engine,
  RemoteDirList,
  RemoteHost,
  RemoteSession,
  SessionEngine,
  SessionMeta,
} from '../lib/types'
import { engineLabel, sessionEngineLabel, ENGINE_MODELS } from '../lib/engines'
import { EngineLogo } from './EngineLogo'
import { ModelSelect } from './ModelSelect'
import logo from '../assets/logo.png'
import { filterSessionMetas } from '../lib/sessionSearch'

export type Choice = {
  mode: 'new' | 'resume'
  engine: SessionEngine
  /** Model to launch the engine with (--model). Undefined = engine/global default. */
  model?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: RemoteSession
  /** Set on the two sessions of a live-paired loop, linking them to a loop id. */
  loopId?: string
  loopRole?: 'driver' | 'worker'
  /** Which harness runs an `openrouter` session (default 'codex'). */
  openrouterHarness?: 'codex' | 'hermes'
}

// Loop roles run interactive skill-driven agents (openrouter is a harness
// dimension, not a role engine; local is not an agent).
export type LoopEngine = 'claude' | 'codex' | 'cursor' | 'hermes'
export const LOOP_ENGINES: LoopEngine[] = ['claude', 'codex', 'cursor', 'hermes']
export type PairedLoopConfig = {
  goal: string
  repoRoot: string
  driver: { engine: LoopEngine; model?: string }
  worker: { engine: LoopEngine; model?: string }
}

// One loop role's engine + model, compact enough to sit two-up in the New
// workspace screen (no separate modal).
function RoleCard({
  label,
  hint,
  engine,
  model,
  onEngine,
  onModel,
}: {
  label: string
  hint: string
  engine: LoopEngine
  model: string
  onEngine: (e: LoopEngine) => void
  onModel: (m: string) => void
}) {
  return (
    <div className="flex-1 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3">
      <div className="text-[12px] font-semibold text-zinc-200">{label}</div>
      <div className="mb-2 text-[10px] text-zinc-600">{hint}</div>
      <div className="mb-2 grid grid-cols-3 gap-1">
        {LOOP_ENGINES.map((e) => (
          <button
            key={e}
            onClick={() => {
              onEngine(e)
              onModel('') // model is engine-specific — reset to the new engine's default
            }}
            className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-[11px] transition-colors ${
              engine === e
                ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <EngineLogo engine={e} size={12} />
            {engineLabel(e)}
          </button>
        ))}
      </div>
      <select
        value={model}
        onChange={(e) => onModel(e.target.value)}
        className="w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
      >
        <option value="">Default model</option>
        {ENGINE_MODELS[engine].map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function rel(ms: number): string {
  const s = (Date.now() - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const isRemotePath = (p: string) => p.startsWith('ssh://')
const pathLabel = (p: string) => {
  if (isRemotePath(p)) {
    const rest = p.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
    return (
      remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() ||
      (slash >= 0 ? rest.slice(0, slash) : rest)
    )
  }
  return p.replace(/\/$/, '').split('/').pop() || p
}
const remoteDisplayPath = (p: string) =>
  p.startsWith('/home/') ? p.replace(/^\/home\/[^/]+/, '~') : p
const isAiEngine = (value: SessionEngine): value is Engine => value !== 'local'
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const SESSION_PAGE_SIZE = 50
const readWorkspaceList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? [...new Set(parsed.filter((x): x is string => typeof x === 'string'))] : []
  } catch {
    return []
  }
}

export function EntryScreen({
  onChoose,
  onCancel,
  lockedCwd,
  lockedRemote,
  initialMode = 'single',
  onStartLoop,
}: {
  onChoose: (c: Choice) => void
  onCancel?: () => void
  /** When set, the EntryScreen is being opened inside an existing workspace to
   *  add a session — the repo is fixed, so the cwd picker and the scaffold/
   *  project-browser sections are hidden. Resume listing is auto-filtered to
   *  this repo. */
  lockedCwd?: string
  lockedRemote?: RemoteSession
  /** 'loop' opens the screen in live-paired loop mode (goal + two role agents). */
  initialMode?: 'single' | 'loop'
  /** Launches a live-paired loop; resolves to an error string on failure. */
  onStartLoop?: (cfg: PairedLoopConfig) => Promise<{ ok: boolean; error?: string }>
}) {
  // 'single' → one session (default). 'loop' → two linked role agents.
  const [mode, setMode] = useState<'single' | 'loop'>(initialMode)
  useEffect(() => setMode(initialMode), [initialMode])
  // Live-paired loop fields (mode === 'loop').
  const [goal, setGoal] = useState('')
  const [workerEngine, setWorkerEngine] = useState<LoopEngine>('claude')
  const [workerModel, setWorkerModel] = useState('')
  const [driverEngine, setDriverEngine] = useState<LoopEngine>('claude')
  const [driverModel, setDriverModel] = useState('')
  const [loopBusy, setLoopBusy] = useState(false)
  const [loopErr, setLoopErr] = useState('')
  const [sessionsByEngine, setSessionsByEngine] = useState<Partial<Record<Engine, SessionMeta[]>>>(
    {},
  )
  const [loadingSessions, setLoadingSessions] = useState<Partial<Record<Engine, boolean>>>({})
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_PAGE_SIZE)
  const [sessionSearch, setSessionSearch] = useState('')
  const [cwd, setCwd] = useState(lockedRemote?.cwd || lockedCwd || '') // new-session target
  const [filterDir, setFilterDir] = useState(lockedCwd || '') // resume filter ('' = all)
  const [engine, setEngine] = useState<SessionEngine>('local')
  const [model, setModel] = useState<string | undefined>(undefined) // '' semantics: undefined = engine default
  const [openrouterHarness, setOpenrouterHarness] = useState<'codex' | 'hermes'>('codex')
  const [location, setLocation] = useState<'local' | 'remote'>(lockedRemote ? 'remote' : 'local')
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([])
  const [remoteHostId, setRemoteHostId] = useState(lockedRemote?.hostId || '')
  const [name, setName] = useState('')
  // "new project from template" scaffold form
  const [projName, setProjName] = useState('')
  const [projParent, setProjParent] = useState('')
  const [scaffoldBusy, setScaffoldBusy] = useState(false)
  const [scaffoldErr, setScaffoldErr] = useState('')
  // After a local scaffold, show the module selection modal before opening the project.
  const [defaultParent, setDefaultParent] = useState('') // configured projects dir ('' → ~)
  const [remoteListing, setRemoteListing] = useState<RemoteDirList | null>(null)
  const [remoteListingLoading, setRemoteListingLoading] = useState(false)
  const [remoteListingErr, setRemoteListingErr] = useState('')
  const [pinnedWorkspaces, setPinnedWorkspaces] = useState<string[]>(() =>
    readWorkspaceList('gt.pinnedWorkspaces'),
  )
  const parentLabel = defaultParent ? tilde(defaultParent) : '~'

  const togglePin = (path: string) => {
    setPinnedWorkspaces((prev) => {
      const next = prev.includes(path) ? prev.filter((x) => x !== path) : [path, ...prev]
      localStorage.setItem('gt.pinnedWorkspaces', JSON.stringify(next))
      return next
    })
  }

  const pickParent = async () => {
    if (location === 'remote') {
      setProjParent(cwd || remoteListing?.cwd || '')
      return
    }
    const d = await window.gt.pickDir()
    if (d) setProjParent(d)
  }
  const createProject = async () => {
    if (!projName.trim() || scaffoldBusy) return
    setScaffoldBusy(true)
    setScaffoldErr('')
    const parent = location === 'remote' ? projParent || cwd || undefined : projParent || undefined
    const r =
      location === 'remote' && remoteHostId
        ? await window.gt.remoteScaffoldProject(remoteHostId, projName.trim(), parent)
        : await window.gt.scaffoldProject(projName.trim(), parent)
    setScaffoldBusy(false)
    if (r.ok && r.path) {
      if (location === 'remote') {
        const host = remoteHosts.find((h) => h.id === remoteHostId)
        if (!host) return setScaffoldErr('remote host not found')
        onChoose({
          mode: 'new',
          engine: engine === 'local' ? host.daemon.defaultEngine || 'claude' : engine,
          cwd: r.path,
          remote: {
            hostId: host.id,
            label: host.label || host.sshTarget,
            sshTarget: host.sshTarget,
            cwd: r.path,
            platform: host.platform,
            daemon: host.daemon,
          },
        })
      } else {
        // Local: open the newly-scaffolded project.
        onChoose({ mode: 'new', engine, cwd: r.path })
      }
    } else {
      setScaffoldErr(r.error || 'scaffold failed')
    }
  }
  useEffect(() => {
    window.gt.settings.get().then((s) => {
      setDefaultParent(s.projectsDir)
      setRemoteHosts(s.remoteHosts || [])
      if (!remoteHostId && s.remoteHosts?.[0]) setRemoteHostId(s.remoteHosts[0].id)
    })
  }, [])

  const loadEngineSessions = async (target?: Engine, force = false) => {
    const next = target ?? (isAiEngine(engine) ? engine : null)
    if (!next || loadingSessions[next] || (!force && sessionsByEngine[next])) return
    setLoadingSessions((cur) => ({ ...cur, [next]: true }))
    try {
      // Let the loading affordance paint before the main process starts walking
      // transcript files. Even with the picker scan optimized, large local
      // session archives can take a beat.
      await nextFrame()
      const loaded = await window.gt.listSessions(next)
      setSessionsByEngine((cur) => ({ ...cur, [next]: loaded }))
      if (!cwd && loaded[0]?.cwd) setCwd(loaded[0].cwd)
    } finally {
      setLoadingSessions((cur) => ({ ...cur, [next]: false }))
    }
  }

  const selectEngine = (next: SessionEngine) => {
    setEngine(next)
    setModel(undefined) // model is engine-specific — reset to the new engine's default
    setVisibleSessionCount(SESSION_PAGE_SIZE)
    if (isAiEngine(next)) loadEngineSessions(next)
  }
  const switchMode = (next: 'single' | 'loop') => {
    setMode(next)
    setLoopErr('')
    // Loops run in a local git worktree — remote daemons aren't supported.
    if (next === 'loop' && location === 'remote') switchLocation('local')
  }
  const switchLocation = (next: 'local' | 'remote') => {
    setLocation(next)
    setFilterDir('')
    if (lockedCwd) return
    if (next === 'local') {
      setCwd('')
      setProjParent('')
      return
    }
    const host = remoteHosts.find((h) => h.id === remoteHostId) || remoteHosts[0]
    if (host) {
      setRemoteHostId(host.id)
      const nextCwd = host.defaultCwd || host.daemon.projectsDir || ''
      setCwd(nextCwd)
      setProjParent(nextCwd)
      if (engine === 'local') setEngine(host.daemon.defaultEngine || 'claude')
    } else {
      setCwd('')
      setProjParent('')
    }
  }

  useEffect(() => {
    setVisibleSessionCount(SESSION_PAGE_SIZE)
  }, [engine, filterDir, sessionSearch])

  // One-click throwaway session: spin up an engine in the app-owned scratch dir
  // (no repo, no folder-picking). For a quick chat you don't want to file away.
  const startScratch = async (e: SessionEngine) => {
    const dir = await window.gt.scratchDir()
    onChoose({ mode: 'new', engine: e, cwd: dir, name: 'scratch' })
  }
  const loopRepoRoot = (lockedCwd || cwd).trim()
  const launchLoop = async () => {
    const g = goal.trim()
    if (!g || !loopRepoRoot || loopBusy || !onStartLoop) return
    setLoopBusy(true)
    setLoopErr('')
    const res = await onStartLoop({
      goal: g,
      repoRoot: loopRepoRoot,
      driver: { engine: driverEngine, model: driverModel || undefined },
      worker: { engine: workerEngine, model: workerModel || undefined },
    })
    // On success, App closes this screen and splits the two sessions.
    if (!res.ok) {
      setLoopErr(res.error || 'Could not start the paired loop.')
      setLoopBusy(false)
    }
  }
  // selecting a folder targets the new session there AND filters resume to it
  const selectDir = (path: string) => {
    setCwd(path)
    setFilterDir(path)
  }
  const browse = async () => {
    const dir = await window.gt.pickDir()
    if (dir) selectDir(dir)
  }

  // hermes/openrouter have no TerMinal-resumable transcripts — hide the resume list.
  const canResume =
    isAiEngine(engine) && engine !== 'hermes' && engine !== 'openrouter' && location === 'local' && !lockedRemote
  const sessions = canResume ? sessionsByEngine[engine] : undefined
  const scopedSessionCount = sessions ? filterSessionMetas(sessions, { filterDir }).length : 0
  const shown = sessions ? filterSessionMetas(sessions, { filterDir, query: sessionSearch }) : []
  const visibleShown = shown.slice(0, visibleSessionCount)
  const hiddenShown = Math.max(0, shown.length - visibleShown.length)
  const isLoadingThisEngine = canResume ? !!loadingSessions[engine] : false
  const remoteHost = lockedRemote
    ? {
        id: lockedRemote.hostId,
        label: lockedRemote.label,
        sshTarget: lockedRemote.sshTarget,
        defaultCwd: lockedRemote.cwd || '',
        platform: lockedRemote.platform || 'auto',
        daemon: lockedRemote.daemon,
      }
    : remoteHosts.find((h) => h.id === remoteHostId) || null
  const remoteCwd = cwd.trim() || remoteHost?.defaultCwd || remoteHost?.daemon?.projectsDir || ''

  const loadRemoteDir = async (path?: string, opts?: { select?: boolean }) => {
    if (!remoteHost) return
    const target = path || remoteCwd || '~'
    setRemoteListingLoading(true)
    setRemoteListingErr('')
    const r = await window.gt.remoteDirs(remoteHost.id, target)
    setRemoteListingLoading(false)
    setRemoteListing(r)
    if (r.error) {
      setRemoteListingErr(r.error)
      return
    }
    if (opts?.select) {
      setCwd(r.cwd)
      setProjParent(r.cwd)
    }
  }

  useEffect(() => {
    if (location !== 'remote' || !remoteHost) return
    setRemoteListing(null)
    setRemoteListingErr('')
    loadRemoteDir(remoteCwd || '~', { select: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, remoteHost?.id])

  const buildChoice = (): Choice => {
    const base = {
      mode: 'new' as const,
      engine,
      model: isAiEngine(engine) ? model : undefined,
      cwd: location === 'remote' ? remoteCwd : cwd.trim() || undefined,
      name: name.trim() || undefined,
      openrouterHarness: engine === 'openrouter' ? openrouterHarness : undefined,
    }
    if (location !== 'remote' || !remoteHost) return base
    return {
      ...base,
      remote: {
        hostId: remoteHost.id,
        label: remoteHost.label || remoteHost.sshTarget,
        sshTarget: remoteHost.sshTarget,
        cwd: remoteCwd,
        platform: remoteHost.platform,
        daemon: remoteHost.daemon,
      },
    }
  }
  const choiceFromRecent = (path: string): Choice => {
    if (!isRemotePath(path)) return { mode: 'new', engine, cwd: path }
    const rest = path.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const target = slash >= 0 ? rest.slice(0, slash) : rest
    const remotePath = slash >= 0 ? '/' + rest.slice(slash + 1).replace(/^\/+/, '') : '~'
    const host = remoteHosts.find(
      (h) => h.label === target || h.sshTarget === target || h.id === target,
    )
    if (!host) return { mode: 'new', engine, cwd: path }
    const resolvedEngine = engine === 'local' ? host.daemon.defaultEngine || 'claude' : engine
    return {
      mode: 'new',
      engine: resolvedEngine,
      cwd: remotePath,
      remote: {
        hostId: host.id,
        label: host.label || host.sshTarget,
        sshTarget: host.sshTarget,
        cwd: remotePath,
        platform: host.platform,
        daemon: host.daemon,
      },
    }
  }
  const resumeCountLabel = sessions
    ? ` · showing ${visibleShown.length} of ${shown.length}${
        scopedSessionCount !== shown.length ? ` (${scopedSessionCount} in scope)` : ''
      }`
    : ''
  const projectParentLabel =
    location === 'remote'
      ? remoteDisplayPath(projParent || cwd || remoteCwd || '~')
      : projParent
        ? tilde(projParent)
        : parentLabel
  const engineOptions = ['local', 'claude', 'codex', 'cursor', 'openrouter', 'hermes'] as SessionEngine[]
  const daemonLabel =
    location === 'remote' ? remoteHost?.label || remoteHost?.sshTarget || 'Remote SSH' : 'Local'
  const selectedWorkspaceLabel =
    location === 'remote'
      ? remoteDisplayPath(remoteListing?.cwd || remoteCwd || '~')
      : cwd.trim()
        ? tilde(cwd.trim())
        : '~'

  const sel =
    'rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
  const sectionTitle = 'text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500'
  const pickButton = (active: boolean, disabled = false) =>
    `group flex min-h-[44px] items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
      active
        ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
        : disabled
          ? 'cursor-not-allowed border-[var(--gt-border)] bg-black/10 text-zinc-700'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
    }`

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-[860px] px-8 py-9">
        <div className="mb-1 flex items-center gap-2.5">
          <img src={logo} alt="" draggable={false} className="h-9 w-9 rounded-lg" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">TerMinal</h1>
          <div className="flex-1" />
          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            >
              <X size={13} strokeWidth={2} />
              cancel
            </button>
          )}
        </div>
        <p className="mb-6 text-sm text-zinc-500">
          {lockedCwd ? (
            <>
              New session in <span className="font-mono text-zinc-300">{tilde(lockedCwd)}</span> —
              pick "Start" for a fresh session
              {lockedRemote ? '.' : ' or attach to a prior one below.'}
            </>
          ) : (
            <>
              Pick an engine, attach it to a local or SSH daemon profile, then choose the workspace
              that Tickets, MRs, Agents, Runs, Files, CI, and Search should read from.
            </>
          )}
        </p>

        {!lockedCwd && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] px-4 py-3">
            <Zap size={15} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-zinc-100">Scratch session</div>
              <div className="truncate text-[10.5px] text-zinc-600">
                Throwaway — spins up in <span className="font-mono">~/.config/TerMinal/scratch</span>, no repo attached
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {(['claude', 'codex', 'cursor', 'hermes', 'local'] as SessionEngine[]).map((e) => (
                <button
                  key={e}
                  onClick={() => startScratch(e)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                >
                  {e === 'local' ? (
                    <SquareTerminal size={13} strokeWidth={2} className="shrink-0" />
                  ) : (
                    <EngineLogo engine={e} size={13} />
                  )}
                  {sessionEngineLabel(e)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-5 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)]">
          <div className="flex items-center justify-between border-b border-[var(--gt-border)] px-4 py-3">
            <div>
              <div className="text-[12px] font-semibold text-zinc-100">New workspace session</div>
              <div className="mt-0.5 text-[10.5px] text-zinc-600">
                {daemonLabel} daemon · <span className="font-mono">{selectedWorkspaceLabel}</span>
              </div>
            </div>
            <span className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--gt-accent-2)]">
              {location === 'remote' ? 'SSH daemon' : 'Local daemon'}
            </span>
          </div>

          <div className="space-y-4 p-4">
            <div className="flex gap-1 rounded-xl border border-[var(--gt-border)] bg-black/20 p-1">
              {(['single', 'loop'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${
                    mode === m
                      ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {m === 'single' ? <SquareTerminal size={13} strokeWidth={2} /> : <Repeat size={13} strokeWidth={2} />}
                  {m === 'single' ? 'Single session' : 'Paired loop'}
                </button>
              ))}
            </div>
            {mode === 'loop' && (
              <div className="text-[10.5px] leading-relaxed text-zinc-600">
                Two linked agents in one worktree — a <span className="text-zinc-400">worker</span> writes code, a{' '}
                <span className="text-zinc-400">driver</span> negotiates the contract and grades it. Opened side by
                side, contract-first.
              </div>
            )}
            {!lockedCwd &&
              (() => {
                const pins = pinnedWorkspaces
                const recents = readWorkspaceList('gt.recentWorkspaces')
                  .filter((r) => !pins.includes(r))
                  .slice(0, 8)
                if (!pins.length && !recents.length) return null
                const chip = (r: string) => {
                  const isPinned = pins.includes(r)
                  return (
                    <div
                      key={r}
                      title={r}
                      className="group inline-flex max-w-[240px] items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 py-1.5 pl-2.5 pr-1 text-[12px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60"
                    >
                      <button
                        onClick={() => (mode === 'loop' ? selectDir(r) : onChoose(choiceFromRecent(r)))}
                        className="inline-flex min-w-0 items-center gap-1.5 text-left"
                      >
                        {isRemotePath(r) ? (
                          <Server
                            size={12}
                            strokeWidth={2}
                            className="shrink-0 text-[var(--gt-accent-2)]"
                          />
                        ) : (
                          <FolderOpen size={12} strokeWidth={2} className="shrink-0 text-zinc-500" />
                        )}
                        <span className="truncate">{pathLabel(r)}</span>
                        {isRemotePath(r) && (
                          <span className="rounded bg-[var(--gt-accent)]/15 px-1 text-[9px] uppercase tracking-wide text-[var(--gt-accent-2)]">
                            ssh
                          </span>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(r)
                        }}
                        title={isPinned ? 'Unpin workspace' : 'Pin workspace'}
                        className={`shrink-0 rounded p-0.5 transition-colors ${
                          isPinned
                            ? 'text-[var(--gt-accent-2)]'
                            : 'text-zinc-600 hover:text-zinc-300'
                        }`}
                      >
                        <Pin
                          size={12}
                          strokeWidth={2}
                          fill={isPinned ? 'currentColor' : 'none'}
                        />
                      </button>
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    {pins.length > 0 && (
                      <div>
                        <div className={`${sectionTitle} mb-2`}>Pinned</div>
                        <div className="flex flex-wrap gap-1.5">{pins.map(chip)}</div>
                      </div>
                    )}
                    {recents.length > 0 && (
                      <div>
                        <div className={`${sectionTitle} mb-2`}>Recent workspaces</div>
                        <div className="flex flex-wrap gap-1.5">{recents.map(chip)}</div>
                      </div>
                    )}
                  </div>
                )
              })()}

            {mode === 'single' && (
            <div>
              <div className={`${sectionTitle} mb-2`}>1 · Engine</div>
              <div className="grid grid-cols-3 gap-2">
                {engineOptions.map((e) => (
                  <button
                    key={e}
                    onClick={() => selectEngine(e)}
                    className={pickButton(engine === e)}
                  >
                    {e === 'local' ? (
                      <SquareTerminal size={16} strokeWidth={2} className="shrink-0" />
                    ) : (
                      <EngineLogo engine={e} size={16} />
                    )}
                    <span className="min-w-0 truncate text-[12.5px] font-semibold">{sessionEngineLabel(e)}</span>
                  </button>
                ))}
              </div>
              {engine === 'openrouter' && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-500">Harness</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['codex', 'hermes'] as const).map((h) => (
                      <button key={h} onClick={() => setOpenrouterHarness(h)} className={pickButton(openrouterHarness === h)}>
                        <EngineLogo engine={h} size={15} />
                        <span className="min-w-0 truncate text-[12px] font-semibold">{h === 'codex' ? 'Codex' : 'Hermes'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isAiEngine(engine) && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-500">Model</div>
                  <div className="max-h-[240px] overflow-y-auto pr-0.5">
                    <ModelSelect engine={engine} model={model} onChange={setModel} />
                  </div>
                </div>
              )}
            </div>
            )}

            {mode === 'loop' && (
              <>
                <div>
                  <div className={`${sectionTitle} mb-2`}>1 · Goal</div>
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="What should this loop converge on? (the driver turns this into a gradable contract)"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60"
                  />
                </div>
                <div>
                  <div className={`${sectionTitle} mb-2`}>2 · Role agents</div>
                  <div className="flex gap-3">
                    <RoleCard
                      label="Worker"
                      hint="writes code in the worktree"
                      engine={workerEngine}
                      model={workerModel}
                      onEngine={setWorkerEngine}
                      onModel={setWorkerModel}
                    />
                    <RoleCard
                      label="Driver"
                      hint="plans + grades, in the main repo"
                      engine={driverEngine}
                      model={driverModel}
                      onEngine={setDriverEngine}
                      onModel={setDriverModel}
                    />
                  </div>
                </div>
              </>
            )}

            {mode === 'single' && !lockedCwd && (
              <div>
                <div className={`${sectionTitle} mb-2`}>2 · Daemon profile</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => switchLocation('local')}
                    className={pickButton(location === 'local')}
                  >
                    <FolderOpen size={16} strokeWidth={2} className="shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">Local</span>
                  </button>
                  <button
                    onClick={() => switchLocation('remote')}
                    disabled={remoteHosts.length === 0}
                    className={pickButton(location === 'remote', remoteHosts.length === 0)}
                  >
                    <Server
                      size={16}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--gt-accent-2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">Remote SSH</span>
                  </button>
                </div>
                {remoteHosts.length === 0 && (
                  <div className="mt-2 text-[10.5px] text-zinc-600">
                    SSH profiles are configured in Settings → SSH Hosts, then tuned under Daemon
                    profile.
                  </div>
                )}
              </div>
            )}

            <div>
              <div className={`${sectionTitle} mb-2`}>{lockedCwd ? '2' : '3'} · Workspace</div>
              {location === 'remote' && (
                <div className="space-y-2">
                  <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                    <Server
                      size={13}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--gt-accent-2)]"
                    />
                    <span className="font-semibold text-zinc-200">Remote daemon</span>
                    <span className="truncate font-mono">
                      {remoteHost?.sshTarget || 'no host selected'}
                    </span>
                  </div>
                  {lockedRemote ? (
                    <div className="flex items-center gap-2 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] text-zinc-300">
                      <span>{lockedRemote.label || lockedRemote.sshTarget}</span>
                      <span className="font-mono text-zinc-600">{lockedRemote.sshTarget}</span>
                    </div>
                  ) : remoteHosts.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {remoteHosts.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => {
                            setRemoteHostId(h.id)
                            const nextCwd = h.defaultCwd || h.daemon.projectsDir || ''
                            setCwd(nextCwd)
                            setProjParent(nextCwd)
                          }}
                          className={`inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                            remoteHostId === h.id
                              ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 text-zinc-100'
                              : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                          }`}
                        >
                          <Server size={11} strokeWidth={2} className="shrink-0" />
                          <span className="truncate">{h.label || h.sshTarget}</span>
                          <span className="truncate font-mono text-zinc-600">{h.sshTarget}</span>
                          <span className="rounded bg-white/5 px-1 text-[9px] uppercase tracking-wide text-zinc-600">
                            {h.platform}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              {location === 'remote' && (
                <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20">
                  <div className="flex items-center gap-1.5 border-b border-[var(--gt-border)] p-2">
                    <input
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && loadRemoteDir(cwd, { select: true })}
                      placeholder={remoteHost?.defaultCwd || '~ (remote home)'}
                      spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[12px] text-zinc-200 outline-none placeholder:text-zinc-700"
                    />
                    <button
                      onClick={() => loadRemoteDir('~', { select: true })}
                      className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
                      title="Remote home"
                    >
                      <Home size={13} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() =>
                        remoteListing?.parent &&
                        loadRemoteDir(remoteListing.parent, { select: true })
                      }
                      disabled={!remoteListing?.parent}
                      className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200 disabled:opacity-35"
                      title="Parent folder"
                    >
                      <ArrowUp size={13} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() =>
                        loadRemoteDir(cwd || remoteListing?.cwd || '~', { select: true })
                      }
                      className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
                      title="Refresh"
                    >
                      <RefreshCw
                        size={13}
                        strokeWidth={2}
                        className={remoteListingLoading ? 'animate-spin' : ''}
                      />
                    </button>
                    <button
                      onClick={() => {
                        const selected = remoteListing?.cwd || cwd
                        setCwd(selected)
                        setProjParent(selected)
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1.5 text-[11px] text-zinc-100"
                    >
                      <Check size={12} strokeWidth={2.5} />
                      Use
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto p-1.5">
                    {remoteListingLoading && !remoteListing ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-zinc-600">
                        <RefreshCw size={12} strokeWidth={2} className="animate-spin" />
                        Loading folders…
                      </div>
                    ) : remoteListingErr ? (
                      <div className="px-2 py-3 text-[11px] text-[var(--gt-red)]">
                        {remoteListingErr}
                      </div>
                    ) : remoteListing && remoteListing.entries.length === 0 ? (
                      <div className="px-2 py-3 text-[11px] text-zinc-600">No child folders.</div>
                    ) : (
                      remoteListing?.entries.map((d) => (
                        <button
                          key={d.path}
                          onClick={() => loadRemoteDir(d.path, { select: true })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/5"
                        >
                          <FolderOpen
                            size={13}
                            strokeWidth={2}
                            className="shrink-0 text-zinc-500"
                          />
                          <span className="truncate">{d.name}</span>
                          <span className="ml-auto truncate font-mono text-[10px] text-zinc-700">
                            {remoteDisplayPath(d.path)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {lockedCwd && location === 'local' && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-[12px] text-zinc-300">
                  <FolderOpen size={13} strokeWidth={2} className="shrink-0 text-zinc-500" />
                  <span className="font-semibold text-zinc-200">Current workspace</span>
                  <span className="min-w-0 truncate font-mono text-zinc-500">
                    {tilde(lockedCwd)}
                  </span>
                </div>
              )}
              {!lockedCwd && location === 'local' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={browse}
                    className={`${sel} inline-flex shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}
                  >
                    <FolderOpen size={13} strokeWidth={2} />
                    Folder
                  </button>
                  <input
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder="~ (home)"
                    spellCheck={false}
                    className={`${sel} min-w-0 flex-1 font-mono`}
                  />
                </div>
              )}
            </div>

            {mode === 'single' && !lockedCwd && (
              <div>
                <div className={`${sectionTitle} mb-2`}>Optional · Create from template</div>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <input
                    value={projName}
                    onChange={(e) => {
                      setProjName(e.target.value)
                      setScaffoldErr('')
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && createProject()}
                    placeholder="project-name"
                    spellCheck={false}
                    className={`${sel} min-w-0 font-mono`}
                  />
                  <button
                    onClick={pickParent}
                    title="Choose parent directory"
                    className={`${sel} inline-flex max-w-[220px] shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}
                  >
                    {location === 'remote' ? (
                      <Server size={13} strokeWidth={2} />
                    ) : (
                      <FolderOpen size={13} strokeWidth={2} />
                    )}
                    <span className="truncate">{projectParentLabel}</span>
                  </button>
                  <button
                    onClick={createProject}
                    disabled={!projName.trim() || scaffoldBusy}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                  >
                    <Plus size={14} strokeWidth={2.5} />
                    {scaffoldBusy ? 'Creating…' : 'Create'}
                  </button>
                </div>
                {scaffoldErr && (
                  <div className="mt-1 text-[11px] text-[var(--gt-red)]">{scaffoldErr}</div>
                )}
              </div>
            )}

            {mode === 'single' ? (
              <div className="flex items-center gap-2 border-t border-[var(--gt-border)] pt-4">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="session name (optional)"
                  className={`${sel} min-w-0 flex-1`}
                />
                <button
                  onClick={() => onChoose(buildChoice())}
                  disabled={location === 'remote' && !remoteHost}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  New session
                </button>
              </div>
            ) : (
              <div className="border-t border-[var(--gt-border)] pt-4">
                {loopErr && <div className="mb-2 text-[11px] text-[var(--gt-red)]">{loopErr}</div>}
                <button
                  onClick={() => void launchLoop()}
                  disabled={!goal.trim() || !loopRepoRoot || loopBusy}
                  title={!loopRepoRoot ? 'Pick a workspace first' : undefined}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  <Repeat size={14} strokeWidth={2.5} />
                  {loopBusy ? 'Starting…' : 'Start paired loop'}
                </button>
              </div>
            )}
          </div>
        </div>

        {mode === 'single' && canResume && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Resume {engineLabel(engine)}
                {filterDir ? ` · ${filterDir.split('/').pop()}` : ''}
                {resumeCountLabel}
              </span>
              <button
                onClick={() => loadEngineSessions(undefined, true)}
                disabled={isLoadingThisEngine}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[11px] text-[var(--gt-accent-2)] hover:border-[var(--gt-accent)]/50 disabled:opacity-50"
              >
                <RefreshCw
                  size={11}
                  strokeWidth={2}
                  className={isLoadingThisEngine ? 'animate-spin' : ''}
                />
                {sessions ? 'refresh' : 'load sessions'}
              </button>
              {filterDir && (
                <button
                  onClick={() => setFilterDir('')}
                  className="text-[11px] text-[var(--gt-accent-2)] hover:underline"
                >
                  show all
                </button>
              )}
              {sessions && (
                <label className="relative ml-auto min-w-[180px]">
                  <Search
                    size={11}
                    strokeWidth={2}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600"
                  />
                  <input
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="search sessions..."
                    className="w-full rounded-md border border-[var(--gt-border)] bg-black/25 py-1 pl-6 pr-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60"
                  />
                </label>
              )}
            </div>
            {!sessions && !isLoadingThisEngine ? (
              <button
                onClick={() => loadEngineSessions()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-300"
              >
                <EngineLogo engine={engine} size={13} />
                Load prior {engineLabel(engine)} sessions
              </button>
            ) : isLoadingThisEngine ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-[12px] text-zinc-500">
                <RefreshCw size={13} strokeWidth={2} className="animate-spin" />
                Scanning {engineLabel(engine)} sessions…
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-600">
                {sessionSearch.trim()
                  ? 'No sessions match that search.'
                  : filterDir
                  ? 'No sessions for this folder — start a new one above.'
                  : `No prior ${engineLabel(engine)} sessions found.`}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleShown.map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      onChoose({ mode: 'resume', engine: s.engine, sessionId: s.id, cwd: s.cwd })
                    }
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 text-left hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-zinc-100">
                        {s.firstUserText || (
                          <span className="italic text-zinc-500">untitled session</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-zinc-500">
                        <EngineLogo engine={s.engine} size={10} />
                        <span className="font-mono">{tilde(s.cwd) || '~'}</span>
                        {s.gitBranch && (
                          <span className="inline-flex items-center gap-0.5 text-zinc-600">
                            <GitBranch size={11} strokeWidth={2} />
                            {s.gitBranch}
                          </span>
                        )}
                        <span className="text-zinc-600">· {s.turns} turns</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10.5px] text-zinc-500">
                      <div>{rel(s.mtime)}</div>
                      <div className="font-mono text-zinc-600">{s.id.slice(0, 8)}</div>
                    </div>
                  </button>
                ))}
                {hiddenShown > 0 && (
                  <button
                    onClick={() => setVisibleSessionCount((n) => n + SESSION_PAGE_SIZE)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] bg-black/10 p-3 text-[12px] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-300"
                  >
                    Load {Math.min(SESSION_PAGE_SIZE, hiddenShown)} more
                    <span className="text-zinc-700">· {hiddenShown} remaining</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
