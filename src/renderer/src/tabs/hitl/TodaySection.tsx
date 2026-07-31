import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  Lightbulb,
  Sunrise,
  Ticket,
  TriangleAlert,
  X,
} from 'lucide-react'
import { navigateTo } from '../../lib/nav'
import { resolveBriefingTarget } from './briefingLink'
import type { Briefing, BriefingItem, BriefingItemKind, BriefingVerdict } from '../../lib/types'

// The "Today" section of the Inbox drawer — the morning briefing's review
// surface.
//
// It lives HERE rather than in a tab of its own on purpose: Reports is
// per-repo while the briefing is inherently cross-repo, and the drawer is
// already where "things that need you" live. It also means the briefing rides
// the badge the drawer already has, with no new chrome.
//
// This is the surface that closes the dedup loop from ticket-ideas: Dismiss
// writes the verdict into the producing agent's ledger, so tomorrow's run
// never proposes the same thing again.

const KIND_ICON: Record<BriefingItemKind, typeof Ticket> = {
  pr: GitPullRequest,
  ticket: Ticket,
  idea: Lightbulb,
  hitl: TriangleAlert,
  run: TriangleAlert,
  report: Ticket,
  lesson: Sunrise,
  note: Ticket,
}

const KIND_TONE: Record<BriefingItemKind, string> = {
  pr: 'text-[var(--gt-accent-light)]',
  ticket: 'text-zinc-400',
  idea: 'text-amber-400',
  hitl: 'text-[var(--gt-red)]',
  run: 'text-[var(--gt-red)]',
  report: 'text-zinc-400',
  lesson: 'text-emerald-400',
  note: 'text-zinc-500',
}

/** Deep-link an item to the tab that owns it. Resolution logic (and its tests)
 *  live in briefingLink.ts. */
function openItem(item: BriefingItem): void {
  const target = resolveBriefingTarget(item)
  if (target.kind === 'url') window.open(target.url, '_blank', 'noopener')
  else navigateTo(target.tabId, target.payload)
}

function ActionButton({
  label,
  title,
  onClick,
  tone,
  Icon,
}: {
  label: string
  title: string
  onClick: () => void
  tone: string
  Icon: typeof Check
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors duration-150 ${tone}`}
    >
      <Icon size={11} strokeWidth={2} />
      {label}
    </button>
  )
}

export function TodaySection() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = () =>
    window.gt.briefings
      .latest()
      .then(setBriefing)
      .catch(() => setBriefing(null))

  useEffect(() => {
    reload()
    // The briefing is written once a day by a scheduled agent, so a slow poll
    // is plenty — this does not need the 15s cadence the HITL list uses.
    const t = setInterval(reload, 120_000)
    return () => clearInterval(t)
  }, [])

  // Nothing generated yet (no schedule, or first day) — render nothing at all
  // rather than an empty-state that implies something is broken.
  if (!briefing) return null

  const act = async (item: BriefingItem, verdict: BriefingVerdict) => {
    setBusy(item.id)
    setError(null)
    // Optimistic: the verdict is a local UI state change either way, and the
    // reload below is authoritative.
    setBriefing((prev) =>
      prev
        ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, verdict } : i)) }
        : prev,
    )
    const r = await window.gt.briefings.act(briefing.date, item.id, verdict)
    setBusy(null)
    if (!r.ok) setError(r.error)
    reload()
  }

  const pending = briefing.items.filter((i) => !i.verdict)

  return (
    <div className="border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/40">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
        {collapsed ? (
          <ChevronRight size={13} className="text-zinc-600" />
        ) : (
          <ChevronDown size={13} className="text-zinc-600" />
        )}
        <Sunrise size={14} strokeWidth={2} className="text-amber-400" />
        <span className="text-[12px] font-semibold text-zinc-200">Today</span>
        <span className="text-[11px] text-zinc-600">{briefing.date}</span>
        <div className="flex-1" />
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            {pending.length} to review
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="pb-2">
          {briefing.summary && (
            <p className="px-4 pb-2 text-[11px] leading-relaxed text-zinc-500">
              {briefing.summary}
            </p>
          )}
          {error && <p className="px-4 pb-2 text-[11px] text-[var(--gt-red)]">{error}</p>}
          {briefing.items.length === 0 ? (
            <p className="px-4 pb-1 text-[11px] text-zinc-600">
              The agents ran and produced nothing worth your attention. That is a good morning.
            </p>
          ) : (
            <div className="divide-y divide-[var(--gt-border)]/40">
              {briefing.items.map((item) => {
                const Icon = KIND_ICON[item.kind] || Ticket
                const done = !!item.verdict
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2.5 px-4 py-2 ${done ? 'opacity-45' : ''}`}
                  >
                    <Icon
                      size={13}
                      strokeWidth={2}
                      className={`mt-0.5 shrink-0 ${KIND_TONE[item.kind] || 'text-zinc-500'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[12px] ${done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}
                      >
                        {item.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-600">
                        {item.repo && <span>{item.repo}</span>}
                        {item.agent && <span>· {item.agent}</span>}
                        {item.detail && <span className="truncate">· {item.detail}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <ActionButton
                        label="Open"
                        title="Jump to the tab that owns this"
                        Icon={ArrowUpRight}
                        tone="border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                        onClick={() => openItem(item)}
                      />
                      {!done && (
                        <>
                          <ActionButton
                            label="Promote"
                            title="Worth acting on — keep it in the queue"
                            Icon={Check}
                            tone="border-[var(--gt-accent)]/40 text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/10"
                            onClick={() => void act(item, 'promoted')}
                          />
                          <ActionButton
                            label="Dismiss"
                            title="Not worth it — the producing agent will never propose this again"
                            Icon={X}
                            tone="border-[var(--gt-border)] text-zinc-500 hover:border-[var(--gt-red)]/50 hover:text-[var(--gt-red)]"
                            onClick={() => void act(item, 'dismissed')}
                          />
                        </>
                      )}
                      {done && (
                        <span className="text-[10px] text-zinc-600">
                          {busy === item.id ? '…' : item.verdict}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
