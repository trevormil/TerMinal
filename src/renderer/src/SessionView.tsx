import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { SquareTerminal, GitBranch, LayoutGrid, ScrollText, X, Plus, type LucideIcon } from 'lucide-react'
import { TerminalPane } from './components/Terminal'
import { PluginWidget } from './components/PluginWidget'
import { PluginDrawer } from './components/PluginDrawer'
import { SnippetsDrawer } from './components/SnippetsDrawer'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { Choice } from './components/EntryScreen'
import { EngineLogo } from './components/EngineLogo'
import { ALL_PLUGINS } from './plugins/registry'
import { ALL_TABS } from './tabs/registry'
import { commandWidgetToPlugin } from './lib/commandWidget'
import type { Engine, Plugin, TabContext } from './lib/types'
import { onNavigate } from './lib/nav'

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
      setState(r.bootstrapped ? 'ok' : 'needed')
    })
    return () => {
      cancelled = true
    }
  }, [active, repoRoot, dismissed])
  if (dismissed || state === 'unknown' || state === 'ok') return null
  const run = async () => {
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
          This repo isn't bootstrapped with project-template — agents/skills/backlog/docs are
          missing.
        </span>
      )}
      <div className="flex items-center gap-1">
        {state === 'needed' && (
          <button
            onClick={run}
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
            setState('ok') // hide
          }}
          title="Don't show this again for this repo"
          className="rounded-md p-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      </div>
    </div>
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
}: {
  sessionKey: string
  choice: Choice
  active: boolean
  onStarted: (info: Info) => void
  /** Every session in THIS workspace, in stable order. Rendered as a thin
   *  sub-bar above the terminal pane so the user can swap pty instances
   *  without leaving the Terminal tab. */
  peerSessions?: { key: string; label: string; status: string; mode: 'new' | 'resume'; engine: Engine }[]
  onSwitchSession?: (key: string) => void
  onAddSession?: () => void
  onCloseSession?: (key: string) => void
  onRenameSession?: (key: string, name: string) => void
}) {
  const [info, setInfo] = useState<Info>({ sessionId: '', cwd: '' })
  // Inline rename in the session sub-bar — null when not editing, otherwise
  // the peer key being edited.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [branch, setBranch] = useState('')
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [activeTab, setActiveTab] = useState('terminal')
  const [cmdPlugins, setCmdPlugins] = useState<Plugin[]>([])
  const [enabled, setEnabled] = useState<string[]>(() => load('gt.enabled', []))
  const [known, setKnown] = useState<string[]>(() => load('gt.known', []))
  const [drawer, setDrawer] = useState(false)
  const [snippets, setSnippets] = useState(false)
  const [tabBadges, setTabBadges] = useState<Record<string, number>>({})

  const allPlugins = useMemo(
    () => [...ALL_PLUGINS, ...cmdPlugins].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [cmdPlugins],
  )
  // Tab visibility: user can hide tabs they don't use via Settings → Tabs.
  // The hidden list lives in localStorage so a fresh window respects it
  // immediately without a settings read. ALL_TABS is the always-known set;
  // appliesTo + the hidden filter winnow it for THIS session.
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(
    () => new Set(load<string[]>('gt.tabs.hidden', [])),
  )
  useEffect(() => {
    const onChange = () => setHiddenTabs(new Set(load<string[]>('gt.tabs.hidden', [])))
    window.addEventListener('gt.tabs.hidden.changed', onChange)
    return () => window.removeEventListener('gt.tabs.hidden.changed', onChange)
  }, [])
  const tabs = useMemo(
    () =>
      ctx
        ? ALL_TABS.filter((t) => t.appliesTo(ctx)).filter((t) => !hiddenTabs.has(t.id))
        : [],
    [ctx, hiddenTabs],
  )

  useEffect(() => localStorage.setItem('gt.enabled', JSON.stringify(enabled)), [enabled])
  useEffect(() => localStorage.setItem('gt.known', JSON.stringify(known)), [known])

  // Cross-tab navigation: any tab can call navigateTo(tabId, payload) to
  // jump the session view to a different tab. Receiving tabs read the payload
  // out of the same event (e.g. Runs tab pre-selects a runId from payload).
  useEffect(() => onNavigate((ev) => setActiveTab(ev.tabId)), [])

  useEffect(() => {
    const fresh = allPlugins.filter((p) => !known.includes(p.id))
    if (fresh.length === 0) return
    setKnown((k) => [...k, ...fresh.map((p) => p.id)])
    setEnabled((e) => [...e, ...fresh.filter((p) => p.defaultEnabled).map((p) => p.id)])
  }, [allPlugins, known])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false)
        setSnippets(false)
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
    const raf = requestAnimationFrame(() => {
      window.gt.transcript().then((t) => t.gitBranch && setBranch(t.gitBranch))
      window.gt
        .listCommandWidgets()
        .then((ws) => setCmdPlugins(ws.map(commandWidgetToPlugin)))
        .catch(() => {})
      window.gt.tabContext().then(setCtx).catch(() => {})
    })
    return () => cancelAnimationFrame(raf)
  }, [info.sessionId, active])

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
  const activeWidgets = allPlugins.filter((p) => enabled.includes(p.id))
  const ActiveTab = tabs.find((t) => t.id === activeTab)
  const showCockpit = choice.engine === 'claude'
  // Direct check rather than `!ActiveTab`. The latter is also true while
  // `tabs` is empty during ctx loading — a transient state that briefly
  // un-hid the terminal pane mid-tab-switch.
  const onTerminal = activeTab === 'terminal'

  const tabPill = (id: string, Icon: LucideIcon, label: string) => {
    const count = tabBadges[id]
    return (
      <button
        key={id}
        style={noDrag}
        onClick={() => setActiveTab(id)}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
          activeTab === id
            ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
        }`}
      >
        <Icon size={13} strokeWidth={2} />
        {label}
        {count ? (
          <span
            className={`ml-0.5 rounded-full px-1.5 text-[9px] font-bold tabular-nums ${
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

  return (
    <div className="flex h-full flex-col">
      <BootstrapBanner repoRoot={info.cwd || choice.cwd || ''} active={active} />
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-2 text-zinc-300">
        <div className="flex items-center gap-0.5">
          {tabPill('terminal', SquareTerminal, 'Terminal')}
          {tabs.map((t) =>
            // the MR/PR tab title tracks the repo's forge (Merge vs Pull requests)
            tabPill(t.id, t.icon, t.id === 'mrs' && ctx ? `${ctx.forgeLabel}s` : t.title),
          )}
        </div>
        <div className="flex-1" />
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
        {onTerminal && (
          <>
            <button
              style={noDrag}
              onClick={() => setSnippets(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
            >
              <ScrollText size={12} strokeWidth={2} />
              Snippets
            </button>
            {showCockpit && (
              <button
                style={noDrag}
                onClick={() => setDrawer(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
              >
                <LayoutGrid size={12} strokeWidth={2} />
                Plugins · {enabled.length}
              </button>
            )}
          </>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {/* Terminal + Claude cockpit. Always laid out (visibility, not display) so xterm
            keeps its size while backgrounded — no refit-from-zero, no flicker. */}
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: showCockpit ? 'minmax(0,1fr) 320px' : 'minmax(0,1fr)',
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
                Top-level bar shows projects; this row shows pty instances.
                Hidden when there's only one session (no choice to make). */}
            {peerSessions.length > 1 || onAddSession ? (
              <div className="flex h-7 shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40 px-2 text-[11px]">
                <span className="mr-1 text-[9.5px] uppercase tracking-wider text-zinc-600">
                  terminal
                </span>
                {peerSessions.map((p) => {
                  const on = p.key === sessionKey
                  const isEditing = editingKey === p.key
                  return (
                    <div
                      key={p.key}
                      onClick={() => !isEditing && p.key !== sessionKey && onSwitchSession?.(p.key)}
                      onDoubleClick={() => {
                        if (!onRenameSession) return
                        setEditingKey(p.key)
                        setEditingValue(p.label)
                      }}
                      title="Double-click to rename"
                      className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 ${
                        on
                          ? 'bg-[var(--gt-accent)]/25 text-zinc-100'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <span
                        title={p.status === 'working' ? 'working' : 'idle'}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          p.status === 'working'
                            ? 'bg-[var(--gt-green)] gt-pulse'
                            : p.mode === 'new'
                              ? 'bg-[var(--gt-accent)]'
                              : 'bg-[var(--gt-accent-2)]'
                        }`}
                      />
                      <EngineLogo engine={p.engine} size={10} className="opacity-80" />
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
                        <span className="max-w-[140px] truncate">{p.label}</span>
                      )}
                      {peerSessions.length > 1 && onCloseSession && !isEditing && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onCloseSession(p.key)
                          }}
                          title="Close this session"
                          className="ml-0.5 flex items-center rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
                        >
                          <X size={10} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                  )
                })}
                {onAddSession && (
                  <button
                    onClick={onAddSession}
                    title="New session in this workspace"
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                  >
                    <Plus size={11} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <TerminalPane sessionKey={sessionKey} choice={choice} onStarted={handleStarted} />
            </div>
          </main>
          {showCockpit && (
          <aside className="min-w-0 overflow-y-auto border-l border-[var(--gt-border)] bg-[var(--gt-bg)] p-3">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                Cockpit
              </span>
              <span className="text-[10px] text-zinc-600">{activeWidgets.length} live</span>
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
                          ...allPlugins.filter((p) => p.defaultEnabled).map((p) => p.id),
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
          <div className="absolute inset-0">
            <ErrorBoundary label={ActiveTab.title}>
              <ActiveTab.Component ctx={ctx} />
            </ErrorBoundary>
          </div>
        )}

        {active && showCockpit && drawer && (
          <PluginDrawer
            plugins={allPlugins}
            enabled={enabled}
            onToggle={toggle}
            onClose={() => setDrawer(false)}
          />
        )}

        {active && snippets && (
          <SnippetsDrawer
            onClose={() => setSnippets(false)}
            onInject={(body) => {
              window.gt.typeIntoActive(body)
              setSnippets(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
