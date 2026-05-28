import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { TerminalPane } from './components/Terminal'
import { PluginWidget } from './components/PluginWidget'
import { PluginDrawer } from './components/PluginDrawer'
import { EntryScreen, type Choice } from './components/EntryScreen'
import { ALL_PLUGINS } from './plugins/registry'
import { ALL_TABS } from './tabs/registry'
import { commandWidgetToPlugin } from './lib/commandWidget'
import type { Plugin, TabContext } from './lib/types'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* fall through */
  }
  return fallback
}

export default function App() {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [info, setInfo] = useState<{ sessionId: string; cwd: string }>({ sessionId: '', cwd: '' })
  const [branch, setBranch] = useState('')
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [activeTab, setActiveTab] = useState('terminal')
  const [cmdPlugins, setCmdPlugins] = useState<Plugin[]>([])
  const [enabled, setEnabled] = useState<string[]>(() => load('gt.enabled', []))
  const [known, setKnown] = useState<string[]>(() => load('gt.known', []))
  const [drawer, setDrawer] = useState(false)
  // v2 key resets the stuck-collapsed state from the earlier build
  const [collapsed, setCollapsed] = useState<boolean>(() => load('gt.cockpitCollapsed.v2', false))

  const allPlugins = useMemo(
    () => [...ALL_PLUGINS, ...cmdPlugins].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [cmdPlugins],
  )
  const tabs = useMemo(() => (ctx ? ALL_TABS.filter((t) => t.appliesTo(ctx)) : []), [ctx])

  useEffect(() => localStorage.setItem('gt.enabled', JSON.stringify(enabled)), [enabled])
  useEffect(() => localStorage.setItem('gt.known', JSON.stringify(known)), [known])
  useEffect(
    () => localStorage.setItem('gt.cockpitCollapsed.v2', JSON.stringify(collapsed)),
    [collapsed],
  )

  useEffect(() => {
    const fresh = allPlugins.filter((p) => !known.includes(p.id))
    if (fresh.length === 0) return
    setKnown((k) => [...k, ...fresh.map((p) => p.id)])
    setEnabled((e) => [...e, ...fresh.filter((p) => p.defaultEnabled).map((p) => p.id)])
  }, [allPlugins, known])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false)
      // Cmd/Ctrl+1..N → switch tabs (Terminal is 1)
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const order = ['terminal', ...tabs.map((t) => t.id)]
        const target = order[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          setActiveTab(target)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabs])

  // once attached: branch for header, per-repo command widgets, tab context
  useEffect(() => {
    if (!info.sessionId) return
    window.gt.transcript().then((t) => t.gitBranch && setBranch(t.gitBranch))
    window.gt.listCommandWidgets().then((ws) => setCmdPlugins(ws.map(commandWidgetToPlugin))).catch(() => {})
    window.gt.tabContext().then(setCtx).catch(() => {})
  }, [info.sessionId])

  if (!choice) return <EntryScreen onChoose={setChoice} />

  const toggle = (id: string) =>
    setEnabled((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  const active = allPlugins.filter((p) => enabled.includes(p.id))
  const ActiveTab = tabs.find((t) => t.id === activeTab)
  const onTerminal = activeTab === 'terminal'

  const tabPill = (id: string, icon: string, label: string) => (
    <button
      key={id}
      style={noDrag}
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
        activeTab === id ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {icon} {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <header
        style={drag}
        className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] pl-[78px] pr-2 text-zinc-300"
      >
        <span className="text-[13px] font-bold tracking-tight text-[var(--gt-accent)]">◆</span>
        <div className="flex items-center gap-0.5">
          {tabPill('terminal', '▸', 'Terminal')}
          {tabs.map((t) => tabPill(t.id, t.icon, t.title))}
        </div>
        <div className="flex-1" />
        <span className="truncate text-[11px] text-zinc-500">
          <span
            className={`mr-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
              choice.mode === 'new'
                ? 'bg-[var(--gt-accent)]/20 text-[var(--gt-accent)]'
                : 'bg-[var(--gt-accent-2)]/15 text-[var(--gt-accent-2)]'
            }`}
          >
            {choice.mode}
          </span>
          {tilde(info.cwd || choice.cwd || '~')}
          {branch && <span className="text-zinc-600"> · ⎇ {branch}</span>}
        </span>
        <button
          style={noDrag}
          onClick={() => {
            setInfo({ sessionId: '', cwd: '' })
            setBranch('')
            setCmdPlugins([])
            setCtx(null)
            setActiveTab('terminal')
            setChoice(null)
          }}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          ↩ sessions
        </button>
        {onTerminal && (
          <>
            <button
              style={noDrag}
              onClick={() => setDrawer(true)}
              className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white"
            >
              ⧉ Plugins · {enabled.length}
            </button>
            <button
              style={noDrag}
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expand cockpit' : 'Collapse cockpit'}
              className="rounded-md px-2 py-1 text-[13px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            >
              {collapsed ? '⟨' : '⟩'}
            </button>
          </>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* terminal view stays mounted (hidden when another tab is active) so the PTY survives */}
        <div className={onTerminal ? 'relative flex min-h-0 flex-1' : 'hidden'}>
          <main className="min-w-0 flex-1 bg-[var(--gt-bg)]">
            <TerminalPane choice={choice} onStarted={setInfo} />
          </main>

          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              title="Show cockpit"
              className="flex w-10 shrink-0 cursor-pointer flex-col items-center gap-2 border-l border-[var(--gt-border)] bg-[var(--gt-panel)] pt-3 text-zinc-400 hover:bg-white/5 hover:text-[var(--gt-accent)]"
            >
              <span className="text-base">⧉</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
                Cockpit · {active.length} ⟨
              </span>
            </button>
          ) : (
            <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-[var(--gt-border)] bg-[var(--gt-bg)] p-3">
              <div className="mb-2 flex items-center justify-between px-0.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  Cockpit
                </span>
                <span className="text-[10px] text-zinc-600">{active.length} live</span>
              </div>
              {active.length === 0 ? (
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
                  <div className="mt-2 text-[10.5px] text-zinc-700">
                    or open <span className="text-zinc-500">⧉ Plugins</span>
                  </div>
                </div>
              ) : (
                active.map((p) => (
                  <PluginWidget
                    key={p.id}
                    plugin={p}
                    onHide={(id) => setEnabled((e) => e.filter((x) => x !== id))}
                  />
                ))
              )}
            </aside>
          )}

          {drawer && (
            <PluginDrawer
              plugins={allPlugins}
              enabled={enabled}
              onToggle={toggle}
              onClose={() => setDrawer(false)}
            />
          )}
        </div>

        {/* full-screen tab */}
        {!onTerminal && ActiveTab && ctx && (
          <div className="min-h-0 flex-1">
            <ActiveTab.Component ctx={ctx} />
          </div>
        )}
      </div>
    </div>
  )
}
