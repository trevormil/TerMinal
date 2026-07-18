import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Bell,
  ChevronDown,
  Columns2,
  Grid2x2,
  LayoutDashboard,
  Mail,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { EntryScreen, type Choice, type PairedLoopConfig } from './components/EntryScreen'
import { FleetView } from './components/FleetView'
import { SettingsPanel } from './components/SettingsPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { Onboarding } from './components/Onboarding'
import { Orientation } from './components/Orientation'
import { firstRunPhase } from './lib/orientation'
import { SessionView, type Info } from './SessionView'
import logo from './assets/logo.png'
import { InboxDrawer } from './tabs/hitl'
import { WorkspaceSearchPanel } from './tabs/search'
import { CommandPalette } from './components/CommandPalette'
import { ALL_TABS } from './tabs/registry'
import { useCustomTabs } from './components/CustomTabView'
import { navigateTo, onNavigate } from './lib/nav'
import type { AppearanceCfg, Engine, FleetSession, SessionEngine, TabContext } from './lib/types'
import { applyTheme } from './lib/themes'
import { loadHiddenTabs } from './lib/tabVisibility'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type Sess = { key: string; choice: Choice; info: Info }
type Attention = { reason: 'ready' | 'done' | 'exited'; at: number; exitCode?: number }
export type TerminalLayout = 'single' | 'split' | 'grid4'
export type SessionRail = 'top' | 'left'

const cwdOf = (s: Sess) => s.info.cwd || s.choice.cwd || ''
const repoLabelOf = (cwd: string) => {
  if (cwd.startsWith('ssh://')) {
    const rest = cwd.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
    return (
      remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() ||
      (slash >= 0 ? rest.slice(0, slash) : rest)
    )
  }
  return cwd.replace(/\/$/, '').split('/').pop() || cwd || 'untitled'
}
const loadTerminalLayout = (): TerminalLayout => {
  try {
    const raw = localStorage.getItem('gt.terminalLayout')
    if (raw === 'single' || raw === 'split' || raw === 'grid4') return raw
  } catch {
    /* ignore */
  }
  return 'single'
}
const loadSessionRail = (): SessionRail => {
  try {
    const raw = localStorage.getItem('gt.sessionRail')
    if (raw === 'top' || raw === 'left') return raw
  } catch {
    /* ignore */
  }
  return 'top'
}
// Explicit membership of the multi-view grid, as an ordered list of session
// keys. Unlike the old model this is NOT scoped to one workspace — the grid can
// tile sessions from different repos side by side. Session keys are stable
// across restarts (persisted in gt.openSessions), so this survives reloads;
// stale keys are pruned against the live session list at render time.
const loadTerminalGridKeys = (): string[] => {
  try {
    const raw = localStorage.getItem('gt.terminalGridKeys')
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const loadTerminalSessionOrder = (): Record<string, string[]> => {
  try {
    const raw = localStorage.getItem('gt.terminalSessionOrder')
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Array.isArray(value))
        .map(([root, value]) => [
          root,
          (value as unknown[]).filter((x): x is string => typeof x === 'string'),
        ]),
    )
  } catch {
    return {}
  }
}

// A workspace groups every session that lives under the same repo root. The
// top tab bar shows ONE pill per workspace with the sessions rendered inline
// inside it — so the model maps to the user's mental model ("project →
// terminals") instead of the old session-first flat list.
type Workspace = { repoRoot: string; label: string; remote: boolean; sessions: Sess[] }

// Trim a transcript's first user message into a session-tab-friendly label.
// 24 chars fits comfortably in the in-Terminal session sub-bar. We drop
// leading skill-style triggers ("/something …") so the label reads as the
// task intent, not the command surface.
const labelFromPrompt = (raw: string): string => {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (s.startsWith('/')) {
    const space = s.indexOf(' ')
    if (space > 0) s = s.slice(space + 1).trim()
  }
  if (!s) return ''
  if (s.length <= 24) return s
  return s.slice(0, 23).trimEnd() + '…'
}

const labelForSession = (
  s: Sess,
  indexInWorkspace: number,
  autoNamesByKey: Map<string, string>,
) => {
  if (s.choice.name) return s.choice.name
  const auto = autoNamesByKey.get(s.key)
  if (auto) return auto
  if (s.choice.mode === 'resume' && s.choice.sessionId) return s.choice.sessionId.slice(0, 6)
  // Default is the session's ordinal within the workspace — short and stable
  // (1, 2, 3 within "Repo-A"). Index is computed at render time.
  return `S${indexInWorkspace + 1}`
}

// open sessions persist to localStorage so the window reopens to your workspace
type Saved = {
  key: string
  sessionId: string
  cwd: string
  name: string
  engine?: SessionEngine
  mode?: 'new' | 'resume'
  remote?: Choice['remote']
  loopId?: string
  loopRole?: 'driver' | 'worker'
  openrouterHarness?: 'codex' | 'hermes'
}
const restored: Saved[] = (() => {
  try {
    return JSON.parse(localStorage.getItem('gt.openSessions') || '[]')
  } catch {
    return []
  }
})().filter((s: Saved) => s?.sessionId && s.engine !== 'local')

const defaultAppearance: AppearanceCfg = {
  mode: 'dark',
  theme: 'terminal',
  accent: '',
  uiScale: 1,
  tabLayout: 'horizontal',
}

