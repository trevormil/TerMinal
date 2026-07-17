import { useEffect } from 'react'
import {
  ArrowRight,
  Bot,
  CalendarClock,
  ClipboardList,
  History,
  Inbox,
  SquareTerminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logo from '../assets/logo.png'

// One-time orientation shown right after first-run setup completes (and only
// then — see firstRunPhase in lib/orientation.ts). Deliberately a single
// screen, not a tour: name the core surfaces, state the first action, get out
// of the way. Dismissing it is terminal; it never comes back on later launches.

const SURFACES: { icon: LucideIcon; name: string; what: string }[] = [
  {
    icon: SquareTerminal,
    name: 'Terminal',
    what: 'Live Claude / Codex sessions — everything else orbits these.',
  },
  {
    icon: ClipboardList,
    name: 'Tickets',
    what: 'The per-repo backlog. Agents pick work up from here.',
  },
  {
    icon: Bot,
    name: 'Agents',
    what: 'The roster that owns tickets and scheduled work for a repo.',
  },
  {
    icon: History,
    name: 'Runs',
    what: 'Every agent run — live or scheduled — with its full log.',
  },
  {
    icon: CalendarClock,
    name: 'Schedules',
    what: 'Recurring agent runs, registered as real launchd jobs.',
  },
  {
    icon: Inbox,
    name: 'Inbox',
    what: 'Top-right drawer: anything an agent needs a human for.',
  },
]

export function Orientation({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-xl px-8 py-12">
        <div className="mb-2 flex items-center gap-3">
          <img src={logo} alt="" draggable={false} className="h-10 w-10 rounded-xl" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">You're set up</h1>
        </div>
        <p className="mb-7 text-sm text-zinc-500">
          Here's the map. Each of these is a tab inside a workspace — open a repo and they light up
          for that repo.
        </p>

        <div className="mb-7 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="space-y-3">
            {SURFACES.map(({ icon: Icon, name, what }) => (
              <div key={name} className="flex items-start gap-3">
                <Icon
                  size={16}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]"
                />
                <div className="min-w-0">
                  <span className="text-[12.5px] font-semibold text-zinc-200">{name}</span>
                  <span className="ml-2 text-[12px] text-zinc-500">{what}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-7 rounded-2xl border border-[var(--gt-accent)]/35 bg-[var(--gt-accent)]/10 px-4 py-3 text-[12.5px] text-zinc-300">
          <span className="font-semibold text-zinc-100">First move:</span> pick a repo on the next
          screen — that opens a terminal session in it, and the tabs fill in around it.
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={onDone}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90"
          >
            <ArrowRight size={15} strokeWidth={2.5} />
            Open your first repo
          </button>
        </div>
        <p className="mt-4 text-center text-[10.5px] text-zinc-600">
          This screen shows once. Replay it anytime from Settings → Re-run first-time setup.
        </p>
      </div>
    </div>
  )
}
