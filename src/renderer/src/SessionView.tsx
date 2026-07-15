import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import {
  Bell,
  Columns2,
  GitBranch,
  Grid2x2,
  LayoutGrid,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  Plus,
  Repeat,
  Server,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { TerminalPane } from './components/Terminal'
import { PluginWidget } from './components/PluginWidget'
import { PluginDrawer } from './components/PluginDrawer'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { Choice } from './components/EntryScreen'
import { EngineLogo } from './components/EngineLogo'
import { useResizableWidth, ResizeHandle } from './components/ResizeHandle'
import { ALL_PLUGINS } from './plugins/registry'
import { ALL_TABS } from './tabs/registry'
import { useCustomTabs } from './components/CustomTabView'
import { commandWidgetToPlugin } from './lib/commandWidget'
import type { AppearanceTabLayout, Engine, Plugin, SessionEngine, TabContext } from './lib/types'
import { navigateTo, onNavigate } from './lib/nav'
import { loadHiddenTabs } from './lib/tabVisibility'
import type { SessionRail, TerminalLayout } from './App'

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* fall through */
  }
  return fallback
}

function isEditableNonTerminalTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  if (!el) return false
  const editable = el.closest('input, textarea, select, [contenteditable="true"]')
  if (!editable) return false
  return !el.closest('.xterm')
}

export type Info = { sessionId: string; cwd: string }