export default function App() {
  const [sessions, setSessions] = useState<Sess[]>(() =>
    restored.map((s) => {
      const engine = s.engine || 'claude'
      return {
        key: s.key,
        choice: {
          mode: s.mode || 'resume',
          engine,
          sessionId: s.sessionId,
          cwd: s.cwd,
          name: s.name,
          remote: s.remote,
          loopId: s.loopId,
          loopRole: s.loopRole,
          openrouterHarness: s.openrouterHarness,
        },
        info: { sessionId: s.sessionId, cwd: s.cwd },
      }
    }),
  )
  const [activeKey, setActiveKey] = useState<string | null>(
    restored[restored.length - 1]?.key ?? null,
  )
  // adding === 'workspace' → EntryScreen pick a repo (free cwd)
  // adding === { repoRoot, remote? } → EntryScreen inside an existing workspace, cwd locked
  // false → no overlay
  const [adding, setAdding] = useState<
    false | 'workspace' | { repoRoot: string; remote?: Choice['remote'] }
  >(restored.length === 0 ? 'workspace' : false)

  // persist the open sessions (only those with a real session id, i.e. started)
  useEffect(() => {
    const data: Saved[] = sessions
      .map((s) => ({
        key: s.key,
        sessionId: s.info.sessionId || (s.choice.mode === 'resume' ? s.choice.sessionId || '' : ''),
        cwd: s.info.cwd || s.choice.cwd || '',
        name: s.choice.name || '',
        engine: s.choice.engine || 'claude',
        mode: s.choice.mode,
        remote: s.choice.remote,
        loopId: s.choice.loopId,
        loopRole: s.choice.loopRole,
        openrouterHarness: s.choice.openrouterHarness,
      }))
      .filter((s) => s.sessionId && (s.engine !== 'local' || s.remote))
    localStorage.setItem('gt.openSessions', JSON.stringify(data))
  }, [sessions])
  const [fullscreen, setFullscreen] = useState(false)
  const [fleet, setFleet] = useState(false)
  const [inbox, setInbox] = useState(false)
  const [inboxOpenCount, setInboxOpenCount] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [terminalLayout, setTerminalLayout] = useState<TerminalLayout>(loadTerminalLayout)
  const [sessionRail, setSessionRail] = useState<SessionRail>(loadSessionRail)
  const [terminalSessionOrder, setTerminalSessionOrder] =
    useState<Record<string, string[]>>(loadTerminalSessionOrder)
  const [gridKeys, setGridKeys] = useState<string[]>(loadTerminalGridKeys)
  const [gridPickerOpen, setGridPickerOpen] = useState(false)
  const [fleetData, setFleetData] = useState<FleetSession[]>([])
  const [attentionByKey, setAttentionByKey] = useState<Map<string, Attention>>(() => new Map())
  const [attentionOpen, setAttentionOpen] = useState(false)
  const previousFleetStatus = useRef<Record<string, string>>({})
  const [activeCtx, setActiveCtx] = useState<TabContext | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [palette, setPalette] = useState(false)
  // Which mode the EntryScreen (New workspace screen) opens in: a normal single
  // session, or a live-paired loop. Set by the paired-loop:new nav trigger;
  // reset to 'single' whenever the screen closes so the next open defaults right.
  const [entryMode, setEntryMode] = useState<'single' | 'loop'>('single')
  useEffect(() => {
    if (adding === false) setEntryMode('single')
  }, [adding])
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(() => new Set(loadHiddenTabs()))
  const [appearance, setAppearance] = useState<AppearanceCfg>(defaultAppearance)
  const [onboarded, setOnboarded] = useState<boolean | null>(null) // null = loading
  // Orientation shows exactly once, on the setup→onboarded transition in THIS
  // session (never for a returning user). See firstRunPhase in lib/orientation.
  const [completedThisSession, setCompletedThisSession] = useState(false)
  const [orientationDismissed, setOrientationDismissed] = useState(false)

  // first-run gate: show onboarding until the user completes (or skips) it.
  // Also tracks later settings changes so Settings → "Replay onboarding"
  // (which patches onboarded:false) re-enters the flow without a restart.
  useEffect(() => {
    window.gt.settings.get().then((s) => setOnboarded(s.onboarded))
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<{ onboarded?: boolean }>).detail
      if (next && typeof next.onboarded === 'boolean') setOnboarded(next.onboarded)
    }
    window.addEventListener('gt.settings.changed', onChanged)
    return () => window.removeEventListener('gt.settings.changed', onChanged)
  }, [])

  useEffect(() => {
    const openSettings = (ev: Event) => {
      setShowSettings(true)
      const section = (ev as CustomEvent<{ section?: string }>).detail?.section
      if (section)
        setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 50)
    }
    window.addEventListener('gt.settings.open', openSettings)
    return () => window.removeEventListener('gt.settings.open', openSettings)
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      window.gt.settings
        .get()
        .then((s) => {
          if (!alive) return
          applyTheme(s.appearance)
          setAppearance({ ...defaultAppearance, ...s.appearance })
        })
        .catch(() => {})
    load()
    const onSettings = () => load()
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    window.addEventListener('gt.settings.changed', onSettings)
    media?.addEventListener?.('change', onSettings)
    return () => {
      alive = false
      window.removeEventListener('gt.settings.changed', onSettings)
      media?.removeEventListener?.('change', onSettings)
    }
  }, [])

  // macOS hides the traffic lights in fullscreen — drop the 78px reserve for them
  useEffect(() => {
    window.gt.isFullscreen().then(setFullscreen)
    return window.gt.onFullscreen(setFullscreen)
  }, [])

  // poll the fleet snapshot for the overview + live status dots on the tabs
  useEffect(() => {
    if (sessions.length === 0) return
    const tick = () => window.gt.fleet().then(setFleetData)
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [sessions.length])
  useEffect(() => {
    const tick = () =>
      window.gt.hitl
        .list()
        .then((items) => setInboxOpenCount(items.filter((h) => h.status === 'open').length))
        .catch(() => {})
    tick()
    const off = window.gt.activity.onEvent((ev) => {
      if (ev.kind === 'blocked' || ev.kind === 'task-complete') tick()
    })
    const id = setInterval(tick, 5000)
    return () => {
      off()
      clearInterval(id)
    }
  }, [])
  useEffect(() => {
    localStorage.setItem('gt.terminalLayout', terminalLayout)
  }, [terminalLayout])
  useEffect(() => {
    localStorage.setItem('gt.sessionRail', sessionRail)
  }, [sessionRail])
  useEffect(() => {
    localStorage.setItem('gt.terminalSessionOrder', JSON.stringify(terminalSessionOrder))
  }, [terminalSessionOrder])
  useEffect(() => {
    localStorage.setItem('gt.terminalGridKeys', JSON.stringify(gridKeys))
  }, [gridKeys])
  useEffect(() => {
    const onChange = () => setHiddenTabs(new Set(loadHiddenTabs()))
    window.addEventListener('gt.tabs.hidden.changed', onChange)
    return () => window.removeEventListener('gt.tabs.hidden.changed', onChange)
  }, [])
  // ⌘K / Ctrl+K toggles the command palette. Captured at the window so it works
  // regardless of focus (terminal, a tab, etc.).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPalette((p) => !p)
      }
      // ⌘⇧T (Brave-style New Tab) → spin up a fresh base local shell, not an
      // AI engine. Reuses the terminal:new nav path so it inherits the active
      // workspace cwd and single-pane focus behaviour.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        navigateTo('terminal:new', { engine: 'local' })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const statusByKey = Object.fromEntries(fleetData.map((f) => [f.key, f.status]))
  const markAttention = (key: string, attention: Attention) =>
    setAttentionByKey((prev) => {
      const next = new Map(prev)
      next.set(key, attention)
      return next
    })
  const clearAttention = (key: string) =>
    setAttentionByKey((prev) => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })

  useEffect(() => {
    const liveKeys = new Set(sessions.map((s) => s.key))
    setAttentionByKey((prev) => {
      const next = new Map<string, Attention>()
      for (const [key, attention] of prev) if (liveKeys.has(key)) next.set(key, attention)
      return next.size === prev.size ? prev : next
    })
    setGridKeys((prev) => {
      const next = prev.filter((k) => liveKeys.has(k))
      return next.length === prev.length ? prev : next
    })
  }, [sessions])

  useEffect(() => {
    const offExit = window.gt.pty.onExit((key, code) => {
      markAttention(key, { reason: 'exited', at: Date.now(), exitCode: code })
    })
    return offExit
  }, [])

  useEffect(() => {
    const off = window.gt.activity.onEvent((ev) => {
      if (ev.kind !== 'task-complete' || !ev.sessionId) return
      const session = sessions.find(
        (s) => (s.info.sessionId || s.choice.sessionId || '') === ev.sessionId,
      )
      if (session) markAttention(session.key, { reason: 'done', at: Date.now() })
    })
    return off
  }, [sessions])

  useEffect(() => {
    const current = Object.fromEntries(fleetData.map((f) => [f.key, f.status]))
    setAttentionByKey((prev) => {
      let next = prev
      for (const f of fleetData) {
        const before = previousFleetStatus.current[f.key]
        const session = sessions.find((s) => s.key === f.key)
        if (before === 'working' && f.status === 'idle' && session?.choice.engine !== 'local') {
          if (next === prev) next = new Map(prev)
          next.set(f.key, { reason: 'ready', at: Date.now() })
        }
      }
      return next
    })
    previousFleetStatus.current = current
  }, [fleetData, sessions])

  useEffect(() => {
    if (!activeKey || adding !== false || sessions.length === 0) return
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      window.gt
        .tabContext()
        .then((ctx) => {
          if (!cancelled) setActiveCtx(ctx)
        })
        .catch(() => {
          if (!cancelled) setActiveCtx(null)
        })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [activeKey, adding, sessions.length])

  // Fire the IPC immediately AND flip activeKey in the same tick. Main
  // processes IPCs FIFO — so any tabContext / tick / data IPC the newly-active
  // SessionView fires next will see the post-setActiveSession cur(). The old
  // await pattern (await IPC → setActiveKey) made switching feel sluggish
  // because the visibility flip waited for the IPC roundtrip; dropping the
  // await keeps the visual swap snappy without introducing a real race.
  const activate = (key: string) => {
    setActiveKey(key)
    window.gt.setActiveSession(key).catch(() => {
      /* main rejected (e.g. session removed) — UI already flipped, accept */
    })
  }

  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId === 'hitl' || ev.tabId === 'inbox') {
          setInbox(true)
          setFleet(false)
          setSearchOpen(false)
          return
        }
        if (ev.tabId === 'search') {
          const q = ev.payload?.q
          setSearchQuery(typeof q === 'string' ? q : '')
          setSearchOpen(true)
          setFleet(false)
          setInbox(false)
          return
        }
        if (ev.tabId === 'terminal:new') {
          const payload = ev.payload || {}
          const eng = payload.engine
          const engine: SessionEngine =
            eng === 'codex' ||
            eng === 'claude' ||
            eng === 'cursor' ||
            eng === 'local' ||
            eng === 'openrouter' ||
            eng === 'hermes'
              ? eng
              : 'claude'
          const remotePayload = payload.remote as unknown
          const remote =
            remotePayload &&
            typeof remotePayload === 'object' &&
            'sshTarget' in remotePayload &&
            typeof remotePayload.sshTarget === 'string'
              ? (remotePayload as Choice['remote'])
              : undefined
          const cwd =
            remote?.cwd ||
            (typeof payload.cwd === 'string' ? payload.cwd : activeWorkspaceRoot || '')
          const name = typeof payload.name === 'string' ? payload.name : ''
          const initialInput = typeof payload.initialInput === 'string' ? payload.initialInput : ''
          const ticketSlug = typeof payload.ticketSlug === 'string' ? payload.ticketSlug : undefined
          const model = typeof payload.model === 'string' ? payload.model : undefined
          const openrouterHarness =
            payload.openrouterHarness === 'hermes' || payload.openrouterHarness === 'codex'
              ? payload.openrouterHarness
              : undefined
          const key = crypto.randomUUID()
          setSessions((s) => [
            ...s,
            {
              key,
              choice: {
                mode: 'new',
                engine,
                cwd,
                name,
                initialInput,
                ticketSlug,
                remote,
                model,
                openrouterHarness,
              },
              info: { sessionId: '', cwd },
            },
          ])
          activate(key)
          setTerminalLayout('single')
          setFleet(false)
          setInbox(false)
          setSearchOpen(false)
          return
        }
        if (ev.tabId === 'paired-loop:new') {
          const payload = ev.payload || {}
          const repoRoot =
            (typeof payload.repoRoot === 'string' && payload.repoRoot) || activeWorkspaceRoot || ''
          // Open the New workspace screen in loop mode. Lock it to a known repo
          // root when we have one so the loop targets that workspace.
          setEntryMode('loop')
          setAdding(repoRoot ? { repoRoot } : 'workspace')
          setFleet(false)
          setInbox(false)
          setSearchOpen(false)
          setPalette(false)
          return
        }
        if (ev.tabId !== 'terminal') return
        const payload = ev.payload || {}
        const targetKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : ''
        const targetSessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const targetCwd =
          typeof payload.cwd === 'string'
            ? payload.cwd
            : typeof payload.repoRoot === 'string'
              ? payload.repoRoot
              : ''
        const match = sessions.find((s) => {
          if (targetKey && s.key === targetKey) return true
          const sid = s.info.sessionId || s.choice.sessionId || ''
          if (targetSessionId && sid === targetSessionId) return true
          const cwd = s.info.cwd || s.choice.cwd || ''
          if (targetCwd && cwd === targetCwd) return true
          if (targetCwd && cwd.startsWith(`${targetCwd.replace(/\/$/, '')}/`)) return true
          return false
        })
        if (!match) return
        activate(match.key)
        setFleet(false)
        setInbox(false)
        setSearchOpen(false)
      }),
    [sessions],
  )

  const addSession = (choice: Choice) => {
    const key = crypto.randomUUID()
    setSessions((s) => [...s, { key, choice, info: { sessionId: '', cwd: '' } }])
    activate(key)
    setAdding(false)
  }

  // Single-mode loop: create the loop, then open ONE live generator session in
  // the worktree. TerMinal's auto-grader (loop-listener singleTick) spawns a
  // fresh evaluator after each of its turns and delivers the next prompt back in.
  // See .claude/skills/loop-driver (single mode).
  const startSingleLoop = async (
    cfg: PairedLoopConfig,
  ): Promise<{ ok: boolean; error?: string }> => {
    const rec = await window.gt.loops.create({
      repoRoot: cfg.repoRoot,
      goal: cfg.goal,
      mode: 'single',
      engine: cfg.worker.engine,
      model: cfg.worker.model,
    })
    if (!rec || 'error' in rec)
      return { ok: false, error: (rec as { error?: string })?.error || 'Failed to create loop' }
    const stateDir = `${rec.repoRoot}/.TerMinal/loops/${rec.id}`
    const tag = rec.id.slice(-4)
    // The generator wears the planner hat on turn one: draft the contract if
    // empty, then implement. It runs IN the worktree so edits land on the loop
    // branch; the auto-grader takes over after each turn it completes.
    const seed = `/loop-implementer — single loop ${rec.id}. Your worktree is the current directory (branch ${rec.branch}). State dir: ${stateDir}. Goal: ${cfg.goal}. If contract.md has no assertions yet, draft 10-30 testable ones first (you wear the planner hat this once), then do the first generator turn. Update feature_list.json + progress.md, append your JSONL event to events.jsonl, and finish with a final line exactly: LOOP-DONE: generator #1 <summary>. An independent grader reviews each turn — never grade yourself.`
    const key = crypto.randomUUID()
    setSessions((s) => [
      ...s,
      {
        key,
        choice: {
          mode: 'new',
          engine: cfg.worker.engine,
          model: cfg.worker.model,
          cwd: rec.worktree,
          name: `loop·gen ${tag}`,
          initialInput: seed,
          loopId: rec.id,
          loopRole: 'worker',
        },
        info: { sessionId: '', cwd: rec.worktree },
      },
    ])
    setTerminalLayout('single')
    activate(key)
    setFleet(false)
    setInbox(false)
    setSearchOpen(false)
    setAdding(false)
    return { ok: true }
  }

  // Live-paired loop: create the loop (worktree + contract state) then open its
  // two linked sessions — a worker in the worktree, a driver in the main repo —
  // side by side. Both are seeded contract-first. See .claude/skills/loop.
  const startPairedLoop = async (
    cfg: PairedLoopConfig,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (cfg.topology === 'single') return startSingleLoop(cfg)
    const rec = await window.gt.loops.create({
      repoRoot: cfg.repoRoot,
      goal: cfg.goal,
      mode: 'paired',
      engine: cfg.driver.engine,
      model: cfg.driver.model,
    })
    if (!rec || 'error' in rec)
      return { ok: false, error: (rec as { error?: string })?.error || 'Failed to create loop' }
    const stateDir = `${rec.repoRoot}/.TerMinal/loops/${rec.id}`
    const tag = rec.id.slice(-4)
    // Both sessions START in the main repo (so they group into one workspace and
    // persist); the worker is told to do all its file work in the loop worktree.
    // Seeds carry only the runtime params — the behavior lives in the skills.
    const workerSeed = `/loop-implementer — paired loop ${rec.id}. Worktree: ${rec.worktree} (branch ${rec.branch}). State dir: ${stateDir}. Goal: ${cfg.goal}`
    const driverSeed = `/loop-driver — paired loop ${rec.id}. Worktree: ${rec.worktree}. State dir: ${stateDir}. Goal: ${cfg.goal}`
    const workerKey = crypto.randomUUID()
    const driverKey = crypto.randomUUID()
    setSessions((s) => [
      ...s,
      {
        key: driverKey,
        choice: {
          mode: 'new',
          engine: cfg.driver.engine,
          model: cfg.driver.model,
          cwd: rec.repoRoot,
          name: `loop·driver ${tag}`,
          initialInput: driverSeed,
          loopId: rec.id,
          loopRole: 'driver',
        },
        info: { sessionId: '', cwd: rec.repoRoot },
      },
      {
        key: workerKey,
        choice: {
          mode: 'new',
          engine: cfg.worker.engine,
          model: cfg.worker.model,
          cwd: rec.repoRoot,
          name: `loop·worker ${tag}`,
          initialInput: workerSeed,
          loopId: rec.id,
          loopRole: 'worker',
        },
        info: { sessionId: '', cwd: rec.repoRoot },
      },
    ])
    setGridKeys([driverKey, workerKey])
    setTerminalLayout('split')
    activate(driverKey)
    setFleet(false)
    setInbox(false)
    setSearchOpen(false)
    setAdding(false)
    return { ok: true }
  }
  const closeSession = (key: string) => {
    window.gt.stopSession(key)
    setSessions((s) => {
      const next = s.filter((x) => x.key !== key)
      if (activeKey === key) {
        const fallback = next[next.length - 1]?.key ?? null
        if (fallback) activate(fallback)
        else setActiveKey(null)
      }
      if (next.length === 0) setAdding('workspace')
      return next
    })
  }
  const setInfo = (key: string, info: Info) =>
    setSessions((s) => s.map((x) => (x.key === key ? { ...x, info } : x)))
  const renameSession = (key: string, name: string) =>
    setSessions((s) => s.map((x) => (x.key === key ? { ...x, choice: { ...x.choice, name } } : x)))

  // Auto-naming: for any session WITHOUT an explicit user-set name, poll the
  // first user prompt and use a truncated version as the auto-label. Polls
  // every 4s until we have one (transcripts grow during the session). Once
  // landed, we stop polling for that session — the user can either keep the
  // auto-name or override with double-click rename.
  const [autoNamesByKey, setAutoNamesByKey] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    const sessionsToPoll = sessions.filter(
      (s) =>
        !s.choice.name && (s.info.sessionId || s.choice.sessionId) && !autoNamesByKey.has(s.key),
    )
    if (sessionsToPoll.length === 0) return
    let cancelled = false
    const poll = async () => {
      for (const s of sessionsToPoll) {
        const sid = s.info.sessionId || s.choice.sessionId
        if (!sid) continue
        try {
          const first = await window.gt.firstPrompt(sid)
          const label = labelFromPrompt(first || '')
          if (!cancelled && label) {
            setAutoNamesByKey((prev) => {
              if (prev.has(s.key)) return prev
              const next = new Map(prev)
              next.set(s.key, label)
              return next
            })
          }
        } catch {
          /* ignore */
        }
      }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sessions, autoNamesByKey])

  // Clear auto-name for a session when it's removed so the Map doesn't grow
  // forever as sessions cycle through.
  useEffect(() => {
    const liveKeys = new Set(sessions.map((s) => s.key))
    if ([...autoNamesByKey.keys()].some((k) => !liveKeys.has(k))) {
      setAutoNamesByKey((prev) => {
        const next = new Map<string, string>()
        for (const [k, v] of prev) if (liveKeys.has(k)) next.set(k, v)
        return next
      })
    }
  }, [sessions, autoNamesByKey])

  // Group sessions by repo root so the top bar can render workspace pills.
  // We key on cwd verbatim — two sessions at the same path are siblings, two
  // at different paths are different workspaces even if the basenames collide.
  const workspaces: Workspace[] = useMemo(() => {
    const map = new Map<string, Workspace>()
    for (const s of sessions) {
      const root = cwdOf(s) || '(no cwd)'
      if (!map.has(root))
        map.set(root, {
          repoRoot: root,
          label: repoLabelOf(root),
          remote: !!s.choice.remote || root.startsWith('ssh://'),
          sessions: [],
        })
      map.get(root)!.sessions.push(s)
    }
    return [...map.values()].map((ws) => {
      const order = terminalSessionOrder[ws.repoRoot] ?? []
      const rank = new Map(order.map((key, i) => [key, i]))
      return {
        ...ws,
        sessions: ws.sessions
          .map((session, originalIndex) => ({ session, originalIndex }))
          .sort((a, b) => {
            const aRank = rank.get(a.session.key)
            const bRank = rank.get(b.session.key)
            if (aRank !== undefined || bRank !== undefined) {
              return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER)
            }
            return a.originalIndex - b.originalIndex
          })
          .map(({ session }) => session),
      }
    })
  }, [sessions, terminalSessionOrder])
  const activeWorkspaceRoot = useMemo(() => {
    const s = sessions.find((x) => x.key === activeKey)
    return s ? cwdOf(s) : ''
  }, [sessions, activeKey])
  const activeWorkspaceSessions = useMemo(
    () => workspaces.find((w) => w.repoRoot === activeWorkspaceRoot)?.sessions ?? [],
    [workspaces, activeWorkspaceRoot],
  )
  // Active workspace first — the picker and the tile rail list the current
  // project's sessions before any other repo's ("first options = current
  // workspace"), while still exposing every open session for cross-repo tiling.
  const orderedWorkspaces = useMemo(
    () =>
      [...workspaces].sort(
        (a, b) =>
          (b.repoRoot === activeWorkspaceRoot ? 1 : 0) -
          (a.repoRoot === activeWorkspaceRoot ? 1 : 0),
      ),
    [workspaces, activeWorkspaceRoot],
  )
  const visibleSessionOrder = useMemo(() => {
    if (!activeKey) return []
    if (terminalLayout === 'single') return [activeKey]
    // split (2) and grid4 (4) both tile ONE explicit, cross-repo membership list
    // (gridKeys). Stale keys are dropped against the live session list. Before
    // any membership exists we fall back to the current workspace's sessions.
    const limit = terminalLayout === 'split' ? 2 : 4
    const live = new Set(sessions.map((s) => s.key))
    const chosen = gridKeys.filter((k) => live.has(k)).slice(0, limit)
    if (chosen.length > 1) return chosen
    const keys = activeWorkspaceSessions.map((s) => s.key)
    const visible = keys.slice(0, limit)
    if (activeKey && !visible.includes(activeKey) && visible.length > 0) {
      visible[visible.length - 1] = activeKey
    }
    return visible
  }, [activeKey, activeWorkspaceSessions, terminalLayout, gridKeys, sessions])
  const visibleSessionKeys = useMemo(() => new Set(visibleSessionOrder), [visibleSessionOrder])
  const visibleSessionRank = useMemo(
    () => new Map(visibleSessionOrder.map((key, i) => [key, i])),
    [visibleSessionOrder],
  )
  const openInboxTerminals = useMemo(
    () =>
      sessions.map((s) => ({
        key: s.key,
        sessionId: s.info.sessionId || (s.choice.mode === 'resume' ? s.choice.sessionId || '' : ''),
        cwd: cwdOf(s),
      })),
    [sessions],
  )
  const multiTerminal = terminalLayout !== 'single' && visibleSessionKeys.size > 1
  const attentionItems = useMemo(
    () =>
      sessions
        .map((s) => {
          const attention = attentionByKey.get(s.key)
          if (!attention) return null
          const ws = workspaces.find((w) => w.sessions.some((x) => x.key === s.key))
          const index = ws?.sessions.findIndex((x) => x.key === s.key) ?? 0
          return {
            key: s.key,
            label: labelForSession(s, index, autoNamesByKey),
            workspace: repoLabelOf(cwdOf(s)),
            engine: s.choice.engine,
            attention,
          }
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => b.attention.at - a.attention.at),
    [sessions, attentionByKey, workspaces, autoNamesByKey],
  )
  const attentionCount = attentionItems.length

  // Pre-compute peer-session lists ONCE per workspace, then look up by session
  // key in the map. Without this, every App re-render (every fleet tick, every
  // status-by-key change) generates a fresh peerSessions array for each
  // SessionView prop, which makes React see "new" props on every render and
  // bypass any downstream memoization in SessionView.
  const peersByKey = useMemo(() => {
    const m = new Map<
      string,
      {
        key: string
        label: string
        status: string
        mode: 'new' | 'resume'
        engine: SessionEngine
        needsAttention: boolean
        loopRole?: 'driver' | 'worker'
      }[]
    >()
    for (const ws of workspaces) {
      const peers = ws.sessions.map((x, i) => ({
        key: x.key,
        label: labelForSession(x, i, autoNamesByKey),
        status: statusByKey[x.key] || 'idle',
        mode: x.choice.mode,
        engine: x.choice.engine,
        needsAttention: attentionByKey.has(x.key),
        loopRole: x.choice.loopRole,
      }))
      for (const s of ws.sessions) m.set(s.key, peers)
    }
    return m
  }, [workspaces, statusByKey, autoNamesByKey, attentionByKey])

  const closeWorkspace = (root: string) => {
    const ws = workspaces.find((w) => w.repoRoot === root)
    if (!ws) return
    if (ws.sessions.length > 1) {
      if (!confirm(`Close all ${ws.sessions.length} sessions in ${ws.label}?`)) return
    }
    for (const s of ws.sessions) window.gt.stopSession(s.key)
    setSessions((prev) => prev.filter((x) => cwdOf(x) !== root))
    // Push to recents so it shows up on the EntryScreen for one-click reopen.
    try {
      const prev = (
        JSON.parse(localStorage.getItem('gt.recentWorkspaces') || '[]') as string[]
      ).filter((x) => typeof x === 'string' && x !== root)
      localStorage.setItem('gt.recentWorkspaces', JSON.stringify([root, ...prev].slice(0, 8)))
    } catch {
      /* localStorage glitch — best effort */
    }
    if (activeWorkspaceRoot === root) {
      const fallback = sessions.find((x) => cwdOf(x) !== root)?.key ?? null
      if (fallback) activate(fallback)
      else {
        setActiveKey(null)
        setAdding('workspace')
      }
    }
  }

  const reorderSession = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return
    const ws = workspaces.find((w) => w.sessions.some((s) => s.key === fromKey))
    if (!ws || !ws.sessions.some((s) => s.key === toKey)) return
    const keys = ws.sessions.map((s) => s.key)
    const fromIndex = keys.indexOf(fromKey)
    const toIndex = keys.indexOf(toKey)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = keys.splice(fromIndex, 1)
    keys.splice(keys.indexOf(toKey), 0, moved)
    setTerminalSessionOrder((prev) => ({ ...prev, [ws.repoRoot]: keys }))
  }

  const showEntry = adding !== false || sessions.length === 0
  const uiScale = Math.min(1.35, Math.max(0.85, appearance.uiScale || 1))
  const scaledShellStyle: CSSProperties =
    uiScale === 1
      ? {}
      : {
          width: `${100 / uiScale}%`,
          height: `${100 / uiScale}%`,
          transform: `scale(${uiScale})`,
          transformOrigin: 'top left',
        }
  const customTabs = useCustomTabs(activeCtx?.cwd || '')
  const activeTabs = useMemo(
    () =>
      activeCtx
        ? [
            ...ALL_TABS.filter(
              (t) => activeCtx.capabilities?.[t.id] !== false && t.appliesTo(activeCtx),
            ).filter((t) => !hiddenTabs.has(t.id)),
            ...customTabs.filter((t) => !hiddenTabs.has(t.id)),
          ].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        : [],
    [activeCtx, hiddenTabs, customTabs],
  )
  // Multi-view membership (gridKeys) is a single, cross-repo, explicit list that
  // BOTH split (2 tiles) and grid4 (4 tiles) read from. Entering a multi-view
  // with no membership yet seeds it from the CURRENT workspace first, then fills
  // any remaining tiles from other open sessions — so the grid always renders
  // something and the current project leads. From there the picker adds any open
  // session in any workspace. Once curated (≥2) the membership persists across
  // layout switches (grid→split shows the first 2; split→grid restores 4).
  const seedTiles = (cap: number) => {
    const active = activeWorkspaceSessions.map((s) => s.key)
    const others = orderedWorkspaces
      .flatMap((w) => w.sessions.map((s) => s.key))
      .filter((k) => !active.includes(k))
    return [...active, ...others].slice(0, cap)
  }
  const switchLayout = (mode: TerminalLayout) => {
    if (mode !== 'single' && gridKeys.length < 2) {
      const seed = seedTiles(mode === 'split' ? 2 : 4)
      if (seed.length >= 2) setGridKeys(seed)
    } else if (mode === 'split' && gridKeys.length > 2) {
      // split is 2-up — trim any extra tiles carried over from grid4
      setGridKeys(gridKeys.slice(0, 2))
    }
    setTerminalLayout(mode)
  }
  const layoutButton = (
    mode: TerminalLayout,
    title: string,
    Icon: LucideIcon,
    disabled = false,
  ) => (
    <button
      key={mode}
      style={noDrag}
      onClick={() => !disabled && switchLayout(mode)}
      disabled={disabled}
      title={title}
      className={`flex h-6 w-7 items-center justify-center rounded-md transition-colors ${
        terminalLayout === mode
          ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
          : disabled
            ? 'cursor-not-allowed text-zinc-700'
            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
      }`}
    >
      <Icon size={13} strokeWidth={2} />
    </button>
  )
  // Max tiles for the current layout: split is 2-up, grid4 (and single, which
  // jumps to grid4 on the second pick) allow 4.
  const tileCap = terminalLayout === 'split' ? 2 : 4
  // Toggle a session into/out of the cross-repo tile membership. From a single
  // view, adding a second member jumps to grid4 so the effect is visible; if the
  // user is already in split/grid we leave their chosen layout alone.
  const toggleGridKey = (key: string) => {
    const next = gridKeys.includes(key)
      ? gridKeys.filter((k) => k !== key)
      : gridKeys.length >= tileCap
        ? gridKeys
        : [...gridKeys, key]
    setGridKeys(next)
    if (next.length >= 2 && terminalLayout === 'single') setTerminalLayout('grid4')
  }
  // hold the UI until we know onboarding state (avoids the entry screen flashing
  // before first-run setup)
  const phase = firstRunPhase({ onboarded, completedThisSession, orientationDismissed })
  if (phase === 'loading')
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)]">
        <img src={logo} alt="" draggable={false} className="h-12 w-12 animate-pulse rounded-xl" />
      </div>
    )
  if (phase === 'setup')
    return (
      <div className="h-full bg-[var(--gt-bg)]">
        <Onboarding
          onDone={() => {
            setOnboarded(true)
            setCompletedThisSession(true)
            setOrientationDismissed(false)
          }}
        />
      </div>
    )
  if (phase === 'orient')
    return (
      <div className="h-full bg-[var(--gt-bg)]">
        <Orientation onDone={() => setOrientationDismissed(true)} />
      </div>
    )

  return (
    <div className="h-full w-full overflow-hidden bg-[var(--gt-bg)]">
      <div
        className="flex h-full flex-col overflow-hidden bg-[var(--gt-bg)]"
        style={scaledShellStyle}
      >
        {/* session tab bar (top-level, also the window drag region) */}
        <header
          style={drag}
          className={`flex h-9 shrink-0 items-center border-b border-[var(--gt-border)] bg-[var(--gt-bg)] pr-2 ${fullscreen ? 'pl-3' : 'pl-[78px]'}`}
        >
          {/* brand mark — the logo asset is already tightly cropped, so it fills
            the box at scale-1 (no extra zoom) */}
          <div className="mr-2.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[5px]">
            <img
              src={logo}
              alt="TerMinal"
              draggable={false}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {workspaces.map((ws) => {
              const workspaceActive = ws.repoRoot === activeWorkspaceRoot
              // Workspace pill is intentionally minimal: label + count + close.
              // Switching between sessions inside the workspace happens in the
              // Terminal-tab session sub-bar inside SessionView — top bar shows
              // PROJECTS, not pty instances.
              const anyWorking = ws.sessions.some((s) => statusByKey[s.key] === 'working')
              const needsAttention = ws.sessions.some((s) => attentionByKey.has(s.key))
              return (
                <div
                  key={ws.repoRoot}
                  style={noDrag}
                  title={ws.repoRoot}
                  onClick={() => {
                    const target =
                      ws.sessions.find((s) => s.key === activeKey)?.key || ws.sessions[0].key
                    // In a cross-repo multi-view, clicking a workspace whose
                    // session isn't one of the tiles drops to a focused single
                    // view of it — so the pill is never "dead" while the tiles
                    // are locked to their membership.
                    if (terminalLayout !== 'single' && !gridKeys.includes(target))
                      setTerminalLayout('single')
                    activate(target)
                  }}
                  className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${
                    workspaceActive
                      ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/15 text-zinc-100'
                      : needsAttention
                        ? 'border-[var(--gt-yellow)]/60 bg-[var(--gt-yellow)]/10 text-zinc-200'
                        : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span
                    title={
                      anyWorking
                        ? 'A session is working'
                        : needsAttention
                          ? 'Needs attention'
                          : 'Idle'
                    }
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${anyWorking ? 'bg-[var(--gt-green)] gt-pulse' : needsAttention ? 'bg-[var(--gt-yellow)]' : 'bg-[var(--gt-accent-2)]'}`}
                  />
                  {ws.remote && (
                    <Server
                      size={11}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--gt-accent-2)]"
                    />
                  )}
                  <span className="max-w-[180px] truncate font-semibold">{ws.label}</span>
                  {ws.remote && (
                    <span className="rounded bg-[var(--gt-accent)]/15 px-1 text-[9px] uppercase tracking-wide text-[var(--gt-accent-2)]">
                      ssh
                    </span>
                  )}
                  {needsAttention && (
                    <Bell size={10} strokeWidth={2.4} className="text-[var(--gt-yellow)]" />
                  )}
                  {ws.sessions.length > 1 && (
                    <span className="rounded-full bg-black/30 px-1 text-[9.5px] tabular-nums text-zinc-500">
                      {ws.sessions.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeWorkspace(ws.repoRoot)
                    }}
                    title={
                      ws.sessions.length > 1
                        ? `Close ${ws.label} (${ws.sessions.length} sessions)`
                        : `Close ${ws.label}`
                    }
                    className="ml-0.5 flex items-center rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              )
            })}
            <button
              style={noDrag}
              onClick={() => setAdding('workspace')}
              title="New workspace"
              className="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-[var(--gt-border)] px-1.5 py-1 text-[11px] text-zinc-500 hover:border-[var(--gt-accent)]/60 hover:text-zinc-200"
            >
              <Plus size={12} strokeWidth={2.5} />
              workspace
            </button>
          </div>
          {sessions.length > 0 && (
            <button
              style={noDrag}
              onClick={() => {
                setSearchOpen((v) => !v)
                setFleet(false)
                setInbox(false)
                setAttentionOpen(false)
              }}
              disabled={!activeCtx}
              title={activeCtx?.remote ? 'Search remote workspace' : 'Search workspace'}
              className={`ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                searchOpen
                  ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                  : !activeCtx
                    ? 'cursor-not-allowed text-zinc-700'
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              <Search size={13} strokeWidth={2} />
              Search
            </button>
          )}
          {sessions.length > 0 && (
            <div className="relative ml-1 shrink-0" style={noDrag}>
              <button
                onClick={() => setAttentionOpen((v) => !v)}
                title={
                  attentionCount ? 'Terminals needing attention' : 'No terminals need attention'
                }
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                  attentionOpen
                    ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                    : attentionCount
                      ? 'text-[var(--gt-yellow)] hover:bg-[var(--gt-yellow)]/10'
                      : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'
                }`}
              >
                <Bell
                  size={13}
                  strokeWidth={2}
                  className={attentionCount ? 'gt-pulse' : undefined}
                />
                Idle
                {attentionCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-[var(--gt-yellow)]/20 px-1.5 text-[9px] font-bold tabular-nums text-[var(--gt-yellow)]">
                    {attentionCount}
                  </span>
                )}
              </button>
              {attentionOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-[70] w-80 overflow-hidden rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[var(--gt-border)] px-3 py-2">
                    <span className="text-[11px] font-semibold text-zinc-200">
                      Terminals Needing Attention
                    </span>
                    {attentionCount > 0 && (
                      <button
                        onClick={() => setAttentionByKey(new Map())}
                        className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  {attentionItems.length === 0 ? (
                    <div className="px-3 py-5 text-center text-[12px] text-zinc-600">
                      No idle terminals need attention.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {attentionItems.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => {
                            activate(item.key)
                            setAttentionOpen(false)
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gt-yellow)]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-zinc-200">
                              <span className="truncate font-semibold">{item.label}</span>
                              <span className="shrink-0 text-[10px] uppercase text-zinc-600">
                                {item.engine}
                              </span>
                            </div>
                            <div className="truncate text-[10.5px] text-zinc-600">
                              {item.attention.reason === 'exited'
                                ? `exited${typeof item.attention.exitCode === 'number' ? ` ${item.attention.exitCode}` : ''}`
                                : item.attention.reason === 'done'
                                  ? 'done'
                                  : 'idle'}{' '}
                              · {item.workspace}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {sessions.length > 0 && (
            <button
              style={noDrag}
              onClick={() => {
                setFleet((f) => !f)
                setSearchOpen(false)
                setAttentionOpen(false)
              }}
              title="Fleet overview — all sessions at a glance"
              className={`ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                fleet
                  ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              <LayoutDashboard size={13} strokeWidth={2} />
              Fleet
            </button>
          )}
          <button
            style={noDrag}
            onClick={() => {
              setInbox((v) => !v)
              setFleet(false)
              setSearchOpen(false)
              setAttentionOpen(false)
            }}
            title="Inbox — unresolved human-needed items"
            className={`ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
              inbox
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            <Mail size={13} strokeWidth={2} />
            Inbox
            {inboxOpenCount > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--gt-red)]/25 px-1.5 text-[9px] font-bold tabular-nums text-[var(--gt-red)]">
                {inboxOpenCount}
              </span>
            )}
          </button>
          <button
            style={noDrag}
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="ml-1 flex shrink-0 items-center rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <SettingsIcon size={14} strokeWidth={2} />
          </button>
        </header>

        {/* one SessionView per session; all mounted (PTYs persist), selected sessions visible.
          The entry screen overlays (rather than replacing) so existing sessions
          stay mounted and their ptys aren't respawned. */}
        <div className="relative min-h-0 flex-1">
          {multiTerminal && !showEntry && (
            <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center gap-0.5 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-2 text-zinc-300">
              <button
                style={noDrag}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--gt-accent)]/20 px-2.5 py-1 text-[11px] font-medium text-zinc-100"
              >
                <SquareTerminal size={13} strokeWidth={2} />
                Terminal
              </button>
              {activeCtx &&
                activeTabs.map((t) => (
                  <button
                    key={t.id}
                    style={noDrag}
                    onClick={() => {
                      setTerminalLayout('single')
                      requestAnimationFrame(() => navigateTo(t.id))
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                  >
                    <t.icon size={13} strokeWidth={2} />
                    {t.id === 'mrs' ? `${activeCtx.forgeLabel}s` : t.title}
                  </button>
                ))}
            </div>
          )}
          {multiTerminal && !showEntry && (
            <div className="absolute inset-x-0 top-8 z-30 flex h-7 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/70 px-2 text-[11px]">
              <span className="mr-1 text-[9.5px] uppercase tracking-wider text-zinc-600">
                tiles
              </span>
              {/* Tile membership grouped by repo — the tiles can span workspaces,
                so each group is boxed under its repo label (current workspace
                first) and every pill can focus its tile or drop out. */}
              {orderedWorkspaces
                .map((ws) => ({ ws, members: ws.sessions.filter((s) => gridKeys.includes(s.key)) }))
                .filter((g) => g.members.length > 0)
                .map(({ ws, members }) => (
                  <div
                    key={ws.repoRoot}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--gt-border)] bg-black/20 py-0.5 pl-1.5 pr-1"
                  >
                    {ws.remote && (
                      <Server
                        size={10}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--gt-accent-2)]"
                      />
                    )}
                    <span
                      title={ws.repoRoot}
                      className="max-w-[90px] truncate text-[9.5px] font-medium text-zinc-500"
                    >
                      {ws.label}
                    </span>
                    {members.map((s) => {
                      const idx = ws.sessions.findIndex((x) => x.key === s.key)
                      const label = labelForSession(s, idx, autoNamesByKey)
                      const status = statusByKey[s.key] || 'idle'
                      const needsAttention = attentionByKey.has(s.key)
                      const isActive = s.key === activeKey
                      return (
                        <span
                          key={s.key}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                            isActive
                              ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
                              : needsAttention
                                ? 'bg-[var(--gt-yellow)]/10 text-zinc-200'
                                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                          }`}
                        >
                          <button
                            onClick={() => {
                              navigateTo('terminal')
                              activate(s.key)
                            }}
                            className="flex items-center gap-1"
                          >
                            <span
                              title={
                                status === 'working'
                                  ? 'Working'
                                  : needsAttention
                                    ? 'Needs attention'
                                    : 'Idle'
                              }
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'working' ? 'bg-[var(--gt-green)] gt-pulse' : needsAttention ? 'bg-[var(--gt-yellow)]' : 'bg-[var(--gt-accent-2)]'}`}
                            />
                            <span className="max-w-[110px] truncate">{label}</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleGridKey(s.key)
                            }}
                            title="Remove from grid"
                            className="shrink-0 rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
                          >
                            <X size={10} strokeWidth={2.5} />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                ))}
              <button
                onClick={() => {
                  const active = sessions.find((x) => x.key === activeKey)
                  setAdding({ repoRoot: activeWorkspaceRoot || '', remote: active?.choice.remote })
                }}
                title="New session in this workspace"
                className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <Plus size={11} strokeWidth={2.5} />
              </button>
              <div className="flex-1" />
              <div
                style={noDrag}
                className="flex h-7 shrink-0 items-center rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/70 py-0.5 pl-px pr-0.5"
              >
                {layoutButton('single', 'Single terminal', Square)}
                {layoutButton('split', 'Split terminal columns', Columns2, sessions.length < 2)}
                {layoutButton('grid4', 'Four-terminal grid', Grid2x2, sessions.length < 2)}
                <div className="relative">
                  <button
                    style={noDrag}
                    onClick={() => setGridPickerOpen((v) => !v)}
                    disabled={sessions.length < 2}
                    title="Choose sessions to tile in the grid (across repos)"
                    className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                      sessions.length < 2
                        ? 'cursor-not-allowed text-zinc-700'
                        : gridPickerOpen || gridKeys.length > 0
                          ? 'text-zinc-100'
                          : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    <ChevronDown size={13} strokeWidth={2} />
                  </button>
                  {gridPickerOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setGridPickerOpen(false)}
                      />
                      <div className="absolute right-0 top-7 z-50 max-h-80 w-56 overflow-auto rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-1 shadow-xl">
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                          Tiled sessions · {gridKeys.length}/{tileCap}
                        </div>
                        {orderedWorkspaces.map((ws) => (
                          <div key={ws.repoRoot}>
                            <div className="truncate px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-zinc-400">
                              {ws.label}
                            </div>
                            {ws.sessions.map((s, i) => {
                              const checked = gridKeys.includes(s.key)
                              const atCap = !checked && gridKeys.length >= tileCap
                              return (
                                <button
                                  key={s.key}
                                  disabled={atCap}
                                  onClick={() => toggleGridKey(s.key)}
                                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                                    atCap
                                      ? 'cursor-not-allowed text-zinc-600'
                                      : 'text-zinc-200 hover:bg-white/5'
                                  }`}
                                >
                                  <span
                                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                                      checked
                                        ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/30'
                                        : 'border-zinc-600'
                                    }`}
                                  >
                                    {checked && (
                                      <span className="h-1.5 w-1.5 rounded-[1px] bg-[var(--gt-accent)]" />
                                    )}
                                  </span>
                                  <span className="truncate">
                                    {labelForSession(s, i, autoNamesByKey)}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          <div
            className={`absolute inset-0 ${multiTerminal ? 'grid gap-px bg-[var(--gt-border)] pt-[60px]' : ''}`}
            style={
              multiTerminal
                ? {
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gridTemplateRows:
                      terminalLayout === 'grid4' ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                  }
                : undefined
            }
          >
            {sessions.map((s) => {
              const peers = peersByKey.get(s.key)
              const visible = !showEntry && visibleSessionKeys.has(s.key)
              const status = statusByKey[s.key] || 'idle'
              const needsAttention = attentionByKey.has(s.key)
              return (
                <div
                  key={s.key}
                  onPointerDownCapture={() => {
                    if (multiTerminal && s.key !== activeKey) activate(s.key)
                  }}
                  onFocusCapture={() => {
                    if (multiTerminal && s.key !== activeKey) activate(s.key)
                  }}
                  className={
                    visible
                      ? multiTerminal
                        ? `relative min-h-0 min-w-0 overflow-hidden border bg-[var(--gt-bg)] ${
                            status === 'working'
                              ? 'border-[var(--gt-green)]/25'
                              : needsAttention
                                ? 'border-[var(--gt-yellow)]/70'
                                : 'border-[var(--gt-border)]'
                          } ${s.key === activeKey ? 'outline outline-2 -outline-offset-2 outline-[var(--gt-accent)]/90' : ''}`
                        : 'absolute inset-0'
                      : 'absolute inset-0'
                  }
                  style={{
                    visibility: visible ? 'visible' : 'hidden',
                    order: multiTerminal ? visibleSessionRank.get(s.key) : undefined,
                  }}
                >
                  {visible && multiTerminal && (
                    <div className="pointer-events-none absolute left-1 top-1 z-20 flex max-w-[75%] items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-zinc-300 backdrop-blur-sm">
                      {s.choice.remote && (
                        <Server
                          size={9}
                          strokeWidth={2}
                          className="shrink-0 text-[var(--gt-accent-2)]"
                        />
                      )}
                      <span className="truncate">{repoLabelOf(cwdOf(s))}</span>
                    </div>
                  )}
                  <SessionView
                    sessionKey={s.key}
                    choice={s.choice}
                    active={!showEntry && s.key === activeKey}
                    onStarted={(i) => setInfo(s.key, i)}
                    peerSessions={peers}
                    onSwitchSession={activate}
                    onAddSession={() =>
                      setAdding({ repoRoot: cwdOf(s) || '', remote: s.choice.remote })
                    }
                    onCloseSession={closeSession}
                    onRenameSession={renameSession}
                    onReorderSession={reorderSession}
                    terminalTile={multiTerminal}
                    terminalLayout={terminalLayout}
                    tabLayout={appearance.tabLayout}
                    onTerminalLayoutChange={switchLayout}
                    sessionRail={sessionRail}
                    onSessionRailChange={setSessionRail}
                    canSplitTerminal={sessions.length >= 2}
                    canGridTerminal={sessions.length >= 2}
                    focusTerminal={s.key === activeKey}
                    needsAttention={attentionByKey.has(s.key)}
                    onClearAttention={() => clearAttention(s.key)}
                  />
                </div>
              )
            })}
          </div>
          {fleet && !showEntry && (
            <div className="absolute inset-0 z-40 bg-[var(--gt-bg)]">
              <FleetView
                sessions={fleetData}
                activeKey={activeKey}
                onPick={(key) => {
                  activate(key)
                  setFleet(false)
                }}
                onNew={() => {
                  setFleet(false)
                  setAdding('workspace')
                }}
                onClose={() => setFleet(false)}
              />
            </div>
          )}
          {inbox && !showEntry && (
            <div
              className="absolute inset-0 z-50 flex justify-end bg-black/35"
              onClick={() => setInbox(false)}
            >
              <div
                className="relative h-full w-full max-w-[760px] border-l border-[var(--gt-border)] bg-[var(--gt-bg)] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <InboxDrawer
                  ctx={activeCtx}
                  openTerminals={openInboxTerminals}
                  onClose={() => setInbox(false)}
                />
              </div>
            </div>
          )}
          {searchOpen && activeCtx && !showEntry && (
            <div className="absolute inset-0 z-50 bg-black/25" onClick={() => setSearchOpen(false)}>
              <div
                className="absolute inset-x-3 top-3 flex h-[min(660px,calc(100%-24px))] overflow-hidden rounded-lg border border-[var(--gt-border)] bg-[var(--gt-bg)] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <WorkspaceSearchPanel
                  ctx={activeCtx}
                  initialQuery={searchQuery}
                  onClose={() => setSearchOpen(false)}
                />
              </div>
            </div>
          )}
          {showEntry && (
            <div className="absolute inset-0 z-50 bg-[var(--gt-bg)]">
              <EntryScreen
                onChoose={(c) => {
                  // When entering inside an existing workspace, force the cwd
                  // even if the user typed something else (defensive — the UI
                  // hides the cwd input but onChoose can still set it).
                  if (adding && typeof adding === 'object') {
                    addSession({ ...c, cwd: adding.repoRoot, remote: adding.remote || c.remote })
                  } else {
                    addSession(c)
                  }
                }}
                onCancel={sessions.length ? () => setAdding(false) : undefined}
                lockedCwd={adding && typeof adding === 'object' ? adding.repoRoot : undefined}
                lockedRemote={adding && typeof adding === 'object' ? adding.remote : undefined}
                initialMode={entryMode}
                onStartLoop={startPairedLoop}
              />
            </div>
          )}
        </div>
        {/* "installed app is behind main" notice — self-hiding, dismiss persists per upstream sha */}
        <UpdateBanner onOpenSettings={() => setShowSettings(true)} />
        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onRerunSetup={() => {
              setShowSettings(false)
              window.gt.settings.patch({ onboarded: false }).catch(() => {})
              setOnboarded(false)
            }}
          />
        )}
        {palette && !showEntry && (
          <CommandPalette
            tabs={activeTabs}
            sessions={sessions.map((s) => ({
              key: s.key,
              name: s.choice.name || '',
              cwd: s.info.cwd || s.choice.cwd || '',
              engine: s.choice.engine || 'claude',
            }))}
            activeKey={activeKey}
            mrSym={activeCtx?.forgeSym}
            onActivateSession={activate}
            onClose={() => setPalette(false)}
          />
        )}
      </div>
    </div>
  )
}
