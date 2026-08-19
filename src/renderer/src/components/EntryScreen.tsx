import { useEffect, useMemo, useState } from 'react'
import {
  X,
  FolderOpen,
  Plus,
  GitBranch,
  SquareTerminal,
  RefreshCw,
  Server,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Home,
  Check,
  Search,
  Zap,
  Pin,
  Repeat,
  FolderPlus,
} from 'lucide-react'
import type {
  Engine,
  LoopEngine,
  RemoteDirList,
  RemoteHost,
  RemoteSession,
  SavedPrompt,
  SessionEngine,
  SessionMeta,
} from '../lib/types'
import { engineLabel, sessionEngineLabel, ENGINE_MODELS, ENGINE_IDS } from '../lib/engines'
import { useExperiment } from '../lib/useExperiment'
import { EngineLogo } from './EngineLogo'
import { EffortDropdown, ModelDropdown } from './ModelSelect'
import logo from '../assets/logo.png'
import { filterSessionMetas } from '../lib/sessionSearch'
import { repoOrientationPendingKey } from '../lib/orientation'
import { relativeTime } from '../lib/time'
import { SpawnOptions, type SpawnOptionsValue } from './SpawnOptions'
import { clampSpawnCount, DEFAULT_SPAWN } from '../lib/spawnOptions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export type Choice = {
  mode: 'new' | 'resume'
  engine: SessionEngine
  /** Model to launch the engine with (--model). Undefined = engine/global default. */
  model?: string
  /** Reasoning-effort level for the engine. Undefined = engine/global default. */
  effort?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  /** Text typed into the new session's input and LEFT UNSENT (spawn options'
   *  prompt library). Distinct from initialInput, which is submitted as the
   *  session's first turn. */
  prefillInput?: string
  /** Spawn this many identical sessions (spawn options' multiplier). Renderer-
   *  only: App fans it out into N single sessions, so it never reaches main. */
  spawnCount?: number
  /** Submit initialInput automatically (send Enter). For sessions started with
   *  no one at the Mac — e.g. spawned from the phone — that would otherwise sit
   *  unsubmitted in the prompt. */
  autoSubmit?: boolean
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
export type { LoopEngine }
export const LOOP_ENGINES: LoopEngine[] = ['claude', 'codex', 'cursor', 'pi', 'hermes']
export type PairedLoopConfig = {
  goal: string
  repoRoot: string
  // 'paired' — two live sessions (driver + worker) grade each other.
  // 'single' — one live generator session; TerMinal spawns a fresh grader after
  //            each of its turns (warm generator, always-fresh evaluator).
  topology: 'paired' | 'single'
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
                ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
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
  // No seconds tier here — a repo opened 12s ago is just "recent".
  return Date.now() - ms < 60_000 ? 'just now' : relativeTime(ms)
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
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((x): x is string => typeof x === 'string'))]
      : []
  } catch {
    return []
  }
}
// Last engine picked on this screen — restored as the preselected default
// (with a "Recent" tag) the next time the screen opens.
const LAST_ENGINE_KEY = 'gt.lastEngine'
const readLastEngine = (): SessionEngine | null => {
  try {
    const v = localStorage.getItem(LAST_ENGINE_KEY)
    return v && (v === 'local' || (ENGINE_IDS as readonly string[]).includes(v))
      ? (v as SessionEngine)
      : null
  } catch {
    return null
  }
}

/** What the user is launching. Picked in step 1 as a select — one wizard, not
 *  four parallel tabs, so every path answers one question per step. */
type Intent = 'new' | 'resume' | 'loop' | 'scratch' | 'repo'
const INTENTS: { id: Intent; label: string; hint: string; icon: typeof SquareTerminal }[] = [
  {
    id: 'new',
    label: 'New session',
    hint: 'Pick a workspace and start an agent in it.',
    icon: SquareTerminal,
  },
  { id: 'resume', label: 'Resume a session', hint: 'Pick up a prior session.', icon: RefreshCw },
  {
    id: 'loop',
    label: 'Paired loop',
    hint: 'Two agents grade each other until the goal is met.',
    icon: Repeat,
  },
  { id: 'scratch', label: 'Scratch session', hint: 'Throwaway — no repo attached.', icon: Zap },
  {
    id: 'repo',
    label: 'New repo',
    hint: 'Scaffold a project from your template, then open it.',
    icon: FolderPlus,
  },
]

