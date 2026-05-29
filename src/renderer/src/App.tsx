import { useEffect, useState, type CSSProperties } from 'react'
import { Plus, X, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react'
import { EntryScreen, type Choice } from './components/EntryScreen'
import { FleetView } from './components/FleetView'
import { SettingsPanel } from './components/SettingsPanel'
import { Onboarding } from './components/Onboarding'
import { SessionView, type Info } from './SessionView'
import logo from './assets/logo.png'
import type { FleetSession } from './lib/types'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type Sess = { key: string; choice: Choice; info: Info }

const labelFor = (s: Sess) => {
  const cwd = s.info.cwd || s.choice.cwd || ''
  if (cwd) return cwd.replace(/\/$/, '').split('/').pop() || cwd
  if (s.choice.mode === 'resume' && s.choice.sessionId) return s.choice.sessionId.slice(0, 6)
  return s.choice.name || 'new'
}

// open sessions persist to localStorage so the window reopens to your workspace
type Saved = { key: string; sessionId: string; cwd: string; name: string }
const restored: Saved[] = (() => {
  try {
    return JSON.parse(localStorage.getItem('gt.openSessions') || '[]')
  } catch {
    return []
  }
})().filter((s: Saved) => s?.sessionId)

export default function App() {
  const [sessions, setSessions] = useState<Sess[]>(() =>
    restored.map((s) => ({
      key: s.key,
      choice: { mode: 'resume', sessionId: s.sessionId, cwd: s.cwd, name: s.name },
      info: { sessionId: s.sessionId, cwd: s.cwd },
    })),
  )
  const [activeKey, setActiveKey] = useState<string | null>(restored[restored.length - 1]?.key ?? null)
  const [adding, setAdding] = useState(restored.length === 0)

  // persist the open sessions (only those with a real session id, i.e. started)
  useEffect(() => {
    const data: Saved[] = sessions
      .map((s) => ({
        key: s.key,
        sessionId: s.info.sessionId || (s.choice.mode === 'resume' ? s.choice.sessionId || '' : ''),
        cwd: s.info.cwd || s.choice.cwd || '',
        name: s.choice.name || '',
      }))
      .filter((s) => s.sessionId)
    localStorage.setItem('gt.openSessions', JSON.stringify(data))
  }, [sessions])
  const [fullscreen, setFullscreen] = useState(false)
  const [fleet, setFleet] = useState(false)
  const [fleetData, setFleetData] = useState<FleetSession[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [onboarded, setOnboarded] = useState<boolean | null>(null) // null = loading

  // first-run gate: show onboarding until the user completes (or skips) it
  useEffect(() => {
    window.gt.settings.get().then((s) => setOnboarded(s.onboarded))
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
  const statusByKey = Object.fromEntries(fleetData.map((f) => [f.key, f.status]))

  // select a session: tell main FIRST and await confirmation, THEN flip the
  // active key locally. Awaiting kills a React effect-ordering race — child
  // effects in the newly-active SessionView fire only after main's cur() has
  // been updated, so they never briefly read the previously-active session's
  // repo/branch. (Replaces a redundant useEffect on [activeKey] that double-
  // fired setActiveSession and could race child effects.)
  const activate = async (key: string) => {
    try {
      await window.gt.setActiveSession(key)
    } catch {
      /* main rejected (e.g. session removed) — fall through and flip locally */
    }
    setActiveKey(key)
  }

  const addSession = (choice: Choice) => {
    const key = crypto.randomUUID()
    setSessions((s) => [...s, { key, choice, info: { sessionId: '', cwd: '' } }])
    activate(key)
    setAdding(false)
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
      if (next.length === 0) setAdding(true)
      return next
    })
  }
  const setInfo = (key: string, info: Info) =>
    setSessions((s) => s.map((x) => (x.key === key ? { ...x, info } : x)))

  const showEntry = adding || sessions.length === 0

  // hold the UI until we know onboarding state (avoids the entry screen flashing
  // before first-run setup)
  if (onboarded === null)
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)]">
        <img src={logo} alt="" draggable={false} className="h-12 w-12 animate-pulse rounded-xl" />
      </div>
    )
  if (!onboarded)
    return (
      <div className="h-full bg-[var(--gt-bg)]">
        <Onboarding onDone={() => setOnboarded(true)} />
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      {/* session tab bar (top-level, also the window drag region) */}
      <header
        style={drag}
        className={`flex h-9 shrink-0 items-center border-b border-[var(--gt-border)] bg-[var(--gt-bg)] pr-2 ${
          fullscreen ? 'pl-3' : 'pl-[78px]'
        }`}
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
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => {
            const on = s.key === activeKey
            return (
              <div
                key={s.key}
                style={noDrag}
                onClick={() => activate(s.key)}
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${
                  on
                    ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span
                  title={statusByKey[s.key] === 'working' ? 'working' : 'idle'}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    statusByKey[s.key] === 'working'
                      ? 'bg-[var(--gt-green)] gt-pulse'
                      : s.choice.mode === 'new'
                        ? 'bg-[var(--gt-accent)]'
                        : 'bg-[var(--gt-accent-2)]'
                  }`}
                />
                <span className="max-w-[160px] truncate">{labelFor(s)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeSession(s.key)
                  }}
                  className="ml-0.5 flex items-center rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            )
          })}
          <button
            style={noDrag}
            onClick={() => setAdding(true)}
            title="New session"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>
        {sessions.length > 0 && (
          <button
            style={noDrag}
            onClick={() => setFleet((f) => !f)}
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
          onClick={() => setShowSettings(true)}
          title="Settings"
          className="ml-1 flex shrink-0 items-center rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <SettingsIcon size={14} strokeWidth={2} />
        </button>
      </header>

      {/* one SessionView per session; all mounted (PTYs persist), only active visible.
          The entry screen overlays (rather than replacing) so existing sessions
          stay mounted and their ptys aren't respawned. */}
      <div className="relative min-h-0 flex-1">
        {sessions.map((s) => (
          <div
            key={s.key}
            className="absolute inset-0"
            style={{ visibility: !showEntry && s.key === activeKey ? 'visible' : 'hidden' }}
          >
            <SessionView
              sessionKey={s.key}
              choice={s.choice}
              active={!showEntry && s.key === activeKey}
              onStarted={(i) => setInfo(s.key, i)}
            />
          </div>
        ))}
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
                setAdding(true)
              }}
              onClose={() => setFleet(false)}
            />
          </div>
        )}
        {showEntry && (
          <div className="absolute inset-0 z-50 bg-[var(--gt-bg)]">
            <EntryScreen
              onChoose={addSession}
              onCancel={sessions.length ? () => setAdding(false) : undefined}
            />
          </div>
        )}
      </div>
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onRerunSetup={() => {
            setShowSettings(false)
            setOnboarded(false)
          }}
        />
      )}
    </div>
  )
}
