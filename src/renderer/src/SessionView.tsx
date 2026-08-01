import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import {
  Bell,
  Columns2,
  GitBranch,
  Grid2x2,
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
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { TerminalPane } from './components/Terminal'
import { PluginDrawer } from './components/PluginDrawer'
import { WorkColumn } from './components/WorkColumn'
import { useRepoTrustPrompt } from './components/RepoTrustReview'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { Choice } from './components/EntryScreen'
import { EngineLogo } from './components/EngineLogo'
import { useResizableWidth, ResizeHandle } from './components/ResizeHandle'
import { COCKPIT_PLUGINS } from './plugins/registry'
import { ALL_TABS } from './tabs/registry'
import { useCustomTabs } from './components/CustomTabView'
import { commandWidgetsToPlugins } from './lib/commandWidget'
import { applyVisibleOrder, mergeWidgetOrder } from './lib/widgetOrder'
import { createTickCoalescer } from './lib/tickCoalescer'
import type { AppearanceTabLayout, Plugin, SessionEngine, TabContext } from './lib/types'
import { navigateTo, onNavigate } from './lib/nav'
import { loadHiddenTabs } from './lib/tabVisibility'
import { readCollapsed, writeCollapsed } from './lib/panelCollapse'
import {
  COLUMN_COLLAPSED_KEY,
  COLUMN_COLLAPSED_WHEN_UNSET,
  COLUMN_WIDTH,
  COLUMN_WIDTH_KEY,
} from './lib/columnLayout'
import { pluginVisibleForEngine, reconcileFreshPlugins } from './lib/pluginVisibility'
import { trustDotVisible } from './lib/repoTrust'
import { RepoOrientation } from './components/RepoOrientation'
import {
  repoOrientationKey,
  repoOrientationPendingKey,
  shouldAutoShowRepoOrientation,
} from './lib/orientation'
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
  const [templateSha, setTemplateSha] = useState('')
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
      setTemplateSha(r.templateSha || '')
      setState('done')
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-3 py-1.5 text-[11px] text-zinc-200">
        <span className="text-[14px]">🛠</span>
        {state === 'done' ? (
          <span className="flex-1">
            Bootstrapped{templateSha ? ` (template ${templateSha.slice(0, 7)})` : ''} — reload tabs
            to pick up .agents/ + skills.
          </span>
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5"
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
 * survives backgrounding), work column, and view-tabs. Only the `active`
 * session renders its column/tab content (so backgrounded sessions don't poll).
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
  /** Split/grid layouts are terminal-focused; hide workspace chrome and the work column. */
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
  const [tabMenu, setTabMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [branch, setBranch] = useState('')
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [activeTab, setActiveTab] = useState('terminal')
  const [cmdPlugins, setCmdPlugins] = useState<Plugin[]>([])
  const [enabled, setEnabled] = useState<string[]>(() => load('gt.enabled', []))
  const [known, setKnown] = useState<string[]>(() => load('gt.known', []))
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => load('gt.widgetOrder', []))
  const [drawer, setDrawer] = useState(false)
  // A repo whose widgets are waiting on approval shows a dot on the work-column
  // toggle, and a second one on the Cockpit section's Plugins action once the
  // column is open — the toggle so a collapse can never bury it, the action so
  // the trail leads to the drawer that fixes it. Indicator only: approving still
  // means opening the drawer and reading the literal commands. There is no
  // approve-from-the-badge. Polled, because nothing pushes when the active
  // session's cwd changes.
  const trustPrompt = useRepoTrustPrompt(5000)
  // One column, one collapse. The keys it reads are the cockpit's, which the
  // Files column's were folded into on first launch (see lib/columnLayout).
  const [columnCollapsed, setColumnCollapsed] = useState(() =>
    readCollapsed(COLUMN_COLLAPSED_KEY, COLUMN_COLLAPSED_WHEN_UNSET),
  )
  const [tabBadges, setTabBadges] = useState<Record<string, number>>({})
  const sessionRailW = useResizableWidth('gt.sessionRailWidth', 160, {
    min: 120,
    max: 360,
    edge: 'right',
  })
  // edge: 'left' — the column sits on the RIGHT of the terminal, so dragging
  // left grows it.
  const columnW = useResizableWidth(COLUMN_WIDTH_KEY, COLUMN_WIDTH.default, {
    min: COLUMN_WIDTH.min,
    max: COLUMN_WIDTH.max,
    edge: 'left',
  })
  const isRemote = !!choice.remote

  const allPlugins = useMemo(
    // COCKPIT_PLUGINS, not ALL_PLUGINS: Tickets and PRs/MRs have their own
    // accordion sections now, and a plugin mounted in both places would poll
    // twice.
    () => [...COCKPIT_PLUGINS, ...cmdPlugins].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [cmdPlugins],
  )
  const availablePlugins = useMemo(
    () => allPlugins.filter((p) => !isRemote && pluginVisibleForEngine(p, choice.engine)),
    [allPlugins, choice.engine, isRemote],
  )
  // User-defined widget order wins over plugin `order:`; widgets absent from
  // the saved order slot in at their default position (see mergeWidgetOrder).
  const orderedPlugins = useMemo(() => {
    const byId = new Map(availablePlugins.map((p) => [p.id, p]))
    return mergeWidgetOrder(widgetOrder, availablePlugins).map((id) => byId.get(id)!)
  }, [availablePlugins, widgetOrder])
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
  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [tabMenu])
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
  const badgeTabs = useMemo(() => tabs.filter((t) => t.badge), [tabs])
  const badgeTabKey = badgeTabs.map((t) => t.id).join('\0')

  useEffect(() => localStorage.setItem('gt.enabled', JSON.stringify(enabled)), [enabled])
  useEffect(() => localStorage.setItem('gt.known', JSON.stringify(known)), [known])
  useEffect(
    () => localStorage.setItem('gt.widgetOrder', JSON.stringify(widgetOrder)),
    [widgetOrder],
  )
  useEffect(() => writeCollapsed(COLUMN_COLLAPSED_KEY, columnCollapsed), [columnCollapsed])

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
    const next = reconcileFreshPlugins(availablePlugins, known, enabled)
    if (!next) return
    setKnown(next.known)
    setEnabled(next.enabled)
  }, [availablePlugins, known, enabled])

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
            if (alive) setCmdPlugins((prev) => commandWidgetsToPlugins(ws, prev))
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

  // Per-repo orientation: auto-shows once when a fresh repo (no agents, no
  // backlog) or a just-scaffolded project (pending marker from EntryScreen)
  // is opened; closing persists a per-repo dismissal. The ⌘K palette re-opens
  // it on demand for any repo via gt.repoOrientation.show.
  const [repoOrient, setRepoOrient] = useState(false)
  useEffect(() => {
    if (!active || terminalTile || !ctx) return
    const dismissed = (key: string) => {
      try {
        return localStorage.getItem(key) === '1'
      } catch {
        return false
      }
    }
    // Scaffolded projects arrive with .agents/ + backlog already seeded, so
    // the fresh-repo heuristic alone would never fire — the one-shot pending
    // marker overrides it. Consumed on show so it can't re-trigger later.
    const pendingKey = repoOrientationPendingKey(ctx.repoRoot)
    const justCreated = dismissed(pendingKey)
    if (
      shouldAutoShowRepoOrientation({ ...ctx, remote: isRemote || ctx.remote }, dismissed, {
        justCreated,
      })
    ) {
      if (justCreated) {
        try {
          localStorage.removeItem(pendingKey)
        } catch {
          /* ignore */
        }
      }
      setRepoOrient(true)
    }
  }, [active, terminalTile, ctx, isRemote])
  useEffect(() => {
    if (!active) return
    const show = () => setRepoOrient(true)
    window.addEventListener('gt.repoOrientation.show', show)
    return () => window.removeEventListener('gt.repoOrientation.show', show)
  }, [active])
  const closeRepoOrient = () => {
    if (ctx?.repoRoot) {
      try {
        localStorage.setItem(repoOrientationKey(ctx.repoRoot), '1')
      } catch {
        /* ignore */
      }
    }
    setRepoOrient(false)
  }

  // Poll tab badges (e.g. HITL count) for any tab that declares one — refresh
  // on the transcript tick and a slow interval. Initial run also deferred by
  // one frame to spread the post-switch IPC burst.
  useEffect(() => {
    if (!active || !ctx) return
    if (badgeTabs.length === 0) return
    let alive = true
    const run = async () => {
      const entries = await Promise.all(
        badgeTabs.map(async (t) => [t.id, await t.badge!(window.gt).catch(() => 0)] as const),
      )
      if (alive) setTabBadges((b) => ({ ...b, ...Object.fromEntries(entries) }))
    }
    const raf = requestAnimationFrame(run)
    const coalescedTick = createTickCoalescer(run)
    const off = window.gt.onTick(coalescedTick.trigger)
    const id = setInterval(run, 8000)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      coalescedTick.cancel()
      off()
      clearInterval(id)
    }
  }, [active, ctx?.sessionId, ctx?.repoRoot, badgeTabKey])

  const toggle = (id: string) =>
    setEnabled((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  // Splice a reordered visible sequence into the full saved order — the view
  // is a filtered subset, so persisting only the visible ids would drop
  // engine-gated plugins' placement. Both the chevrons and drawer drag-and-drop
  // commit through this single path.
  const reorderWidgets = (ids: string[]) => setWidgetOrder((prev) => applyVisibleOrder(prev, ids))
  // Chevron fallback: swap with the neighbor in the displayed list.
  const moveWidget = (id: string, dir: -1 | 1) => {
    const ids = orderedPlugins.map((p) => p.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorderWidgets(ids)
  }
  const activeWidgets = orderedPlugins.filter((p) => enabled.includes(p.id))
  const ActiveTab = tabs.find((t) => t.id === activeTab)
  // A split/grid tile has no room for the column, and a remote session's files
  // and widgets aren't on this machine.
  const showColumn = !terminalTile && !isRemote
  const columnVisible = showColumn && !columnCollapsed
  // Direct check rather than `!ActiveTab`. The latter is also true while
  // `tabs` is empty during ctx loading — a transient state that briefly
  // un-hid the terminal pane mid-tab-switch.
  const onTerminal = terminalTile || activeTab === 'terminal'
  // Note `showColumn`, not `columnVisible`: a collapsed column must not hide a
  // pending approval.
  const trustDot = trustDotVisible({
    pending: trustPrompt.pending,
    showColumn,
    onTerminal,
    columnCollapsed,
  })
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
        onContextMenu={(e) => {
          if (isEditing || !onCloseSession) return
          e.preventDefault()
          setTabMenu({ key: p.key, x: e.clientX, y: e.clientY })
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
          title={p.status === 'working' ? 'Working' : p.needsAttention ? 'Needs attention' : 'Idle'}
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
      {repoOrient && ctx && active && !terminalTile && (
        <RepoOrientation ctx={ctx} onClose={closeRepoOrient} />
      )}
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
        {onTerminal && showColumn && (
          <button
            style={noDrag}
            onClick={() => setColumnCollapsed((v) => !v)}
            title={
              trustDot
                ? 'This repo’s widgets need your approval before they can run — open the work column, then Plugins on Cockpit'
                : columnCollapsed
                  ? 'Show work column'
                  : 'Hide work column'
            }
            className={`relative inline-flex h-6 w-7 items-center justify-center rounded-md border bg-[var(--gt-panel)] transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white ${
              trustDot
                ? 'border-[var(--gt-red)]/60 text-zinc-200'
                : 'border-[var(--gt-border)] text-zinc-400'
            }`}
          >
            {columnCollapsed ? (
              <PanelRightOpen size={13} strokeWidth={2} />
            ) : (
              <PanelRightClose size={13} strokeWidth={2} />
            )}
            {/* Deliberately a dot, not a count: "needs attention". It rides the
                toggle rather than only the Cockpit section's Plugins action
                because the toggle is persistent chrome — a collapsed section,
                or a collapsed column, must not be able to hide a pending
                approval. See trustDotVisible. */}
            {trustDot && (
              <span
                aria-label="Repo widgets need approval"
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--gt-panel)] bg-[var(--gt-red)]"
              />
            )}
          </button>
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
          {/* Terminal + work column. Always laid out (visibility, not display) so
            xterm keeps its size while backgrounded — no refit-from-zero, no
            flicker. */}
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: ['minmax(0,1fr)', columnVisible ? `${columnW.width}px` : null]
                .filter(Boolean)
                .join(' '),
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
            {columnVisible && (
              <ResizeHandle
                onMouseDown={columnW.onResizeStart}
                style={{ right: columnW.width }}
                className="absolute inset-y-0 -translate-x-1/2"
              />
            )}
            {/* The one work column: Files · Tickets · PRs/MRs · Cockpit. It isn't
                gated on `active` — the Files section lists once on mount and
                never polls, so a backgrounded session costs one IPC — but every
                polling section inside it is. */}
            {columnVisible && (
              <WorkColumn
                ctx={ctx}
                active={active}
                known={known}
                enabled={enabled}
                widgets={activeWidgets}
                onHideWidget={(id) => setEnabled((e) => e.filter((x) => x !== id))}
                onEnableDefaults={() =>
                  setEnabled((e) =>
                    Array.from(
                      new Set([
                        ...e,
                        ...availablePlugins.filter((p) => p.defaultEnabled).map((p) => p.id),
                      ]),
                    ),
                  )
                }
                onOpenPlugins={() => setDrawer(true)}
                trustPending={trustPrompt.pending}
              />
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

          {active && showColumn && drawer && (
            <PluginDrawer
              plugins={orderedPlugins}
              enabled={enabled}
              onToggle={toggle}
              onMove={moveWidget}
              onReorder={reorderWidgets}
              onClose={() => setDrawer(false)}
              trustPrompt={trustPrompt}
            />
          )}
        </div>
      </div>
      {tabMenu && onCloseSession && (
        <div
          className="fixed z-[70] min-w-40 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] py-1 text-[12px] text-zinc-200 shadow-2xl"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            disabled={peerSessions.length < 2}
            onClick={() => {
              for (const s of peerSessions) if (s.key !== tabMenu.key) onCloseSession(s.key)
              setTabMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <X size={13} strokeWidth={2} />
            Close Other Tabs
          </button>
          <button
            onClick={() => {
              for (const s of peerSessions) onCloseSession(s.key)
              setTabMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <XCircle size={13} strokeWidth={2} />
            Close All Tabs
          </button>
        </div>
      )}
    </div>
  )
}
