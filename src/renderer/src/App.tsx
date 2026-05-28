import { useEffect, useState, type CSSProperties } from 'react'
import { Plus, X } from 'lucide-react'
import { EntryScreen, type Choice } from './components/EntryScreen'
import { SessionView, type Info } from './SessionView'
import logo from './assets/logo.png'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type Sess = { key: string; choice: Choice; info: Info }

const labelFor = (s: Sess) => {
  const cwd = s.info.cwd || s.choice.cwd || ''
  if (cwd) return cwd.replace(/\/$/, '').split('/').pop() || cwd
  if (s.choice.mode === 'resume' && s.choice.sessionId) return s.choice.sessionId.slice(0, 6)
  return s.choice.name || 'new'
}

export default function App() {
  const [sessions, setSessions] = useState<Sess[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(true)

  // tell main which session is active (data IPC reads it)
  useEffect(() => {
    if (activeKey) window.gt.setActiveSession(activeKey)
  }, [activeKey])

  const addSession = (choice: Choice) => {
    const key = crypto.randomUUID()
    setSessions((s) => [...s, { key, choice, info: { sessionId: '', cwd: '' } }])
    setActiveKey(key)
    setAdding(false)
  }
  const closeSession = (key: string) => {
    window.gt.stopSession(key)
    setSessions((s) => {
      const next = s.filter((x) => x.key !== key)
      if (activeKey === key) setActiveKey(next[next.length - 1]?.key ?? null)
      if (next.length === 0) setAdding(true)
      return next
    })
  }
  const setInfo = (key: string, info: Info) =>
    setSessions((s) => s.map((x) => (x.key === key ? { ...x, info } : x)))

  const showEntry = adding || sessions.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* session tab bar (top-level, also the window drag region) */}
      <header
        style={drag}
        className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] pl-[78px] pr-2"
      >
        <img
          src={logo}
          alt="Gauntlet Terminal"
          draggable={false}
          className="mr-1.5 h-5 w-5 rounded-md"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => {
            const on = s.key === activeKey
            return (
              <div
                key={s.key}
                style={noDrag}
                onClick={() => setActiveKey(s.key)}
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${
                  on
                    ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.choice.mode === 'new' ? 'bg-[var(--gt-accent)]' : 'bg-[var(--gt-accent-2)]'
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
        {showEntry && (
          <div className="absolute inset-0 z-50 bg-[var(--gt-bg)]">
            <EntryScreen
              onChoose={addSession}
              onCancel={sessions.length ? () => setAdding(false) : undefined}
            />
          </div>
        )}
      </div>
    </div>
  )
}