// Banner shown at the top of a session when the repo lacks .agents/ — gives
// a one-click way to run project-template/bootstrap.sh against it. Dismissed
// state is per-repo + persisted; the banner doesn't come back for a repo the
// user explicitly dismissed.
function BootstrapBanner({ repoRoot, active }: { repoRoot: string; active: boolean }) {
  const [state, setState] = useState<'unknown' | 'needed' | 'ok' | 'running' | 'done' | 'error'>(
    'unknown',
  )
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const dismissedKey = `gt.bootstrapDismissed.${repoRoot}`
  const dismissed = (() => {
    try {
      return localStorage.getItem(dismissedKey) === '1'
    } catch {
      return false
    }
  })()
  useEffect(() => {
    if (!active || !repoRoot || dismissed) return
    let cancelled = false
    window.gt.workspace.isBootstrapped(repoRoot).then((r) => {
      if (cancelled) return
      setMessage(r.message || '')
      setState(r.bootstrapped ? 'ok' : 'needed')
    })
    return () => {
      cancelled = true
    }
  }, [active, repoRoot, dismissed])
  if (dismissed || state === 'unknown' || state === 'ok') return null
  const run = async () => {
    setConfirmOpen(false)
    setState('running')
    const r = await window.gt.workspace.bootstrap(repoRoot)
    if ('error' in r) {
      setError(r.error)
      setState('error')
    } else {
      setState('done')
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-3 py-1.5 text-[11px] text-zinc-200">
        <span className="text-[14px]">🛠</span>
        {state === 'done' ? (
          <span className="flex-1">Bootstrapped — reload tabs to pick up .agents/ + skills.</span>
        ) : state === 'running' ? (
          <span className="flex-1">Running bootstrap.sh…</span>
        ) : state === 'error' ? (
          <span className="flex-1 text-[var(--gt-red)]">Bootstrap failed: {error}</span>
        ) : (
          <span className="flex-1">
            {message ||
              "This repo isn't bootstrapped with project-template — agents, skills, .TerMinal state, or docs are missing."}
          </span>
        )}
        <div className="flex items-center gap-1">
          {state === 'needed' && (
            <button
              onClick={() => setConfirmOpen(true)}
              className="rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 px-2 py-0.5 text-[11px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/30"
            >
              Bootstrap
            </button>
          )}
          <button
            onClick={() => {
              try {
                localStorage.setItem(dismissedKey, '1')
              } catch {
                /* ignore */
              }
              setConfirmOpen(false)
              setState('ok') // hide
            }}
            title="Don't show this again for this repo"
            className="rounded-md p-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-5"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-[520px] max-w-full rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[13px] font-semibold text-zinc-100">Bootstrap this repo?</div>
            <p className="mb-3 text-[12px] leading-5 text-zinc-400">
              This runs project-template/bootstrap.sh against this repo. It seeds TerMinal workflow
              files for agents, skills, hooks, inbox notifications, tickets, sessions, reviews,
              checks, docs, CI, snippets, widgets, PR/MR templates, and gitignore entries.
            </p>
            <div className="mb-3 rounded-md border border-[var(--gt-border)] bg-black/25 p-2 text-[11px] leading-5 text-zinc-500">
              Existing project data and docs are left in place. Workflow-owned files may be updated;
              conflicting existing files are written as{' '}
              <span className="font-mono">*.workflow</span> sidecars for manual merge.
            </div>
            <div className="mb-4 truncate rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px] text-zinc-500">
              {repoRoot}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-[var(--gt-border)] bg-black/20 px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={run}
                className="rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 px-3 py-1.5 text-[12px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/30"
              >
                Confirm Bootstrap
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * One agent session: its terminal (always mounted so the PTY/scrollback
 * survives backgrounding), cockpit, and view-tabs. Only the `active` session
 * renders its cockpit/tab content (so backgrounded sessions don't poll).
 */
export function SessionView({
  sessionKey,
  choice,
  active,
  onStarted,
  peerSessions = [
    { key: sessionKey, label: 'S1', status: 'idle', mode: choice.mode, engine: choice.engine },
  ],
  onSwitchSession,
  onAddSession,
  onCloseSession,
  onRenameSession,
  onReorderSession,
  terminalTile = false,
  terminalLayout = 'single',
  tabLayout = 'horizontal',
  onTerminalLayoutChange,
  sessionRail = 'top',
  onSessionRailChange,
  canSplitTerminal = false,
  canGridTerminal = false,
  focusTerminal = false,
  needsAttention = false,
  onClearAttention,
}: {
  sessionKey: string
  choice: Choice
  active: boolean
  onStarted: (info: Info) => void
  /** Split/grid layouts are terminal-focused; hide workspace chrome and cockpit. */
  terminalTile?: boolean
  /** Every session in THIS workspace, in stable order. Rendered as a thin
   *  sub-bar above the terminal pane so the user can swap pty instances
   *  without leaving the Terminal tab. */
  peerSessions?: {
    key: string
    label: string
    status: string
    mode: 'new' | 'resume'
    engine: SessionEngine
    needsAttention?: boolean
    loopRole?: 'driver' | 'worker'
  }[]
  onSwitchSession?: (key: string) => void
  onAddSession?: () => void
  onCloseSession?: (key: string) => void
  onRenameSession?: (key: string, name: string) => void
  onReorderSession?: (fromKey: string, toKey: string) => void
  terminalLayout?: TerminalLayout
  tabLayout?: AppearanceTabLayout
  onTerminalLayoutChange?: (layout: TerminalLayout) => void
  /** Position of the peer-session sub-bar: a horizontal row on top, or a
   *  vertical rail on the left of the terminal pane. */
  sessionRail?: SessionRail
  onSessionRailChange?: (rail: SessionRail) => void
  /** Both split (2 tiles) and grid (4 tiles) tile sessions across repos, so each
   *  is enabled whenever ≥2 sessions exist app-wide. */
  canSplitTerminal?: boolean
  canGridTerminal?: boolean
  focusTerminal?: boolean
  needsAttention?: boolean
  onClearAttention?: () => void
}) {
  const [info, setInfo] = useState<Info>({ sessionId: '', cwd: '' })
  // Inline rename in the session sub-bar — null when not editing, otherwise
  // the peer key being edited.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [activeTab, setActiveTab] = useState('terminal')
  const [cmdPlugins, setCmdPlugins] = useState<Plugin[]>([])
  const [enabled, setEnabled] = useState<string[]>(() => load('gt.enabled', []))
  const [known, setKnown] = useState<string[]>(() => load('gt.known', []))
  const [drawer, setDrawer] = useState(false)
  const [cockpitCollapsed, setCockpitCollapsed] = useState(() => {
    try {
      return localStorage.getItem('gt.cockpitCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [tabBadges, setTabBadges] = useState<Record<string, number>>({})
  const sessionRailW = useResizableWidth('gt.sessionRailWidth', 160, {
    min: 120,
    max: 360,
    edge: 'right',
  })
  const cockpitW = useResizableWidth('gt.cockpitWidth', 320, { min: 240, max: 640, edge: 'left' })
  const isRemote = !!choice.remote

  const allPlugins = useMemo(
    () => [...ALL_PLUGINS, ...cmdPlugins].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [cmdPlugins],
  )
  const availablePlugins = useMemo(
    () =>
      allPlugins.filter(
        (p) =>
          !isRemote &&
          choice.engine !== 'local' &&
          (!p.engines || p.engines.includes(choice.engine as Engine)),
      ),
    [allPlugins, choice.engine, isRemote],
  )
  // Tab visibility: user can hide tabs they don't use via Settings → Tabs.
  // The hidden list lives in localStorage so a fresh window respects it
  // immediately without a settings read. ALL_TABS is the always-known set;
  // appliesTo + the hidden filter winnow it for THIS session.
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(() => new Set(loadHiddenTabs()))
  useEffect(() => {
    const onChange = () => setHiddenTabs(new Set(loadHiddenTabs()))
    window.addEventListener('gt.tabs.hidden.changed', onChange)
    return () => window.removeEventListener('gt.tabs.hidden.changed', onChange)
  }, [])
  const customTabs = useCustomTabs(ctx?.cwd || '')
  const tabs = useMemo(
    () =>
      ctx
        ? [
            ...ALL_TABS.filter(
              (t) => ctx.capabilities?.[t.id] !== false && t.appliesTo(ctx),
            ).filter((t) => !hiddenTabs.has(t.id)),
            ...customTabs.filter((t) => !hiddenTabs.has(t.id)),
          ].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        : [],
    [ctx, hiddenTabs, customTabs],
  )

  useEffect(() => localStorage.setItem('gt.enabled', JSON.stringify(enabled)), [enabled])
  useEffect(() => localStorage.setItem('gt.known', JSON.stringify(known)), [known])
  useEffect(() => {
    try {
      localStorage.setItem('gt.cockpitCollapsed', cockpitCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [cockpitCollapsed])

  // Cross-tab navigation: any tab can call navigateTo(tabId, payload) to
  // jump the session view to a different tab. Receiving tabs read the payload
  // out of the same event (e.g. Runs tab pre-selects a runId from payload).
  useEffect(() => {
    if (terminalTile) setActiveTab('terminal')
  }, [terminalTile])

  useEffect(
    () =>
      onNavigate((ev) => {
        if (terminalTile && ev.tabId !== 'terminal') return
        setActiveTab(ev.tabId)
      }),
    [terminalTile, isRemote],
  )

  useEffect(() => {
    if (!active || terminalTile) return
    const onKey = (e: KeyboardEvent) => {
      // ⌘[ / ⌘] cycle tabs, browser/editor style, even while the terminal is
      // focused. ⌘ only — ctrl+[ is ESC in the terminal, so we never bind ctrl.
      if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        if (isEditableNonTerminalTarget(e.target)) return
        const cycle = ['terminal', ...tabs.map((t) => t.id)]
        if (cycle.length === 0) return
        e.preventDefault()
        setActiveTab((cur) => {
          const i = Math.max(0, cycle.indexOf(cur))
          return cycle[(i + (e.key === ']' ? 1 : -1) + cycle.length) % cycle.length]
        })
        return
      }
      if (!e.altKey || e.metaKey || e.ctrlKey || isEditableNonTerminalTarget(e.target)) return
      const ids = ['terminal', ...tabs.map((t) => t.id)]
      if (ids.length === 0) return

      const digit = e.code.match(/^Digit([1-9])$/)?.[1]
      if (!e.shiftKey && digit) {
        const id = ids[Number(digit) - 1]
        if (!id) return
        e.preventDefault()
        setActiveTab(id)
        return
      }

      const prev = e.key === 'ArrowLeft'
      const next = e.key === 'ArrowRight'
      if (!prev && !next) return

      e.preventDefault()
      setActiveTab((cur) => {
        const i = Math.max(0, ids.indexOf(cur))
        return ids[(i + (next ? 1 : -1) + ids.length) % ids.length]
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, terminalTile, tabs])

  useEffect(() => {
    const fresh = availablePlugins.filter((p) => !known.includes(p.id))
    if (fresh.length === 0) return
    setKnown((k) => Array.from(new Set([...k, ...fresh.map((p) => p.id)])))
    setEnabled((e) =>
      Array.from(new Set([...e, ...fresh.filter((p) => p.defaultEnabled).map((p) => p.id)])),
    )
  }, [availablePlugins, known])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleStarted = (i: Info) => {
    setInfo(i)
    onStarted(i)
  }

  // once this session is attached AND active: load branch + widgets + tab context.
  // (data IPC reads the active session in main, so only fetch when active.)
  // Deferred by one frame so the session-switch paint wins the race against
  // the IPC burst — otherwise the click can feel like it didn't register.
  useEffect(() => {
    if (!info.sessionId || !active) return
    let alive = true
    const raf = requestAnimationFrame(() => {
      if (!isRemote) {
        window.gt.transcript().then((t) => {
          if (alive && t.gitBranch) setBranch(t.gitBranch)
        })
        window.gt
          .listCommandWidgets()
          .then((ws) => {
            if (alive) setCmdPlugins(ws.map(commandWidgetToPlugin))
          })
          .catch(() => {})
      }
      window.gt
        .tabContext()
        .then((next) => alive && setCtx(next))
        .catch(() => {})
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [info.sessionId, active, isRemote])

  useEffect(() => {
    if (!active) return
    const reload = () => {
      window.gt
        .tabContext()
        .then(setCtx)
        .catch(() => {})
    }
    window.addEventListener('gt.ticket-provider.changed', reload)
    return () => window.removeEventListener('gt.ticket-provider.changed', reload)
  }, [active])

  // Poll tab badges (e.g. HITL count) for any tab that declares one — refresh
  // on the transcript tick and a slow interval. Initial run also deferred by
  // one frame to spread the post-switch IPC burst.
  useEffect(() => {
    if (!active || !ctx) return
    const withBadge = tabs.filter((t) => t.badge)
    if (withBadge.length === 0) return
    let alive = true
    const run = async () => {
      const entries = await Promise.all(
        withBadge.map(async (t) => [t.id, await t.badge!(window.gt).catch(() => 0)] as const),
      )
      if (alive) setTabBadges((b) => ({ ...b, ...Object.fromEntries(entries) }))
    }
    const raf = requestAnimationFrame(run)
    const off = window.gt.onTick(run)
    const id = setInterval(run, 8000)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      off()
      clearInterval(id)
    }
  }, [active, ctx, tabs])

  const toggle = (id: string) =>
    setEnabled((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  const activeWidgets = availablePlugins.filter((p) => enabled.includes(p.id))
  const ActiveTab = tabs.find((t) => t.id === activeTab)
  const showCockpit = !terminalTile && !isRemote && choice.engine !== 'local'
  const cockpitVisible = showCockpit && !cockpitCollapsed
  // Direct check rather than `!ActiveTab`. The latter is also true while
  // `tabs` is empty during ctx loading — a transient state that briefly
  // un-hid the terminal pane mid-tab-switch.
  const onTerminal = terminalTile || activeTab === 'terminal'
  const sidebarTabs = !terminalTile && tabLayout === 'sidebar'

  const tabPill = (
    id: string,
    Icon: LucideIcon,
    label: string,
    variant: 'top' | 'side' = 'top',
  ) => {
    const count = tabBadges[id]
    const on = activeTab === id
    return (
      <button
        key={id}
        style={noDrag}
        onClick={() => setActiveTab(id)}
        className={`${
          variant === 'side'
            ? 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px]'
            : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px]'
        } font-medium transition-colors ${
          on
            ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
        }`}
      >
        <Icon size={13} strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? (
          <span
            className={`ml-auto rounded-full px-1.5 text-[9px] font-bold tabular-nums ${
              id === 'hitl'
                ? 'bg-[var(--gt-red)]/25 text-[var(--gt-red)]'
                : 'bg-[var(--gt-yellow)]/20 text-[var(--gt-yellow)]'
            }`}
          >
            {count}
          </span>
        ) : null}
      </button>
    )
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
      onClick={() => !disabled && onTerminalLayoutChange?.(mode)}
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
  const handleSessionDrop = (e: DragEvent, toKey: string) => {
    e.preventDefault()
    const fromKey = e.dataTransfer.getData('application/x-terminal-session') || draggingKey
    if (fromKey && fromKey !== toKey) onReorderSession?.(fromKey, toKey)
    setDraggingKey(null)
  }
  const tabLabel = (id: string, title: string) =>
    id === 'mrs' && ctx ? `${ctx.forgeLabel}s` : title
  const activeTabTitle =
    activeTab === 'terminal'
      ? 'Terminal'
      : ActiveTab
        ? tabLabel(ActiveTab.id, ActiveTab.title)
        : 'Terminal'
  const renderPrimaryTabs = (variant: 'top' | 'side') => (
    <>
      {tabPill('terminal', SquareTerminal, 'Terminal', variant)}
      {tabs.map((t) => tabPill(t.id, t.icon, tabLabel(t.id, t.title), variant))}
    </>
  )
  const railButton = (mode: SessionRail, title: string, Icon: LucideIcon) => (
    <button
      key={mode}
      style={noDrag}
      onClick={() => onSessionRailChange?.(mode)}
      title={title}
      className={`flex h-6 w-7 items-center justify-center rounded-md transition-colors ${
        sessionRail === mode
          ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
          : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
      }`}
    >
      <Icon size={13} strokeWidth={2} />
    </button>
  )
  // One peer-session pill, shared by the top row and the left rail. `side`
  // stretches it full-width and pushes the close affordance to the end.
  const renderSessionPill = (p: (typeof peerSessions)[number], variant: 'top' | 'side' = 'top') => {
    const on = p.key === sessionKey
    const isEditing = editingKey === p.key
    return (
      <div
        key={p.key}
        draggable={!isEditing && !!onReorderSession}
        onDragStart={(e) => {
          if (isEditing) return
          setDraggingKey(p.key)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-terminal-session', p.key)
        }}
        onDragOver={(e) => {
          if (draggingKey && draggingKey !== p.key) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(e) => handleSessionDrop(e, p.key)}
        onDragEnd={() => setDraggingKey(null)}
        onClick={() => {
          if (isEditing) return
          navigateTo('terminal')
          setActiveTab('terminal')
          if (p.key !== sessionKey) onSwitchSession?.(p.key)
        }}
        onDoubleClick={() => {
          if (!onRenameSession) return
          setEditingKey(p.key)
          setEditingValue(p.label)
        }}
        title="Double-click to rename"
        className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 ${
          variant === 'side' ? 'w-full ' : ''
        }${
          on
            ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
            : p.needsAttention
              ? 'bg-[var(--gt-yellow)]/10 text-zinc-200 ring-1 ring-inset ring-[var(--gt-yellow)]/35'
              : draggingKey === p.key
                ? 'text-zinc-500 opacity-60'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
        }`}
      >
        <span
          title={p.status === 'working' ? 'working' : p.needsAttention ? 'needs attention' : 'idle'}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            p.status === 'working'
              ? 'bg-[var(--gt-green)] gt-pulse'
              : p.needsAttention
                ? 'bg-[var(--gt-yellow)]'
                : p.mode === 'new'
                  ? 'bg-[var(--gt-accent)]'
                  : 'bg-[var(--gt-accent-2)]'
          }`}
        />
        <EngineLogo engine={p.engine} size={10} className="opacity-80" />
        {p.loopRole && (
          <span
            title={`Linked loop — ${p.loopRole}`}
            className="flex shrink-0 items-center gap-0.5 rounded bg-[var(--gt-accent)]/15 px-1 text-[9px] uppercase tracking-wide text-[var(--gt-accent)]"
          >
            <Repeat size={8} strokeWidth={2.5} />
            {p.loopRole}
          </span>
        )}
        {p.needsAttention && (
          <Bell size={10} strokeWidth={2.4} className="text-[var(--gt-yellow)]" />
        )}
        {isEditing ? (
          <input
            autoFocus
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={() => {
              onRenameSession?.(p.key, editingValue.trim())
              setEditingKey(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRenameSession?.(p.key, editingValue.trim())
                setEditingKey(null)
              } else if (e.key === 'Escape') {
                setEditingKey(null)
              }
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
            className="w-24 rounded-sm border border-[var(--gt-accent)]/60 bg-black/40 px-1 py-px text-[11px] text-zinc-100 outline-none"
          />
        ) : (
          <span className={`${variant === 'side' ? 'flex-1 ' : 'max-w-[140px] '}truncate`}>
            {p.label}
          </span>
        )}
        {peerSessions.length > 1 && onCloseSession && !isEditing && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onCloseSession(p.key)
            }}
            title="Close this session"
            className={`${variant === 'side' ? 'ml-auto ' : 'ml-0.5 '}flex items-center rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200`}
          >
            <X size={10} strokeWidth={2.5} />
          </span>
        )}
      </div>
    )
  }
  const renderAddSessionButton = (variant: 'top' | 'side' = 'top') =>
    onAddSession ? (
      <button
        onClick={onAddSession}
        title="New session in this workspace"
        className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 ${
          variant === 'side' ? 'w-full justify-start' : ''
        }`}
      >
        <Plus size={11} strokeWidth={2.5} />
        {variant === 'side' && <span className="text-[11px]">New session</span>}
      </button>
    ) : null
  // single / split / grid selector, plus the top-vs-left rail toggle. Shared by
  // the top sub-bar and the left-rail control strip.
  const layoutControls =
    onTerminal && onTerminalLayoutChange ? (
      <div
        style={noDrag}
        className="flex h-7 shrink-0 items-center rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/70 py-0.5 pl-px pr-0.5"
      >
        {layoutButton('single', 'Single terminal', Square)}
        {layoutButton('split', 'Split terminal columns', Columns2, !canSplitTerminal)}
        {layoutButton('grid4', 'Four-terminal grid', Grid2x2, !canGridTerminal)}
        {onSessionRailChange && (
          <>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--gt-border)]" />
            {railButton('top', 'Session tabs on top', PanelTop)}
            {railButton('left', 'Session tabs on left', PanelLeft)}
          </>
        )}
      </div>
    ) : null
  // The peer-session sub-bar shows whenever there's a session choice or the
  // layout controls are available. `railLeft` moves those pills into a vertical
  // rail beside the terminal instead of a row above it.
  const showSessionBar =
    !terminalTile && (peerSessions.length > 1 || !!onAddSession || !!onTerminalLayoutChange)
  const railLeft = showSessionBar && sessionRail === 'left'

  return (
    <div className="flex h-full flex-col">
      <div className={terminalTile ? 'hidden' : undefined}>
        <BootstrapBanner repoRoot={info.cwd || choice.cwd || ''} active={active && !isRemote} />
      </div>
      <header
        className={`h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-2 text-zinc-300 ${
          terminalTile ? 'hidden' : 'flex'
        }`}
      >
        <div
          className={
            sidebarTabs ? 'flex min-w-0 items-center gap-1.5' : 'flex items-center gap-0.5'
          }
        >
          {sidebarTabs ? (
            <>
              <SquareTerminal
                size={13}
                strokeWidth={2}
                className="shrink-0 text-[var(--gt-accent-light)]"
              />
              <span className="truncate text-[11.5px] font-semibold text-zinc-300">
                {activeTabTitle}
              </span>
            </>
          ) : (
            renderPrimaryTabs('top')
          )}
        </div>
        <div className="flex-1" />
        {isRemote && (
          <span
            title={choice.remote?.sshTarget}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-1.5 py-px text-[10px] font-medium text-[var(--gt-accent-light)]"
          >
            <Server size={10} strokeWidth={2} />
            {choice.remote?.label || choice.remote?.sshTarget || 'remote'}
          </span>
        )}
        {branch && (
          <span className="inline-flex items-center gap-1 truncate text-[11px] text-zinc-600">
            <GitBranch size={11} strokeWidth={2} />
            {branch}
          </span>
        )}
        {/* Worktree indicator. Sessions inside .worktrees/ or cron-worktrees/
            are operating on a throwaway checkout — surface that so it's
            obvious the user isn't on their main repo path. */}
        {(() => {
          const cwd = info.cwd || choice.cwd || ''
          if (!cwd) return null
          const wt = /\/\.worktrees\/|\/cron-worktrees\//.test(cwd)
          if (!wt) return null
          return (
            <span
              title={cwd}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 px-1.5 py-px text-[10px] font-medium text-[var(--gt-yellow)]"
            >
              🌿 worktree
            </span>
          )
        })()}
        {onTerminal && showCockpit && (
          <div className="flex items-center gap-1" style={noDrag}>
            <button
              onClick={() => setCockpitCollapsed((v) => !v)}
              title={cockpitCollapsed ? 'Show cockpit' : 'Hide cockpit'}
              className="inline-flex h-6 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] text-zinc-400 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
            >
              {cockpitCollapsed ? (
                <PanelRightOpen size={13} strokeWidth={2} />
              ) : (
                <PanelRightClose size={13} strokeWidth={2} />
              )}
            </button>
            <button
              onClick={() => setDrawer(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
            >
              <LayoutGrid size={12} strokeWidth={2} />
              Plugins · {activeWidgets.length}
            </button>
          </div>
        )}
      </header>

      <div className={sidebarTabs ? 'flex min-h-0 flex-1' : 'relative min-h-0 flex-1'}>
        {sidebarTabs && (
          <aside className="w-40 shrink-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/35 p-2">
            <div className="mb-1.5 px-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-zinc-600">
              Tabs
            </div>
            <nav className="space-y-0.5">{renderPrimaryTabs('side')}</nav>
          </aside>
        )}
        <div className={sidebarTabs ? 'relative min-h-0 flex-1' : 'contents'}>
          {/* Terminal + cockpit. Always laid out (visibility, not display) so xterm
            keeps its size while backgrounded — no refit-from-zero, no flicker. */}
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: cockpitVisible
                ? `minmax(0,1fr) ${cockpitW.width}px`
                : 'minmax(0,1fr)',
              // Hide ONLY when on a non-terminal tab. Don't force 'visible' —
              // that would override the App-level wrapper's `visibility: hidden`
              // for inactive sessions, leaking the inactive session's terminal
              // pane onto whichever tab the ACTIVE session is showing (the
              // "weird navigation glitch" — see screenshot).
              visibility: onTerminal ? undefined : 'hidden',
            }}
          >
            <main className="flex min-w-0 flex-col overflow-hidden bg-[var(--gt-bg)]">
              {/* Session sub-bar — peer terminal instances inside this workspace.
                Top-level bar shows projects; this shows pty instances, either as
                a row on top (default) or a rail on the left (sessionRail). The
                terminal pane keeps a stable tree position across the toggle so
                xterm never unmounts. */}
              {sessionRail === 'top' && (
                <div
                  className={`h-7 shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 px-2 text-[11px] ${
                    showSessionBar ? 'flex' : 'hidden'
                  }`}
                >
                  {showSessionBar ? (
                    <>
                      <span className="mr-1 text-[9.5px] uppercase tracking-wider text-zinc-600">
                        terminal
                      </span>
                      {peerSessions.map((p) => renderSessionPill(p, 'top'))}
                      {renderAddSessionButton('top')}
                      <div className="flex-1" />
                      {layoutControls}
                    </>
                  ) : null}
                </div>
              )}
              {railLeft && (
                <div className="flex h-7 shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 px-2 text-[11px]">
                  <span className="mr-1 text-[9.5px] uppercase tracking-wider text-zinc-600">
                    terminal
                  </span>
                  <div className="flex-1" />
                  {layoutControls}
                </div>
              )}
              <div className="flex min-h-0 flex-1">
                {railLeft && (
                  <>
                    <aside
                      className="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-1.5"
                      style={{ width: sessionRailW.width }}
                    >
                      {peerSessions.map((p) => renderSessionPill(p, 'side'))}
                      {renderAddSessionButton('side')}
                    </aside>
                    <ResizeHandle onMouseDown={sessionRailW.onResizeStart} />
                  </>
                )}
                <div className="min-h-0 min-w-0 flex-1">
                  <TerminalPane
                    sessionKey={sessionKey}
                    choice={choice}
                    onStarted={handleStarted}
                    active={focusTerminal}
                    needsAttention={needsAttention}
                    onClearAttention={onClearAttention}
                  />
                </div>
              </div>
            </main>
            {cockpitVisible && (
              <ResizeHandle
                onMouseDown={cockpitW.onResizeStart}
                style={{ right: cockpitW.width }}
                className="absolute inset-y-0 -translate-x-1/2"
              />
            )}
            {cockpitVisible && (
              <aside className="min-w-0 overflow-y-auto border-l border-[var(--gt-border)] bg-[var(--gt-bg)] p-3">
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                    Cockpit
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-600">{activeWidgets.length} live</span>
                    <button
                      onClick={() => setCockpitCollapsed(true)}
                      title="Hide cockpit"
                      className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
                    >
                      <PanelRightClose size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                {/* render widgets only when active so backgrounded sessions don't poll */}
                {!active ? null : activeWidgets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--gt-border)] p-4 text-center text-[12px] text-zinc-600">
                    No plugins enabled.
                    <button
                      onClick={() =>
                        setEnabled((e) =>
                          Array.from(
                            new Set([
                              ...e,
                              ...availablePlugins.filter((p) => p.defaultEnabled).map((p) => p.id),
                            ]),
                          ),
                        )
                      }
                      className="mx-auto mt-2 block rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-1 text-[11px] font-medium text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white"
                    >
                      Enable defaults
                    </button>
                  </div>
                ) : (
                  activeWidgets.map((p) => (
                    <PluginWidget
                      key={p.id}
                      plugin={p}
                      onHide={(id) => setEnabled((e) => e.filter((x) => x !== id))}
                    />
                  ))
                )}
              </aside>
            )}
          </div>

          {/* full-screen view tab */}
          {active && !onTerminal && ActiveTab && ctx && (
            <div className="absolute inset-0 z-10">
              <ErrorBoundary label={ActiveTab.title}>
                <ActiveTab.Component ctx={ctx} />
              </ErrorBoundary>
            </div>
          )}

          {active && showCockpit && drawer && (
            <PluginDrawer
              plugins={availablePlugins}
              enabled={enabled}
              onToggle={toggle}
              onClose={() => setDrawer(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
