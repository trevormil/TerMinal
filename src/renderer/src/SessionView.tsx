import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { SquareTerminal, GitBranch, LayoutGrid, ScrollText, type LucideIcon } from 'lucide-react'
import { TerminalPane } from './components/Terminal'
import { PluginWidget } from './components/PluginWidget'
import { PluginDrawer } from './components/PluginDrawer'
import { SnippetsDrawer } from './components/SnippetsDrawer'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { Choice } from './components/EntryScreen'
import { ALL_PLUGINS } from './plugins/registry'
import { ALL_TABS } from './tabs/registry'
import { commandWidgetToPlugin } from './lib/commandWidget'
import type { Plugin, TabContext } from './lib/types'

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

/**
 * One Claude session: its terminal (always mounted so the PTY/scrollback
 * survives backgrounding), cockpit, and view-tabs. Only the `active` session
 * renders its cockpit/tab content (so backgrounded sessions don't poll).
 */
export function SessionView({
  sessionKey,
  choice,
  active,
  onStarted,
}: {
  sessionKey: string
  choice: Choice
  active: boolean
  onStarted: (info: Info) => void
}) {
  const [info, setInfo] = useState<Info>({ sessionId: '', cwd: '' })
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
  const tabs = useMemo(() => (ctx ? ALL_TABS.filter((t) => t.appliesTo(ctx)) : []), [ctx])

  useEffect(() => localStorage.setItem('gt.enabled', JSON.stringify(enabled)), [enabled])
  useEffect(() => localStorage.setItem('gt.known', JSON.stringify(known)), [known])

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
  const onTerminal = !ActiveTab

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
            <button
              style={noDrag}
              onClick={() => setDrawer(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-white"
            >
              <LayoutGrid size={12} strokeWidth={2} />
              Plugins · {enabled.length}
            </button>
          </>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {/* Terminal + cockpit. Always laid out (visibility, not display) so xterm
            keeps its size while backgrounded — no refit-from-zero, no flicker. */}
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: 'minmax(0,1fr) 320px',
            visibility: onTerminal ? 'visible' : 'hidden',
          }}
        >
          <main className="min-w-0 overflow-hidden bg-[var(--gt-bg)]">
            <TerminalPane sessionKey={sessionKey} choice={choice} onStarted={handleStarted} />
          </main>
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
        </div>

        {/* full-screen view tab */}
        {active && !onTerminal && ActiveTab && ctx && (
          <div className="absolute inset-0">
            <ErrorBoundary label={ActiveTab.title}>
              <ActiveTab.Component ctx={ctx} />
            </ErrorBoundary>
          </div>
        )}

        {active && drawer && (
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
