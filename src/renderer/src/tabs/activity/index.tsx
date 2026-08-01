import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  CircleCheck,
  Rocket,
  Ticket,
  TicketCheck,
  GitPullRequest,
  GitPullRequestArrow,
  GitMerge,
  FlaskConical,
  ScanSearch,
  FileText,
  Hand,
  LogOut,
  Cpu,
  Bot,
  TriangleAlert,
  Info,
  Search,
  ArrowLeft,
  ExternalLink,
  X,
  type LucideIcon,
} from 'lucide-react'
import { activityTone } from '../../lib/badges'
import { badgeClasses } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import { InlineMd, Markdown } from '../../components/Markdown'
import type { Tab, TabContext, ActivityEvent, ActivityKind } from '../../lib/types'
import { relativeTime } from '../../lib/time'

// Decide where clicking an activity row should take you. Priority:
//   runId  → Runs tab + pre-select that run
//   ref.pr → MRs tab (no payload — the tab opens to its own selection)
//   ref.ticket present + kind starts with 'ticket' → Tickets tab
async function navForEvent(ev: ActivityEvent): Promise<void> {
  if (ev.runId) return navigateTo('runs', { runId: ev.runId })
  if (ev.ref?.pr) return navigateTo('mrs', { iid: ev.ref.pr })
  if (ev.ref?.ticket) {
    // Look up the slug by ticket id — tickets:list is cheap (single file read).
    try {
      const tickets = await window.gt.tickets.list()
      const match = tickets.find((t) => Number(t.id) === ev.ref!.ticket)
      if (match) return navigateTo('tickets', { slug: match.slug })
    } catch {
      /* fall through */
    }
    return navigateTo('tickets')
  }
}

const ICON: Record<ActivityKind, LucideIcon> = {
  'session-start': Cpu,
  'session-end': LogOut,
  deploy: Rocket,
  'ticket-filed': Ticket,
  'ticket-closed': TicketCheck,
  'pr-opened': GitPullRequestArrow,
  'pr-verdict': GitPullRequest,
  'pr-merged': GitMerge,
  'tests-pass': FlaskConical,
  'tests-fail': FlaskConical,
  check: ScanSearch,
  doc: FileText,
  'agent-run': Bot,
  'task-complete': CircleCheck,
  blocked: Hand,
  error: TriangleAlert,
  info: Info,
}

const KIND_LABEL: Record<ActivityKind, string> = {
  'session-start': 'Session',
  'session-end': 'Session end',
  deploy: 'Deploy',
  'ticket-filed': 'Ticket',
  'ticket-closed': 'Closed',
  'pr-opened': 'Opened',
  'pr-verdict': 'Review',
  'pr-merged': 'Merged',
  'tests-pass': 'Tests',
  'tests-fail': 'Tests',
  check: 'Check',
  doc: 'Doc',
  'agent-run': 'Agent',
  'task-complete': 'Task',
  blocked: 'Blocked',
  error: 'Error',
  info: 'Info',
}

function reltime(ts: number): string {
  // The feed ticks constantly; a 10s floor stops the newest row flickering.
  return Date.now() - ts < 10_000 ? 'just now' : relativeTime(ts)
}

// Titles/details are free text composed at emit time and often already start
// with (or embed) the exact repo label that's also rendered as its own chip
// below — e.g. title "trevormil/foo · local · exited" + a "trevormil/foo"
// chip. These trim ONLY an exact, mechanically-detected overlap with the
// chip's own string — display-only, the underlying event data (also used for
// Telegram notifications) is untouched.
export function declutterTitle(title: string, repo?: string): string {
  if (!repo) return title
  const prefix = `${repo} · `
  return title.startsWith(prefix) ? title.slice(prefix.length) : title
}

