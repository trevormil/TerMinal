import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  CircleCheck,
  Ticket,
  GitPullRequest,
  Cpu,
  Bot,
  TriangleAlert,
  Info,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { activityTone } from '../../lib/badges'
import { badgeClasses } from '../../components/ui'
import type { Tab, TabContext, ActivityEvent, ActivityKind } from '../../lib/types'

const ICON: Record<ActivityKind, LucideIcon> = {
  'task-complete': CircleCheck,
  'ticket-filed': Ticket,
  'pr-verdict': GitPullRequest,
  'session-start': Cpu,
  'agent-run': Bot,
  error: TriangleAlert,
  info: Info,
}

function reltime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 10) return 'just now'
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

type Scope = 'all' | 'repo' | 'session'

function ActivityTab({ ctx }: { ctx: TabContext }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [scope, setScope] = useState<Scope>('all')
  const [telegram, setTelegram] = useState(false)
  const [, force] = useState(0) // re-tick relative times
  const newest = useRef<string>('') // id of the most recent event, for the live flash

  useEffect(() => {
    window.gt.settings.get().then((s) => setTelegram(s.telegram))
    window.gt.activity.list().then((e) => {
      setEvents(e)
      newest.current = e[0]?.id || ''
    })
    const off = window.gt.activity.onEvent((ev) => {
      newest.current = ev.id
      setEvents((prev) => [ev, ...prev].slice(0, 1000))
    })
    const t = setInterval(() => force((n) => n + 1), 30_000) // refresh "Nm ago"
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const shown = events.filter((e) =>
    scope === 'all'
      ? true
      : scope === 'repo'
        ? e.repoRoot === ctx.repoRoot
        : e.sessionId === ctx.sessionId,
  )

  const clear = async () => {
    await window.gt.activity.clear()
    setEvents([])
  }

  const toggleTelegram = async () => {
    const s = await window.gt.settings.set('telegram', !telegram)
    setTelegram(s.telegram)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2">
        <Activity size={14} strokeWidth={2} className="text-[var(--gt-accent-2)]" />
        <span className="mr-1 text-[12px] font-semibold text-zinc-200">Activity</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gt-green)] gt-pulse" />
          live
        </span>
        <span className="mx-1 text-zinc-700">·</span>
        <Chip active={scope === 'all'} onClick={() => setScope('all')}>
          all repos
        </Chip>
        <Chip active={scope === 'repo'} onClick={() => setScope('repo')}>
          this repo
        </Chip>
        <Chip active={scope === 'session'} onClick={() => setScope('session')}>
          this session
        </Chip>
        <div className="flex-1" />
        <button
          onClick={toggleTelegram}
          title={telegram ? 'Telegram notifications on — click to disable' : 'Mirror notifications to Telegram'}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
            telegram
              ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
              : 'border-[var(--gt-border)] text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Send size={11} strokeWidth={2} />
          Telegram
        </button>
        <span className="text-[11px] tabular-nums text-zinc-600">{shown.length}</span>
        <button
          onClick={clear}
          className="rounded-md px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          clear
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-6 text-[12px] text-zinc-600">
            No activity yet. Finished turns, filed tickets, and session starts show up here (and as
            macOS notifications).
          </div>
        ) : (
          shown.map((e) => {
            const Icon = ICON[e.kind] || Info
            return (
              <div
                key={e.id}
                className={`flex items-start gap-2.5 border-b border-[var(--gt-border)]/50 px-4 py-2.5 ${
                  e.id === newest.current ? 'gt-pop-in' : ''
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${badgeClasses(
                    activityTone(e.kind),
                  )}`}
                >
                  <Icon size={12} strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{e.title}</span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-600">
                      {reltime(e.ts)}
                    </span>
                  </div>
                  {e.detail && (
                    <div className="truncate text-[11.5px] text-zinc-500" title={e.detail}>
                      {e.detail}
                    </div>
                  )}
                  {e.repo && scope === 'all' && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{e.repo}</div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'activity',
  title: 'Activity',
  icon: Activity,
  order: 4,
  appliesTo: () => true, // global feed, always available
  Component: ActivityTab,
}
export default tab