type StepId = 'start' | 'workspace' | 'model' | 'project' | 'goal' | 'roles' | 'sessions' | 'review'
const STEP_TITLE: Record<StepId, string> = {
  start: 'Start',
  workspace: 'Workspace',
  model: 'Model',
  project: 'Project',
  goal: 'Goal',
  roles: 'Agents',
  sessions: 'Session',
  review: 'Review',
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
  // Loops are experimental: with the flag off there is no loop mode at all, and
  // `loops:create` refuses in main regardless of what this screen renders.
  const loopsOn = useExperiment('loops')
  // Top-level intent: which of the launch actions the user is composing. It is
  // the first field of the wizard (a select), not a tab bar — every intent runs
  // through the same one-question-per-step form.
  const [intent, setIntent] = useState<Intent>(initialMode === 'loop' ? 'loop' : 'new')
  // Index into `steps` (derived from the intent below).
  const [stepIndex, setStepIndex] = useState(0)
  useEffect(() => setIntent(initialMode === 'loop' ? 'loop' : 'new'), [initialMode])
  // Flipping the flag off while the screen sits in loop mode must not leave a
  // loop form on screen with a launch button main would reject.
  useEffect(() => {
    if (!loopsOn) setIntent((i) => (i === 'loop' ? 'new' : i))
  }, [loopsOn])
  // Live-paired loop fields (mode === 'loop').
  const [goal, setGoal] = useState('')
  // Loop topology: 'paired' (two live sessions) vs 'single' (one live generator
  // + an ephemeral auto-grader per turn). Named apart from `mode` above, whose
  // 'single' means "one ordinary session" — a different axis entirely.
  const [loopTopology, setLoopTopology] = useState<'paired' | 'single'>('paired')
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
  // Captured once at mount — the tag stays on the restored engine even as the
  // user clicks around; clicks persist for the NEXT open via selectEngine.
  const [recentEngine] = useState<SessionEngine | null>(readLastEngine)
  const [engine, setEngine] = useState<SessionEngine>(recentEngine ?? 'local')
  // Resume is self-contained: its own engine, independent of the New-session picker.
  const [resumeEngine, setResumeEngine] = useState<Engine>(
    recentEngine && isAiEngine(recentEngine) && recentEngine !== 'openrouter'
      ? recentEngine
      : 'claude',
  )
  const [model, setModel] = useState<string | undefined>(undefined) // '' semantics: undefined = engine default
  const [effort, setEffort] = useState<string | undefined>(undefined) // undefined = engine default
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
  // Read once: the list must not reshuffle under the user mid-wizard.
  const [recentWorkspaces] = useState<string[]>(() => readWorkspaceList('gt.recentWorkspaces'))
  // Spawn options apply to every NEW session this screen can start — workspace,
  // scratch, a freshly scaffolded repo, and the recent-workspace chips.
  // Deliberately NOT persisted: every visit (and every spawn within a visit)
  // starts at ×1 / None, so picking a multiplier or a prompt is always an
  // explicit per-spawn act, never a sticky default carried over silently.
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([])
  const [spawn, setSpawn] = useState<SpawnOptionsValue>(DEFAULT_SPAWN)
  const changeSpawn = (next: SpawnOptionsValue) => setSpawn(next)
  const persistPrompts = (next: SavedPrompt[]) => {
    setSavedPrompts(next)
    window.gt.settings.patch({ savedPrompts: next }).catch(() => {})
  }
  /** Stamp the spawn options onto a NEW-session choice, then reset the picker
   *  back to ×1 / None so a second spawn in the same visit is just as explicit. */
  const withSpawn = (c: Choice): Choice => {
    const stamped: Choice = {
      ...c,
      prefillInput: spawn.text.replace(/\s+$/, '') || undefined,
      spawnCount: clampSpawnCount(spawn.count) > 1 ? clampSpawnCount(spawn.count) : undefined,
    }
    setSpawn(DEFAULT_SPAWN)
    return stamped
  }
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
    // Ticket provider is chosen in the per-repo orientation modal on first
    // open, not here — every scaffold starts on the local backlog.
    const r =
      location === 'remote' && remoteHostId
        ? await window.gt.remoteScaffoldProject(remoteHostId, projName.trim(), parent)
        : await window.gt.scaffoldProject(projName.trim(), parent)
    setScaffoldBusy(false)
    if (r.ok && r.path) {
      if (location === 'remote') {
        const host = remoteHosts.find((h) => h.id === remoteHostId)
        if (!host) return setScaffoldErr('remote host not found')
        onChoose(
          withSpawn({
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
          }),
        )
      } else {
        // Local: open the newly-scaffolded project. The pending marker
        // guarantees the per-repo orientation (provider choice) shows on this
        // first open (see shouldAutoShowRepoOrientation).
        try {
          localStorage.setItem(repoOrientationPendingKey(r.path), '1')
        } catch {
          /* ignore */
        }
        onChoose(withSpawn({ mode: 'new', engine, cwd: r.path }))
      }
    } else {
      setScaffoldErr(r.error || 'Scaffold failed')
    }
  }
  useEffect(() => {
    window.gt.settings.get().then((s) => {
      setDefaultParent(s.projectsDir)
      setSavedPrompts(s.savedPrompts || [])
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
  // A restored recent engine should behave like a click — load its resume list.
  useEffect(() => {
    if (isAiEngine(resumeEngine) && resumeEngine !== 'openrouter') loadEngineSessions(resumeEngine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectEngine = (next: SessionEngine) => {
    setEngine(next)
    try {
      localStorage.setItem(LAST_ENGINE_KEY, next)
    } catch {
      /* ignore */
    }
    setModel(undefined) // model is engine-specific — reset to the new engine's default
    setEffort(undefined) // effort levels are engine-specific too
  }
  const selectResumeEngine = (next: Engine) => {
    setResumeEngine(next)
    setVisibleSessionCount(SESSION_PAGE_SIZE)
    if (next !== 'openrouter') loadEngineSessions(next)
  }
  const selectIntent = (next: Intent) => {
    setIntent(next)
    setLoopErr('')
    setScaffoldErr('')
    // Loops run in a local git worktree — remote daemons aren't supported.
    if (next === 'loop' && location === 'remote') switchLocation('local')
    if (next === 'resume' && isAiEngine(resumeEngine) && resumeEngine !== 'openrouter') {
      void loadEngineSessions(resumeEngine)
    }
  }
  const switchLocation = (next: 'local' | 'remote') => {
    setLocation(next)
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

  // Throwaway session: spin up the picked engine in the app-owned scratch dir
  // (no repo, no folder-picking). For a quick chat you don't want to file away.
  const startScratch = async () => {
    const dir = await window.gt.scratchDir()
    onChoose(
      withSpawn({
        mode: 'new',
        engine,
        model: isAiEngine(engine) ? model : undefined,
        effort: isAiEngine(engine) ? effort : undefined,
        cwd: dir,
        name: 'scratch',
        openrouterHarness: engine === 'openrouter' ? openrouterHarness : undefined,
      }),
    )
  }
  const loopRepoRoot = (lockedCwd || cwd).trim()
  const launchLoop = async () => {
    const g = goal.trim()
    if (!g || !loopRepoRoot || loopBusy || !onStartLoop || !loopsOn) return
    setLoopBusy(true)
    setLoopErr('')
    const res = await onStartLoop({
      goal: g,
      repoRoot: loopRepoRoot,
      topology: loopTopology,
      driver: { engine: driverEngine, model: driverModel || undefined },
      worker: { engine: workerEngine, model: workerModel || undefined },
    })
    // On success, App closes this screen and opens the loop's session(s).
    if (!res.ok) {
      setLoopErr(res.error || 'Could not start the loop.')
      setLoopBusy(false)
    }
  }
  /** Point the form at a workspace. Pinned/recent chips SELECT — they never
   *  launch — so the user can pick a repo and then keep customizing the model.
   *  A remote (`ssh://host/path`) chip also flips the form to that host. */
  const selectWorkspace = (path: string) => {
    if (!isRemotePath(path)) {
      setLocation('local')
      setCwd(path)
      setProjParent('')
      return
    }
    const rest = path.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const target = slash >= 0 ? rest.slice(0, slash) : rest
    const remotePath = slash >= 0 ? '/' + rest.slice(slash + 1).replace(/^\/+/, '') : '~'
    const host = remoteHosts.find(
      (h) => h.label === target || h.sshTarget === target || h.id === target,
    )
    if (!host) return setCwd(path)
    setLocation('remote')
    setRemoteHostId(host.id)
    setCwd(remotePath)
    setProjParent(remotePath)
    if (engine === 'local') setEngine(host.daemon.defaultEngine || 'claude')
  }
  const browse = async () => {
    const dir = await window.gt.pickDir()
    if (!dir) return
    selectWorkspace(dir)
  }

  // openrouter is one-shot with no resumable local store — hide its resume list.
  // Hermes resumes from its ~/.hermes SQLite store, so it's allowed.
  const canResume = isAiEngine(resumeEngine) && resumeEngine !== 'openrouter' && !lockedRemote
  const sessions = canResume ? sessionsByEngine[resumeEngine] : undefined
  /** The workspace the resume list is scoped to. Empty = every workspace —
   *  `lockedCwd` pins it, otherwise it's whatever the workspace step selected. */
  const resumeDir = (lockedCwd || cwd).trim()
  // Memoized — these scans (6 fields per session) used to re-run on every
  // keystroke AND every unrelated re-render of this large component.
  const shown = useMemo(
    () =>
      sessions ? filterSessionMetas(sessions, { query: sessionSearch, filterDir: resumeDir }) : [],
    [sessions, sessionSearch, resumeDir],
  )
  // Any change to what the list is scoped by starts the paging over.
  useEffect(() => {
    setVisibleSessionCount(SESSION_PAGE_SIZE)
  }, [resumeEngine, sessionSearch, resumeDir])
  const visibleShown = shown.slice(0, visibleSessionCount)
  const hiddenShown = Math.max(0, shown.length - visibleShown.length)
  const isLoadingThisEngine = canResume ? !!loadingSessions[resumeEngine] : false
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
  /** The path currently targeted, in the same spelling the chips use — so a
   *  chip can render as selected. */
  const selectedWorkspacePath =
    location === 'remote' && remoteHost
      ? `ssh://${remoteHost.label || remoteHost.sshTarget}${remoteCwd.startsWith('/') ? '' : '/'}${remoteCwd}`
      : cwd.trim()

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
      effort:
        isAiEngine(engine) && !(engine === 'openrouter' && openrouterHarness === 'hermes')
          ? effort
          : undefined,
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
  const resumeCountLabel = sessions ? ` · ${shown.length}` : ''
  const projectParentLabel =
    location === 'remote'
      ? remoteDisplayPath(projParent || cwd || remoteCwd || '~')
      : projParent
        ? tilde(projParent)
        : parentLabel
  // Registry order + the bare shell. Derived so a newly registered engine can
  // never be silently missing here (this list and the scratch row below had
  // already drifted apart).
  const engineOptions = ['local', ...ENGINE_IDS] as SessionEngine[]
  const daemonLabel =
    location === 'remote' ? remoteHost?.label || remoteHost?.sshTarget || 'Remote SSH' : 'Local'
  const selectedWorkspaceLabel =
    location === 'remote'
      ? remoteDisplayPath(remoteListing?.cwd || remoteCwd || '~')
      : cwd.trim()
        ? tilde(cwd.trim())
        : '~'

  // ── Wizard ───────────────────────────────────────────────────────────────
  // One question per step. The step list is derived from the intent, so an
  // intent that needs no workspace (scratch) or no model (resume) never shows
  // that step at all.
  const intentOptions = INTENTS.filter(
    (i) =>
      (i.id !== 'loop' || loopsOn) &&
      (!lockedCwd || i.id === 'new' || i.id === 'resume' || i.id === 'loop'),
  )
  const steps: StepId[] = useMemo(() => {
    // Resume gets a workspace step too — the session list is long enough that
    // "which repo" is the first thing you actually filter by.
    if (intent === 'resume')
      return lockedCwd ? ['start', 'sessions'] : ['start', 'workspace', 'sessions']
    if (intent === 'scratch') return ['start', 'model', 'review']
    if (intent === 'repo') return ['start', 'project', 'model', 'review']
    if (intent === 'loop')
      return lockedCwd ? ['start', 'goal', 'roles'] : ['start', 'workspace', 'goal', 'roles']
    return lockedCwd ? ['start', 'model', 'review'] : ['start', 'workspace', 'model', 'review']
  }, [intent, lockedCwd])
  const step = steps[Math.min(stepIndex, steps.length - 1)]
  const stepNumber = steps.indexOf(step) + 1
  const back = () => setStepIndex((i) => Math.max(0, i - 1))
  const next = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1))
  // Changing the intent re-derives the steps; never strand the user past the end.
  useEffect(() => {
    setStepIndex((i) => Math.min(i, steps.length - 1))
  }, [steps.length])
  // A step that can't be left until its one question is answered. Everything
  // up to (and including) the FIRST such step is reachable, so the rail can be
  // clicked forward as well as back — you don't have to walk through Next.
  const stepBlocked = (s: StepId) =>
    (s === 'project' && !projName.trim()) ||
    (s === 'goal' && !goal.trim()) ||
    (s === 'workspace' && intent === 'loop' && !loopRepoRoot)
  const firstBlocked = steps.findIndex(stepBlocked)
  const maxReachable = firstBlocked === -1 ? steps.length - 1 : firstBlocked
  const nextBlocked = stepBlocked(step)

  const sectionTitle = 'text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500'
  const pickButton = (active: boolean, disabled = false) =>
    `group flex min-h-[44px] items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
      active
        ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
        : disabled
          ? 'cursor-not-allowed border-[var(--gt-border)] bg-black/10 text-zinc-700'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
    }`
  /** Compact inline option — the small-scale sibling of pickButton. Used where
   *  the whole option set fits on one row (hosts, resume engines). */
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
      active
        ? 'border-primary/70 bg-primary/15 text-foreground'
        : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
    }`

  const STEP_COPY: Record<StepId, { title: string; hint: string }> = {
    start: { title: 'What do you want to do?', hint: 'Everything else follows from this.' },
    workspace: {
      title: 'Which workspace?',
      hint: 'Pick a repo — nothing launches until the last step.',
    },
    model: { title: 'Which model?', hint: 'Engine first, then the model it runs.' },
    project: { title: 'Name the new project', hint: 'Cloned from your template repo.' },
    goal: {
      title: 'What should the loop converge on?',
      hint: 'The driver turns this into a gradable contract.',
    },
    roles: { title: 'Who runs the loop?', hint: 'Each role gets its own engine and model.' },
    sessions: {
      title: 'Pick a session to resume',
      hint: 'Sessions are listed per engine, newest first.',
    },
    review: { title: 'Ready to launch', hint: 'Last look before anything starts.' },
  }
  const { title: stepTitle, hint: stepHint } = STEP_COPY[step]
  const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

  // Pinned + recent workspaces, as SELECTABLE chips (they set the target repo;
  // the wizard's last step is the only thing that launches).
  const pins = pinnedWorkspaces
  const recents = recentWorkspaces.filter((r) => !pins.includes(r)).slice(0, 8)
  const workspaceChip = (r: string) => {
    const isPinned = pins.includes(r)
    const isSelected = !!selectedWorkspacePath && samePath(selectedWorkspacePath, r)
    return (
      <div
        key={r}
        title={r}
        className={`group inline-flex max-w-[240px] items-center gap-1 rounded-lg border py-1.5 pl-2.5 pr-1 text-[12px] transition-colors ${
          isSelected
            ? 'border-primary/70 bg-primary/15 text-foreground'
            : 'border-border bg-muted/30 text-foreground/80 hover:border-primary/60'
        }`}
      >
        <button
          onClick={() => selectWorkspace(r)}
          className="inline-flex min-w-0 items-center gap-1.5 text-left"
        >
          {isSelected ? (
            <Check size={12} strokeWidth={2.5} className="shrink-0 text-[var(--gt-accent-2)]" />
          ) : isRemotePath(r) ? (
            <Server size={12} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
          ) : (
            <FolderOpen size={12} strokeWidth={2} className="shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{pathLabel(r)}</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            togglePin(r)
          }}
          title={isPinned ? 'Unpin workspace' : 'Pin workspace'}
          className={`shrink-0 rounded p-0.5 transition-colors ${
            isPinned ? 'text-[var(--gt-accent-2)]' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Pin size={12} strokeWidth={2} fill={isPinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    )
  }

  const summaryRow = (label: string, value: string, mono = false) => (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`truncate text-foreground ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  )

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[720px] px-6 py-6">
        {/* Header */}
        <header className="mb-5 flex items-center gap-3">
          <img src={logo} alt="" draggable={false} className="h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="gt-grad-text text-[20px] font-bold leading-tight tracking-tight">
              TerMinal
            </h1>
            <p className="text-[12px] text-muted-foreground">
              {lockedCwd ? (
                <>
                  New session in{' '}
                  <span className="font-mono text-foreground/80">{tilde(lockedCwd)}</span>
                </>
              ) : (
                'A local-first cockpit for your coding agents.'
              )}
            </p>
          </div>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="size-3.5" /> Cancel
            </Button>
          )}
        </header>

        {/* Step rail — any reachable step is clickable, forward or back. A step
            is unreachable only when an earlier one is still unanswered. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {steps.map((s, i) => {
            const done = i < stepNumber - 1
            const active = i === stepNumber - 1
            const reachable = i <= maxReachable
            return (
              <button
                key={s}
                onClick={() => reachable && setStepIndex(i)}
                disabled={!reachable}
                title={reachable ? undefined : `Finish ${STEP_TITLE[steps[maxReachable]]} first`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'border-primary/60 bg-primary/15 text-foreground'
                    : reachable
                      ? 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      : 'cursor-not-allowed border-transparent text-muted-foreground/40'
                }`}
              >
                {done ? (
                  <Check size={11} strokeWidth={2.5} />
                ) : (
                  <span className="tabular-nums opacity-60">{i + 1}</span>
                )}
                {STEP_TITLE[s]}
              </button>
            )
          })}
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            {stepNumber}/{steps.length}
          </span>
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-primary transition-all"
            style={{ width: `${(stepNumber / steps.length) * 100}%` }}
          />
        </div>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-[13px]">{stepTitle}</CardTitle>
            <p className="text-[11px] text-muted-foreground">{stepHint}</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {/* ── Step · Start ─────────────────────────────────────────── */}
            {step === 'start' && (
              <div className="grid grid-cols-2 gap-2">
                {intentOptions.map(({ id, label, hint, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => selectIntent(id)}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      intent === id
                        ? 'border-primary/70 bg-primary/10'
                        : 'border-border bg-muted/20 hover:border-primary/50'
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 size-4 shrink-0 ${
                        intent === id ? 'text-[var(--gt-accent-2)]' : 'text-muted-foreground'
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-foreground">
                        {label}
                      </span>
                      <span className="block text-[10.5px] leading-snug text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* ── Step · Workspace ─────────────────────────────────────── */}
            {step === 'workspace' && (
              <>
                {/* Resume reads local transcript stores, so it has no remote
                    dimension — only "which repo". */}
                {intent !== 'loop' && intent !== 'resume' && (
                  <div>
                    <div className={sectionTitle + ' mb-1.5'}>Location</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => switchLocation('local')}
                        className={pickButton(location === 'local')}
                      >
                        <FolderOpen size={16} strokeWidth={2} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          Local
                        </span>
                      </button>
                      <button
                        onClick={() => switchLocation('remote')}
                        disabled={remoteHosts.length === 0}
                        className={pickButton(location === 'remote', remoteHosts.length === 0)}
                      >
                        <Server size={16} strokeWidth={2} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          Remote SSH
                        </span>
                      </button>
                    </div>
                    {remoteHosts.length === 0 && (
                      <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                        SSH profiles are configured in Settings → SSH Hosts.
                      </div>
                    )}
                  </div>
                )}

                {location === 'remote' && remoteHosts.length > 0 && (
                  <div>
                    <div className={sectionTitle + ' mb-1.5'}>Host</div>
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
                          className={chip(remoteHostId === h.id)}
                        >
                          <Server size={12} strokeWidth={2} className="shrink-0" />
                          <span className="max-w-[180px] truncate">{h.label || h.sshTarget}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {location === 'remote' ? (
                  <div className="rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center gap-1.5 border-b border-border p-2">
                      <Input
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadRemoteDir(cwd, { select: true })}
                        placeholder={remoteHost?.defaultCwd || '~ (remote home)'}
                        className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
                      />
                      <button
                        onClick={() => loadRemoteDir('~', { select: true })}
                        title="Remote home"
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        <Home size={13} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() =>
                          remoteListing?.parent &&
                          loadRemoteDir(remoteListing.parent, { select: true })
                        }
                        disabled={!remoteListing?.parent}
                        title="Parent folder"
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-35"
                      >
                        <ArrowUp size={13} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() =>
                          loadRemoteDir(cwd || remoteListing?.cwd || '~', { select: true })
                        }
                        title="Refresh"
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        <RefreshCw
                          size={13}
                          strokeWidth={2}
                          className={remoteListingLoading ? 'animate-spin' : ''}
                        />
                      </button>
                    </div>
                    <div className="max-h-44 overflow-y-auto p-1.5">
                      {remoteListingLoading && !remoteListing ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground">
                          <RefreshCw size={12} strokeWidth={2} className="animate-spin" /> Loading
                          folders…
                        </div>
                      ) : remoteListingErr ? (
                        <div className="px-2 py-3 text-[11px] text-destructive">
                          {remoteListingErr}
                        </div>
                      ) : remoteListing && remoteListing.entries.length === 0 ? (
                        <div className="px-2 py-3 text-[11px] text-muted-foreground">
                          No child folders.
                        </div>
                      ) : (
                        remoteListing?.entries.map((d) => (
                          <button
                            key={d.path}
                            onClick={() => loadRemoteDir(d.path, { select: true })}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-muted"
                          >
                            <FolderOpen
                              size={13}
                              strokeWidth={2}
                              className="shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{d.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {(pins.length > 0 || recents.length > 0) && (
                      <div className="space-y-2">
                        {pins.length > 0 && (
                          <div>
                            <div className={sectionTitle + ' mb-1.5'}>Pinned</div>
                            <div className="flex flex-wrap gap-1.5">{pins.map(workspaceChip)}</div>
                          </div>
                        )}
                        {recents.length > 0 && (
                          <div>
                            <div className={sectionTitle + ' mb-1.5'}>Recent</div>
                            <div className="flex flex-wrap gap-1.5">
                              {recents.map(workspaceChip)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className={sectionTitle + ' mb-1.5'}>Folder</div>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={browse}>
                          <FolderOpen size={13} strokeWidth={2} /> Browse
                        </Button>
                        <Input
                          value={cwd}
                          onChange={(e) => setCwd(e.target.value)}
                          placeholder={intent === 'resume' ? 'Every workspace' : '~ (home)'}
                          className="flex-1 font-mono"
                        />
                        {/* Resume can legitimately span every repo — a new
                            session cannot, so the escape hatch is resume-only. */}
                        {intent === 'resume' && cwd.trim() && (
                          <Button variant="ghost" size="sm" onClick={() => setCwd('')}>
                            <X className="size-3.5" /> Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Remote only — the local path input above already IS the
                    confirmation, so repeating it there is noise. */}
                {location === 'remote' && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[12px]">
                    <Check
                      size={13}
                      strokeWidth={2.5}
                      className="shrink-0 text-[var(--gt-accent-2)]"
                    />
                    <span className="shrink-0 text-muted-foreground">{daemonLabel}</span>
                    <span className="min-w-0 truncate font-mono text-foreground">
                      {selectedWorkspaceLabel}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── Step · Model ─────────────────────────────────────────── */}
            {step === 'model' && (
              <>
                <div>
                  <div className={sectionTitle + ' mb-1.5'}>Engine</div>
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
                        <span className="min-w-0 truncate text-[12.5px] font-semibold">
                          {sessionEngineLabel(e)}
                        </span>
                        {e === recentEngine && (
                          <span className="ml-auto shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--gt-accent-2)]">
                            Recent
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {engine === 'openrouter' && (
                  <div>
                    <div className={sectionTitle + ' mb-1.5'}>Harness</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(['codex', 'hermes'] as const).map((h) => (
                        <button
                          key={h}
                          onClick={() => setOpenrouterHarness(h)}
                          className={pickButton(openrouterHarness === h)}
                        >
                          <EngineLogo engine={h} size={15} />
                          <span className="min-w-0 truncate text-[12px] font-semibold">
                            {h === 'codex' ? 'Codex' : 'Hermes'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isAiEngine(engine) ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className={sectionTitle + ' mb-1.5'}>Model</div>
                      <ModelDropdown engine={engine} model={model} onChange={setModel} />
                    </div>
                    {!(engine === 'openrouter' && openrouterHarness === 'hermes') && (
                      <div>
                        <div className={sectionTitle + ' mb-1.5'}>Reasoning effort</div>
                        <EffortDropdown engine={engine} effort={effort} onChange={setEffort} />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-muted-foreground">
                    A plain shell — no model, no agent.
                  </p>
                )}
              </>
            )}

            {/* ── Step · Project (scaffold) ────────────────────────────── */}
            {step === 'project' && (
              <>
                {remoteHosts.length > 0 && (
                  <div>
                    <div className={sectionTitle + ' mb-1.5'}>Location</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => switchLocation('local')}
                        className={pickButton(location === 'local')}
                      >
                        <FolderOpen size={16} strokeWidth={2} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          Local
                        </span>
                      </button>
                      <button
                        onClick={() => switchLocation('remote')}
                        className={pickButton(location === 'remote')}
                      >
                        <Server size={16} strokeWidth={2} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          Remote SSH
                        </span>
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <div className={sectionTitle + ' mb-1.5'}>Name</div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={projName}
                      onChange={(e) => {
                        setProjName(e.target.value)
                        setScaffoldErr('')
                      }}
                      placeholder="project-name"
                      className="flex-1 font-mono"
                    />
                    <Button
                      variant="secondary"
                      onClick={pickParent}
                      title="Choose parent directory"
                    >
                      {location === 'remote' ? (
                        <Server size={13} strokeWidth={2} />
                      ) : (
                        <FolderOpen size={13} strokeWidth={2} />
                      )}
                      <span className="max-w-[180px] truncate">{projectParentLabel}</span>
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* ── Step · Loop goal ─────────────────────────────────────── */}
            {step === 'goal' && (
              <>
                <div>
                  <div className={sectionTitle + ' mb-1.5'}>Goal</div>
                  <Textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="What should this loop converge on?"
                    rows={4}
                  />
                </div>
                <div>
                  <div className={sectionTitle + ' mb-1.5'}>Topology</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['paired', 'Paired', 'Two live sessions grade each other'],
                        ['single', 'Single', 'One generator + a fresh grader per turn'],
                      ] as const
                    ).map(([val, label, hint]) => (
                      <button
                        key={val}
                        onClick={() => setLoopTopology(val)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          loopTopology === val
                            ? 'border-primary/70 bg-primary/10'
                            : 'border-border bg-muted/20 hover:border-primary/50'
                        }`}
                      >
                        <div className="text-[12.5px] font-semibold text-foreground">{label}</div>
                        <div className="text-[10.5px] leading-snug text-muted-foreground">
                          {hint}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── Step · Loop roles ────────────────────────────────────── */}
            {step === 'roles' && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[12px]">
                  <FolderOpen
                    size={13}
                    strokeWidth={2}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate font-mono text-foreground">
                    {tilde(loopRepoRoot) || '~'}
                  </span>
                  <Badge variant="secondary" className="ml-auto">
                    Local
                  </Badge>
                </div>
                <div className="flex gap-3">
                  <RoleCard
                    label={loopTopology === 'single' ? 'Generator' : 'Worker'}
                    hint={
                      loopTopology === 'single'
                        ? 'Writes code; a fresh grader reviews each turn'
                        : 'Writes code in the worktree'
                    }
                    engine={workerEngine}
                    model={workerModel}
                    onEngine={setWorkerEngine}
                    onModel={setWorkerModel}
                  />
                  {loopTopology === 'paired' && (
                    <RoleCard
                      label="Driver"
                      hint="Plans + grades, in the main repo"
                      engine={driverEngine}
                      model={driverModel}
                      onEngine={setDriverEngine}
                      onModel={setDriverModel}
                    />
                  )}
                </div>
                {loopErr && <div className="text-[11px] text-destructive">{loopErr}</div>}
              </>
            )}

            {/* ── Step · Resume ────────────────────────────────────────── */}
            {step === 'sessions' && (
              <>
                <div>
                  <div className={sectionTitle + ' mb-1.5'}>Engine</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ENGINE_IDS.filter((e) => e !== 'openrouter').map((e) => (
                      <button
                        key={e}
                        onClick={() => selectResumeEngine(e)}
                        className={chip(resumeEngine === e)}
                      >
                        <EngineLogo engine={e} size={12} />
                        {engineLabel(e)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* What the list is scoped to — the workspace step's answer. */}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <FolderOpen size={12} strokeWidth={2} className="shrink-0" />
                  {resumeDir ? (
                    <>
                      <span className="min-w-0 truncate font-mono text-foreground/80">
                        {tilde(resumeDir)}
                      </span>
                      <button
                        onClick={() => setCwd('')}
                        className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
                      >
                        show every workspace
                      </button>
                    </>
                  ) : (
                    <span>Every workspace</span>
                  )}
                  <span className="ml-auto shrink-0 text-[10.5px]">{resumeCountLabel}</span>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="shrink-0"
                    onClick={() => loadEngineSessions(resumeEngine, true)}
                    disabled={isLoadingThisEngine}
                  >
                    <RefreshCw
                      size={11}
                      strokeWidth={2}
                      className={isLoadingThisEngine ? 'animate-spin' : ''}
                    />
                    {sessions ? 'Refresh' : 'Load'}
                  </Button>
                </div>
                {sessions && (
                  <label className="relative block">
                    <Search
                      size={11}
                      strokeWidth={2}
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      placeholder="Search sessions…"
                      className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-6 pr-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
                    />
                  </label>
                )}
                {!sessions && !isLoadingThisEngine ? (
                  <button
                    onClick={() => loadEngineSessions(resumeEngine)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    <EngineLogo engine={resumeEngine} size={13} /> Load prior{' '}
                    {engineLabel(resumeEngine)} sessions
                  </button>
                ) : isLoadingThisEngine ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-[12px] text-muted-foreground">
                    <RefreshCw size={13} strokeWidth={2} className="animate-spin" /> Scanning{' '}
                    {engineLabel(resumeEngine)} sessions…
                  </div>
                ) : shown.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
                    {sessionSearch.trim()
                      ? 'No sessions match that search.'
                      : resumeDir
                        ? `No prior ${engineLabel(resumeEngine)} sessions in ${tilde(resumeDir)}.`
                        : `No prior ${engineLabel(resumeEngine)} sessions found.`}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {visibleShown.map((s) => (
                      <button
                        key={s.id}
                        onClick={() =>
                          onChoose({
                            mode: 'resume',
                            engine: s.engine,
                            sessionId: s.id,
                            cwd: s.cwd,
                          })
                        }
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-foreground">
                            {s.firstUserText || (
                              <span className="italic text-muted-foreground">Untitled session</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-muted-foreground">
                            <span className="font-mono">{tilde(s.cwd) || '~'}</span>
                            {s.gitBranch && (
                              <span className="inline-flex items-center gap-0.5 text-muted-foreground/70">
                                <GitBranch size={11} strokeWidth={2} /> {s.gitBranch}
                              </span>
                            )}
                            <span>· {s.turns} turns</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[10.5px] text-muted-foreground">
                          <div>{rel(s.mtime)}</div>
                          <div className="font-mono text-muted-foreground/70">
                            {s.id.slice(0, 8)}
                          </div>
                        </div>
                      </button>
                    ))}
                    {hiddenShown > 0 && (
                      <button
                        onClick={() => setVisibleSessionCount((n) => n + SESSION_PAGE_SIZE)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-2.5 text-[12px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        Load {Math.min(SESSION_PAGE_SIZE, hiddenShown)} more
                        <span className="text-muted-foreground/70">· {hiddenShown} remaining</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Step · Review ────────────────────────────────────────── */}
            {step === 'review' && (
              <>
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[12px]">
                  {summaryRow('Engine', sessionEngineLabel(engine))}
                  {isAiEngine(engine) && summaryRow('Model', model ?? 'Default')}
                  {isAiEngine(engine) && effort && summaryRow('Effort', effort)}
                  {intent === 'scratch' ? (
                    summaryRow('Workspace', 'Scratch dir — no repo', true)
                  ) : intent === 'repo' ? (
                    <>
                      {summaryRow('Project', projName.trim(), true)}
                      {summaryRow('Parent', projectParentLabel, true)}
                    </>
                  ) : (
                    <>
                      {location === 'remote' && summaryRow('Host', daemonLabel)}
                      {summaryRow('Workspace', selectedWorkspaceLabel, true)}
                    </>
                  )}
                </div>

                <SpawnOptions
                  value={spawn}
                  onChange={changeSpawn}
                  savedPrompts={savedPrompts}
                  onSaveCustom={(p) => persistPrompts([...savedPrompts, p])}
                  onDeleteCustom={(id) => persistPrompts(savedPrompts.filter((p) => p.id !== id))}
                />

                {scaffoldErr && (
                  <div className="text-[11px] text-destructive">
                    {scaffoldErr}
                    <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                      Check your network/VPN and that the template repo (Settings → Projects →
                      templateRepo) is reachable — a private repo needs your git auth.
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Footer nav — one primary action, always bottom-right */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={back} disabled={stepIndex === 0}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {step === 'review' && intent !== 'repo' && (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Session name (optional)"
                className="max-w-[200px]"
              />
            )}
            {step === 'review' ? (
              intent === 'scratch' ? (
                <Button onClick={() => void startScratch()}>
                  <Zap className="size-4" /> Start scratch session
                </Button>
              ) : intent === 'repo' ? (
                <Button onClick={createProject} disabled={!projName.trim() || scaffoldBusy}>
                  <FolderPlus className="size-4" />
                  {scaffoldBusy ? 'Creating…' : 'Create & open'}
                </Button>
              ) : (
                <Button
                  onClick={() => onChoose(withSpawn(buildChoice()))}
                  disabled={location === 'remote' && !remoteHost}
                >
                  <Plus className="size-4" /> New session
                </Button>
              )
            ) : step === 'roles' ? (
              <Button
                onClick={() => void launchLoop()}
                disabled={!goal.trim() || !loopRepoRoot || loopBusy}
              >
                <Repeat className="size-4" /> {loopBusy ? 'Starting…' : 'Start paired loop'}
              </Button>
            ) : step === 'sessions' ? null : (
              <Button onClick={next} disabled={nextBlocked}>
                Next <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
