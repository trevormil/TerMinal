import { useEffect } from 'react'
import {
  Bot,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  History,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TabContext } from '../lib/types'
import { navigateTo } from '../lib/nav'

// Per-repo orientation: what each core tab is for in THIS repo, with live
// found/missing status from TabContext. Auto-shows once for fresh repos (no
// agents, no backlog — see shouldAutoShowRepoOrientation) and on demand from
// the ⌘K palette. Closing it persists the per-repo dismissal via onClose.

function Row({
  icon: Icon,
  name,
  present,
  text,
  onOpen,
}: {
  icon: LucideIcon
  name: string
  present: boolean | null
  text: string
  onOpen?: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      {present === null ? (
        <span className="mt-0.5 w-[15px] shrink-0" />
      ) : present ? (
        <CircleCheck size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-green)]" />
      ) : (
        <CircleDashed size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-zinc-600" />
      )}
      <Icon size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
      <div className="min-w-0 flex-1">
        <span className="text-[12.5px] font-semibold text-zinc-200">{name}</span>
        <span className="ml-2 text-[12px] text-zinc-500">{text}</span>
      </div>
      {onOpen && (
        <button
          onClick={onOpen}
          className="shrink-0 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
        >
          Open
        </button>
      )}
    </div>
  )
}

export function RepoOrientation({ ctx, onClose }: { ctx: TabContext; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const repoName = ctx.repoPath || ctx.repoRoot.split('/').filter(Boolean).pop() || ctx.repoRoot
  const open = (tabId: string) => {
    navigateTo(tabId)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-5"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-full rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold tracking-tight text-zinc-100">
            <span className="gt-grad-text">{repoName}</span> in TerMinal
          </h2>
          <button
            onClick={onClose}
            title="Got it — don't show this again for this repo"
            className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
        <p className="mb-4 text-[12px] text-zinc-500">
          What each tab does in this repo, and what makes it fill in.
        </p>

        <div className="mb-5 space-y-3">
          <Row
            icon={ClipboardList}
            name="Tickets"
            present={ctx.hasBacklog}
            text={
              ctx.hasBacklog
                ? `Backlog ready (${ctx.ticketProviderLabel}). Agents pick work up from here.`
                : 'No backlog yet — file the first ticket and agents can pick it up.'
            }
            onOpen={() => open('tickets')}
          />
          <Row
            icon={Bot}
            name="Agents"
            present={ctx.hasAgents}
            text={
              ctx.hasAgents
                ? 'Agent roster found (.agents/) — these own tickets and schedules.'
                : 'No agents yet — the Bootstrap banner above seeds a starter roster.'
            }
            onOpen={() => open('agents')}
          />
          <Row
            icon={History}
            name="Runs"
            present={null}
            text="Fills in as agents execute — every run lands here with its log."
          />
          <Row
            icon={CalendarClock}
            name="Schedules"
            present={null}
            text="Recurring agent runs on real launchd jobs — set one up when an agent earns it."
            onOpen={() => open('schedules')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10.5px] text-zinc-600">
            Reopen anytime: ⌘K → "Repo orientation"
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12.5px] font-semibold text-white hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
