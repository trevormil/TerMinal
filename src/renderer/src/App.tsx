import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Plus, X, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react'
import { EntryScreen, type Choice } from './components/EntryScreen'
import { FleetView } from './components/FleetView'
import { SettingsPanel } from './components/SettingsPanel'
import { Onboarding } from './components/Onboarding'
import { SessionView, type Info } from './SessionView'
import logo from './assets/logo.png'
import type { Engine, FleetSession } from './lib/types'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type Sess = { key: string; choice: Choice; info: Info }

const cwdOf = (s: Sess) => s.info.cwd || s.choice.cwd || ''
const repoLabelOf = (cwd: string) => cwd.replace(/\/$/, '').split('/').pop() || cwd || 'untitled'

// A workspace groups every session that lives under the same repo root. The
// top tab bar shows ONE pill per workspace with the sessions rendered inline
// inside it — so the model maps to the user's mental model ("project →
// terminals") instead of the old session-first flat list.
type Workspace = { repoRoot: string; label: string; sessions: Sess[] }

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
  engine?: 'claude' | 'codex'
  mode?: 'new' | 'resume'
}
const restored: Saved[] = (() => {
  try {
    return JSON.parse(localStorage.getItem('gt.openSessions') || '[]')
  } catch {
    return []
  }
})().filter((s: Saved) => s?.sessionId)

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
        },
        info: { sessionId: s.sessionId, cwd: s.cwd },
      }
    }),
  )
  const [activeKey, setActiveKey] = useState<string | null>(restored[restored.length - 1]?.key ?? null)
  // adding === 'workspace' → EntryScreen pick a repo (free cwd)
  // adding === { repoRoot } → EntryScreen inside an existing workspace, cwd locked
  // false → no overlay
  const [adding, setAdding] = useState<false | 'workspace' | { repoRoot: string }>(
    restored.length === 0 ? 'workspace' : false,
  )

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
      if (next.length === 0) setAdding('workspace')
      return next
    })
  }
  const setInfo = (key: string, info: Info) =>
    setSessions((s) => s.map((x) => (x.key === key ? { ...x, info } : x)))
  const renameSession = (key: string, name: string) =>
    setSessions((s) =>
      s.map((x) => (x.key === key ? { ...x, choice: { ...x.choice, name } } : x)),
    )

  // Auto-naming: for any session WITHOUT an explicit user-set name, poll the
  // first user prompt and use a truncated version as the auto-label. Polls
  // every 4s until we have one (transcripts grow during the session). Once
  // landed, we stop polling for that session — the user can either keep the
  // auto-name or override with double-click rename.
  const [autoNamesByKey, setAutoNamesByKey] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    const sessionsToPoll = sessions.filter(
      (s) => !s.choice.name && (s.info.sessionId || s.choice.sessionId) && !autoNamesByKey.has(s.key),
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
      if (!map.has(root)) map.set(root, { repoRoot: root, label: repoLabelOf(root), sessions: [] })
      map.get(root)!.sessions.push(s)
    }
    return [...map.values()]
  }, [sessions])
  const activeWorkspaceRoot = useMemo(() => {
    const s = sessions.find((x) => x.key === activeKey)
    return s ? cwdOf(s) : ''
  }, [sessions, activeKey])

  // Pre-compute peer-session lists ONCE per workspace, then look up by session
  // key in the map. Without this, every App re-render (every fleet tick, every
  // status-by-key change) generates a fresh peerSessions array for each
  // SessionView prop, which makes React see "new" props on every render and
  // bypass any downstream memoization in SessionView.
  const peersByKey = useMemo(() => {
    const m = new Map<
      string,
      { key: string; label: string; status: string; mode: 'new' | 'resume'; engine: Engine }[]
    >()
    for (const ws of workspaces) {
      const peers = ws.sessions.map((x, i) => ({
        key: x.key,
        label: labelForSession(x, i, autoNamesByKey),
        status: statusByKey[x.key] || 'idle',
        mode: x.choice.mode,
        engine: x.choice.engine,
      }))
      for (const s of ws.sessions) m.set(s.key, peers)
    }
    return m
  }, [workspaces, statusByKey, autoNamesByKey])

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
      const prev = (JSON.parse(localStorage.getItem('gt.recentWorkspaces') || '[]') as string[])
        .filter((x) => typeof x === 'string' && x !== root)
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

  const showEntry = adding !== false || sessions.length === 0

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
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {workspaces.map((ws) => {
            const workspaceActive = ws.repoRoot === activeWorkspaceRoot
            // Workspace pill is intentionally minimal: label + count + close.
            // Switching between sessions inside the workspace happens in the
            // Terminal-tab session sub-bar inside SessionView — top bar shows
            // PROJECTS, not pty instances.
            const anyWorking = ws.sessions.some((s) => statusByKey[s.key] === 'working')
            return (
              <div
                key={ws.repoRoot}
                style={noDrag}
                title={ws.repoRoot}
                onClick={() =>
                  activate(
                    ws.sessions.find((s) => s.key === activeKey)?.key || ws.sessions[0].key,
                  )
                }
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${
                  workspaceActive
                    ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span
                  title={anyWorking ? 'a session is working' : 'idle'}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    anyWorking ? 'bg-[var(--gt-green)] gt-pulse' : 'bg-[var(--gt-accent-2)]'
                  }`}
                />
                <span className="max-w-[180px] truncate font-semibold">{ws.label}</span>
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
        {sessions.map((s) => {
          const peers = peersByKey.get(s.key)
          return (
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
                peerSessions={peers}
                onSwitchSession={activate}
                onAddSession={() => setAdding({ repoRoot: cwdOf(s) || '' })}
                onCloseSession={closeSession}
                onRenameSession={renameSession}
              />
            </div>
          )
        })}
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
        {showEntry && (
          <div className="absolute inset-0 z-50 bg-[var(--gt-bg)]">
            <EntryScreen
              onChoose={(c) => {
                // When entering inside an existing workspace, force the cwd
                // even if the user typed something else (defensive — the UI
                // hides the cwd input but onChoose can still set it).
                if (adding && typeof adding === 'object') {
                  addSession({ ...c, cwd: adding.repoRoot })
                } else {
                  addSession(c)
                }
              }}
              onCancel={sessions.length ? () => setAdding(false) : undefined}
              lockedCwd={adding && typeof adding === 'object' ? adding.repoRoot : undefined}
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