export function declutterDetail(detail: string, repo?: string): string {
  if (!repo) return detail
  const base = repo.split('/').pop()
  if (!base) return detail
  // Strip a "~/some/path/<repo-basename>" segment — whether it's the whole
  // detail or trails other content after " · " — the repo chip already names
  // the repo, so restating its path adds nothing.
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|\\s*·\\s*)~?[^·]*/${escaped}$`)
  return detail.replace(re, '').trim()
}

// Day bucket label for the timeline dividers (Today / Yesterday / weekday / date).
function dayLabel(ts: number): string {
  const d = new Date(ts)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Group the (already newest-first) events into consecutive day buckets.
function groupByDay(events: ActivityEvent[]): { label: string; items: ActivityEvent[] }[] {
  const groups: { label: string; items: ActivityEvent[] }[] = []
  for (const e of events) {
    const label = dayLabel(e.ts)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(e)
    else groups.push({ label, items: [e] })
  }
  return groups
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
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

const FEED_PAGE_SIZE = 200

export function ActivityTab({
  ctx,
  global,
  onClose,
}: {
  /** Optional — only the repo/session scopes use it, and those are hidden in
   *  `global` mode (the top-right drawer), which stays on the 'all' scope. */
  ctx?: TabContext
  /** Global feed only — hides the repo/session scope chips (used by the
   *  top-right Activity drawer, which has no active-tab context). */
  global?: boolean
  onClose?: () => void
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [scope, setScope] = useState<Scope>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [, force] = useState(0) // re-tick relative times
  // Which row is expanded (title/detail unclamped). JS-driven rather than a
  // CSS group-hover toggle — line-clamp's -webkit-box display type combined
  // with a hover-only class swap was unreliable in practice (rows stayed
  // clamped on hover), so this makes "expanded or not" an explicit, provable
  // state instead of something to debug in devtools per-row.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Mail-client model, matching the Inbox: the feed is the list, and opening an
  // item replaces the whole pane with a back button and the full body. Clicking
  // a row used to navigate AWAY to Runs/MRs/Tickets, which meant the activity's
  // own detail — often the most informative part — was only ever readable as a
  // two-line clamp on hover.
  const [reading, setReading] = useState<string | null>(null)
  const newest = useRef<string>('') // id of the most recent event, for the live flash

  useEffect(() => {
    // viewing the feed clears the unseen-high-signal tab badge
    localStorage.setItem('gt.activity.lastSeen', String(Date.now()))
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

  // The feed holds up to 1000 events — memoize the filter chain (it used to
  // re-run inline on every keystroke and every 30s time-tick) and let typing
  // stay responsive by filtering against the deferred query value.
  const deferredQuery = useDeferredValue(query)
  const scoped = useMemo(
    () =>
      events.filter((e) =>
        scope === 'all'
          ? true
          : scope === 'repo'
            ? e.repoRoot === ctx?.repoRoot
            : e.sessionId === ctx?.sessionId,
      ),
    [events, scope, ctx?.repoRoot, ctx?.sessionId],
  )
  // kind chips reflect what's actually present in the current scope
  const kindsPresent = useMemo(() => [...new Set(scoped.map((e) => e.kind))].sort(), [scoped])
  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return scoped.filter(
      (e) =>
        (kindFilter === 'all' || e.kind === kindFilter) &&
        (!q || `${e.title} ${e.detail || ''} ${e.repo || ''}`.toLowerCase().includes(q)),
    )
  }, [scoped, kindFilter, deferredQuery])
  // Bounded render with show-more — 1000 rows re-reconciled per tick janks.
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE)
  useEffect(() => {
    setVisibleCount(FEED_PAGE_SIZE)
  }, [scope, kindFilter, deferredQuery])
  const visibleShown = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount])
  const hiddenCount = Math.max(0, shown.length - visibleShown.length)

  const clear = async () => {
    await window.gt.activity.clear()
    setEvents([])
  }

  // ---- detail view ---------------------------------------------------------
  // Read from the full event list, not the filtered one: changing a filter while
  // an item is open must not blank the pane out from under the reader.
  const readingEvent = reading ? events.find((e) => e.id === reading) || null : null
  useEffect(() => {
    if (!reading) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        // Capture-phase + stopPropagation so Escape closes the detail view
        // rather than the drawer this tab can be rendered inside.
        ev.stopPropagation()
        setReading(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [reading])

  if (readingEvent) {
    const e = readingEvent
    const Icon = ICON[e.kind] || Info
    const tone = activityTone(e.kind)
    const hasNav = !!(e.runId || e.ref?.pr || e.ref?.ticket)
    const navLabel = e.runId
      ? 'Open run'
      : e.ref?.pr
        ? 'Open PR / MR'
        : e.ref?.ticket
          ? 'Open ticket'
          : ''
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          <button
            onClick={() => setReading(null)}
            title="Back to Activity (Esc)"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-zinc-400 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-100"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Activity
          </button>
          <div className="flex-1" />
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide ${badgeClasses(
              tone,
            )}`}
          >
            <Icon size={10} strokeWidth={2.25} />
            {KIND_LABEL[e.kind] || e.kind}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Activity"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={15} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[640px] px-6 py-5">
            <h2 className="text-[17px] font-semibold leading-snug text-zinc-100">
              <InlineMd text={e.title} keepLineBreaks />
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
              {e.repo && <span className="font-medium text-zinc-400">{e.repo}</span>}
              <span>{new Date(e.ts).toLocaleString()}</span>
              <span>·</span>
              <span>{reltime(e.ts)}</span>
            </div>
            <div className="my-4 border-t border-[var(--gt-border)]" />
            {/* Full markdown, not the two-line clamp the row shows. Agents write
                real prose here — fenced diffs, lists, links — and clamping it
                was the reason the feed read as headlines with no story. */}
            {e.detail ? (
              <Markdown className="text-[12.5px] leading-relaxed text-zinc-300">
                {e.detail}
              </Markdown>
            ) : (
              <div className="text-[12px] italic text-zinc-600">No details.</div>
            )}
          </div>
        </div>

        {hasNav && (
          <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--gt-border)] px-4 py-2.5">
            <button
              onClick={() => void navForEvent(e)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--gt-border)] px-2.5 py-1.5 text-[11.5px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
            >
              <ExternalLink size={12} strokeWidth={2} />
              {navLabel}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2">
        <Activity size={14} strokeWidth={2} className="text-[var(--gt-accent-2)]" />
        <span className="mr-1 text-[12px] font-semibold text-zinc-200">Activity</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gt-green)] gt-pulse" />
          Live
        </span>
        {!global && (
          <>
            <span className="mx-1 text-zinc-700">·</span>
            <Chip active={scope === 'all'} onClick={() => setScope('all')}>
              All repos
            </Chip>
            <Chip active={scope === 'repo'} onClick={() => setScope('repo')}>
              This repo
            </Chip>
            <Chip active={scope === 'session'} onClick={() => setScope('session')}>
              This session
            </Chip>
          </>
        )}
        <div className="flex-1" />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="cursor-pointer rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
        >
          <option value="all">All kinds</option>
          {kindsPresent.map((k) => (
            <option key={k} value={k} className="bg-[var(--gt-panel)]">
              {KIND_LABEL[k as ActivityKind] || k}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search
            size={11}
            strokeWidth={2}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-600"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-28 rounded-md border border-[var(--gt-border)] bg-black/30 py-0.5 pl-5 pr-1.5 text-[11px] text-zinc-200 outline-none focus:w-40 focus:border-[var(--gt-accent)]/60"
          />
        </div>
        <span className="text-[11px] tabular-nums text-zinc-600">{shown.length}</span>
        <button
          onClick={clear}
          className="rounded-md px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          Clear
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title="Close"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-6 text-[12px] text-zinc-600">
            {events.length === 0
              ? 'No activity yet. Session starts, tickets, PRs, reviews, test runs, checks, docs, and agent runs show up here (and as macOS notifications).'
              : 'No activity matches the current filters.'}
          </div>
        ) : (
          groupByDay(visibleShown).map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--gt-bg)]/90 px-4 py-1.5 backdrop-blur">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {g.label}
                </span>
                <span className="text-[10px] tabular-nums text-zinc-700">{g.items.length}</span>
                <div className="h-px flex-1 bg-[var(--gt-border)]/50" />
              </div>
              {g.items.map((e) => {
                const Icon = ICON[e.kind] || Info
                const tone = activityTone(e.kind)
                const isNew = e.id === newest.current
                const hasNav = !!(e.runId || e.ref?.pr || e.ref?.ticket)
                return (
                  <div
                    key={e.id}
                    onClick={() => setReading(e.id)}
                    onMouseEnter={() => setExpandedId(e.id)}
                    onMouseLeave={() => setExpandedId((id) => (id === e.id ? null : id))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ke) => {
                      if (ke.key === 'Enter' || ke.key === ' ') {
                        ke.preventDefault()
                        setReading(e.id)
                      }
                    }}
                    title={hasNav ? 'Open — the run / PR / ticket link is inside' : 'Open'}
                    className={`group relative flex cursor-pointer gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03] ${
                      isNew ? 'gt-pop-in' : ''
                    }`}
                  >
                    {/* timeline rail: a continuous line with the kind node sitting on it */}
                    <div className="relative flex w-5 shrink-0 justify-center">
                      <span className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-[var(--gt-border)]/70" />
                      <span
                        className={`relative z-10 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-[var(--gt-bg)] ${badgeClasses(
                          tone,
                        )} ${isNew ? 'gt-pulse' : ''}`}
                      >
                        <Icon size={11} strokeWidth={2.25} />
                      </span>
                    </div>
                    {(() => {
                      // The repo chip below already names the repo — trim it
                      // back out of the title/detail text where it's an exact,
                      // mechanically-detected repeat (see declutterTitle/Detail).
                      const showRepoChip = !!(e.repo && scope === 'all')
                      const displayTitle = showRepoChip ? declutterTitle(e.title, e.repo) : e.title
                      const displayDetail = e.detail
                        ? showRepoChip
                          ? declutterDetail(e.detail, e.repo)
                          : e.detail
                        : ''
                      const expanded = expandedId === e.id
                      const clamp = expanded ? '' : 'line-clamp-2'
                      return (
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            {/* line-clamp instead of truncate — nothing here is
                                ever fully cut off with no way to read the rest;
                                hovering the row reveals the full text. */}
                            <span
                              className={`${clamp} min-w-0 flex-1 break-words text-[13px] text-zinc-100`}
                            >
                              <InlineMd text={displayTitle} keepLineBreaks={expanded} />
                            </span>
                            <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-600">
                              {reltime(e.ts)}
                            </span>
                          </div>
                          {displayDetail && (
                            <div className={`${clamp} break-words text-[11.5px] text-zinc-500`}>
                              <InlineMd text={displayDetail} keepLineBreaks={expanded} />
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full border px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide ${badgeClasses(
                                tone,
                              )}`}
                            >
                              {KIND_LABEL[e.kind] || e.kind}
                            </span>
                            {showRepoChip && (
                              <span className="truncate font-mono text-[10px] text-zinc-600">
                                {e.repo}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          ))
        )}
        {hiddenCount > 0 && (
          <button
            onClick={() => setVisibleCount((v) => v + FEED_PAGE_SIZE)}
            className="w-full px-4 py-2 text-center text-[11px] text-[var(--gt-accent-2)] hover:bg-white/5"
          >
            Show {Math.min(hiddenCount, FEED_PAGE_SIZE)} more ({hiddenCount} hidden)
          </button>
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'activity',
  title: 'Activity',
  icon: Activity,
  order: 5,
  appliesTo: () => true, // global feed, always available
  // badge = unseen high-signal events (errors, blockers, test fails) since last view
  badge: async (gt) => {
    const seen = Number(localStorage.getItem('gt.activity.lastSeen') || 0)
    // Count-only endpoint — the 500-event list was fetched just to count 3 kinds.
    return gt.activity.unseenCount(seen, ['error', 'blocked', 'tests-fail'])
  },
  Component: ActivityTab,
}
export default tab
