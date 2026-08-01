import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Mail,
  X,
  Trash2,
  ListChecks,
  SquareTerminal,
  Ticket,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { RepoTrustReview, useRepoTrustPrompt } from '../../components/RepoTrustReview'
import { navigateTo } from '../../lib/nav'
import type { Tab, TabContext, HitlItem } from '../../lib/types'
import { relativeTime } from '../../lib/time'
import { ageColor, ageLabel, ageTierOf, untilLabel } from '../../lib/inboxAge'
import { snoozePresets } from '../../../../shared/snooze'

// Alert loudness, shown as a tag. Mirrors src/main/hitl-severity.ts; legacy
// 'push' reads as urgent.
type Sev = 'urgent' | 'normal' | 'low'
function severityOf(h: HitlItem): Sev {
  const s = h.severity
  if (s === 'normal') return 'normal'
  if (s === 'low') return 'low'
  return 'urgent' // 'urgent' | legacy 'push' | undefined
}
function SeverityTag({ sev }: { sev: Sev }) {
  const style: Record<Sev, string> = {
    urgent: 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-[var(--gt-red)]',
    normal: 'border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 text-[var(--gt-accent-light)]',
    low: 'border-[var(--gt-border)] text-zinc-500',
  }
  const label: Record<Sev, string> = { urgent: 'urgent', normal: 'normal', low: 'low' }
  const title: Record<Sev, string> = {
    urgent: 'Urgent — notifies you (per your Settings threshold)',
    normal: 'Normal — inbox unless you lower the notify threshold',
    low: 'Low — inbox only, never notifies',
  }
  return (
    <span
      title={title[sev]}
      className={`shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-semibold ${style[sev]}`}
    >
      {label[sev]}
    </span>
  )
}

export type InboxTerminalRef = {
  key: string
  sessionId?: string
  cwd?: string
}

// Derive the Tickets-tab slug (file basename without extension) from a ticket
// path. Cron-failure HITLs pair with a ticket whose path looks like
// `…/backlog/0123-cron-fail-foo.md` — the slug is `0123-cron-fail-foo`.
function ticketSlugFromPath(path: string): string {
  const base = path.split('/').pop() || ''
  return base.replace(/\.md$/, '')
}

// Human-in-the-loop: a GLOBAL, cross-repo inbox of TRUE human-needs — decisions,
// approvals, creds, a failed cron job. NOT per-repo backlog tickets, and NOT
// review request-changes (those are iterative workflow). Filing one pings Telegram;
// the tab shows a red count of open items.
const SOURCE_TONE: Record<string, BadgeTone> = {
  'cron-fail': 'red',
  agent: 'blue',
  factory: 'accent',
  skill: 'blue',
  listener: 'blue',
  'completion-hook': 'accent',
  'review-pattern': 'yellow',
  manual: 'mute',
}

const reltime = relativeTime

function cleanPath(path?: string): string {
  return (path || '').replace(/\/$/, '')
}

function hasOpenTerminal(h: HitlItem, terminals: InboxTerminalRef[]): boolean {
  if (terminals.length === 0) return false
  if (h.terminalKey) return terminals.some((t) => t.key === h.terminalKey)
  if (h.sessionId) return terminals.some((t) => t.sessionId === h.sessionId)

  const targetCwd = cleanPath(h.terminalCwd)
  const targetRepo = cleanPath(h.repoRoot)
  if (!targetCwd && !targetRepo) return false

  return terminals.some((t) => {
    const cwd = cleanPath(t.cwd)
    if (!cwd) return false
    if (targetCwd && cwd === targetCwd) return true
    if (targetRepo && (cwd === targetRepo || cwd.startsWith(`${targetRepo}/`))) return true
    return false
  })
}

function bodyOf(h: HitlItem): string {
  return [h.action, h.detail].filter(Boolean).join('\n\n')
}

// One-line preview under the subject, like a mail client — markdown syntax
// stripped just enough to read as prose.
function snippetOf(h: HitlItem): string {
  return bodyOf(h)
    .replace(/[#*`>_[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

const ACTION_BTN =
  'inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100'

export function InboxDrawer({
  onClose,
  openTerminals = [],
}: {
  ctx?: TabContext | null
  onClose?: () => void
  openTerminals?: InboxTerminalRef[]
}) {
  const [items, setItems] = useState<HitlItem[] | null>(null)
  // One list, one axis: unread (bold) vs read. No archive.
  const [reading, setReading] = useState<string | null>(null)
  // id → ms-epoch the item comes due again. Persisted in main (survives restart)
  // and consulted by the alert dispatcher, so a snoozed item is silent too.
  const [snoozes, setSnoozes] = useState<Record<string, number>>({})
  // Presets are computed fresh on every open, never cached: fetched once at
  // mount, "1 hour" is an absolute instant that silently drifts into the past
  // on a long-running window, and snoozing to the past is a no-op.
  const [presetsOpenedAt, setPresetsOpenedAt] = useState(0)
  const presets = useMemo(() => snoozePresets(presetsOpenedAt || Date.now()), [presetsOpenedAt])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [showSnoozed, setShowSnoozed] = useState(false)
  // Repo-widget trust approvals surface here too — same cadence as the list, so
  // switching sessions updates the card without reopening the drawer.
  const trustPrompt = useRepoTrustPrompt(15_000)

  // Merge local HITL with open items fanned out from every host (#14), so a run
  // that failed on a host and filed a block there shows here with a host badge.
  // Best-effort: an unreachable host is dropped, never blocks the local view.
  const reload = () =>
    Promise.all([
      window.gt.hitl.list(),
      window.gt.hitl
        .remoteAll()
        .then((r) => r.items)
        .catch(() => [] as HitlItem[]),
    ]).then(([local, remote]) => setItems([...local, ...remote]))
  const reloadSnoozes = () =>
    window.gt.inbox
      .snoozes()
      .then(setSnoozes)
      .catch(() => {})
  useEffect(() => {
    void reload()
    void reloadSnoozes()
    // pick up newly auto-filed items (e.g. a failed cron) live
    const off = window.gt.activity.onEvent((ev) => {
      if (ev.kind === 'blocked' || ev.kind === 'task-complete') void reload()
    })
    const t = setInterval(() => {
      void reload()
      // Also re-reads snoozes, so an item that comes due reappears in the main
      // list within one poll rather than waiting for a manual refresh.
      void reloadSnoozes()
    }, 15_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  // One axis: read vs unread. No archive. Legacy items already resolved before
  // this change stay hidden (they were archived); everything else shows, newest
  // first, unread bold.
  const all = (items || [])
    .filter((h) => h.status !== 'resolved')
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
  const isUnread = (h: HitlItem) => !h.readAt
  const now = Date.now()
  const isSnoozed = (h: HitlItem) => (snoozes[h.id] || 0) > now
  const snoozedItems = all.filter(isSnoozed)
  // A snoozed item is off your plate: out of the list AND out of the unread
  // count, or "ask me tomorrow" would still nag you today.
  const shown = all.filter((h) => !isSnoozed(h))
  const unread = shown.filter(isUnread)

  // Group ids by owning host — a remote item's readAt must persist on the host
  // that owns it (like resolve), or the 15s reload flips it back to unread.
  const byHost = (hs: HitlItem[]) => {
    const groups = new Map<string | undefined, string[]>()
    for (const h of hs) groups.set(h.hostId, [...(groups.get(h.hostId) || []), h.id])
    return groups
  }
  const markRead = (ids: string[]) => {
    const fresh = all.filter((h) => ids.includes(h.id) && !h.readAt)
    if (!fresh.length) return
    // Optimistic: flip local read-state now, persist in the background.
    const freshIds = fresh.map((h) => h.id)
    setItems((prev) =>
      (prev || []).map((h) => (freshIds.includes(h.id) ? { ...h, readAt: Date.now() } : h)),
    )
    for (const [hostId, hostIds] of byHost(fresh))
      void window.gt.hitl.markRead(hostIds, hostId).catch(() => 0)
  }
  // Email parity: put an item back on the unread pile (and return to the list,
  // like a mail client does).
  const markUnread = (h: HitlItem) => {
    setItems((prev) => (prev || []).map((x) => (x.id === h.id ? { ...x, readAt: undefined } : x)))
    void window.gt.hitl.markRead([h.id], h.hostId, false).catch(() => 0)
    setReading(null)
  }
  const markAllRead = async () => {
    if (!unread.length) return
    const remoteUnread = unread.filter((h) => h.hostId)
    setItems((prev) => (prev || []).map((h) => (isUnread(h) ? { ...h, readAt: Date.now() } : h)))
    await Promise.all([
      window.gt.hitl.markAllRead(),
      ...[...byHost(remoteUnread)].map(([hostId, ids]) =>
        window.gt.hitl.markRead(ids, hostId).catch(() => 0),
      ),
    ])
  }
  const remove = async (h: HitlItem) => {
    setItems((prev) => (prev || []).filter((x) => x.id !== h.id))
    setReading(null)
    await window.gt.hitl.remove(h.id, h.hostId).catch(() => false)
  }

  const snooze = async (ids: string[], until: number) => {
    setSnoozes((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = until
      return next
    })
    setSelected(new Set())
    setSnoozeOpen(false)
    setReading(null)
    for (const id of ids) await window.gt.inbox.snooze(id, until).catch(() => ({}))
  }
  const unsnooze = async (id: string) => {
    setSnoozes((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    await window.gt.inbox.unsnooze(id).catch(() => ({}))
  }

  const toggleSelect = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const selectedIds = [...selected].filter((id) => shown.some((h) => h.id === id))
  // Bulk resolve is the "clear the queue" gesture: mark read, then resolve each
  // on its owning host so a remote item doesn't bounce back on the next poll.
  const resolveSelected = async () => {
    const targets = shown.filter((h) => selectedIds.includes(h.id))
    if (!targets.length) return
    setItems((prev) => (prev || []).filter((h) => !selectedIds.includes(h.id)))
    setSelected(new Set())
    await Promise.all(
      targets.map((h) => window.gt.hitl.resolve(h.id, true, h.hostId).catch(() => false)),
    )
  }

  // Mail-client model: the list is the inbox; opening an item replaces the
  // whole pane with the message and a back button — no accordion.
  const readingItem = reading ? all.find((h) => h.id === reading) || null : null
  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setReading(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [reading])
  if (readingItem) {
    const canViewTerminal = hasOpenTerminal(readingItem, openTerminals)
    const body = bodyOf(readingItem)
    const h = readingItem
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          <button
            onClick={() => setReading(null)}
            title="Back to Inbox (Esc)"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-zinc-400 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-100"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Inbox
          </button>
          <div className="flex-1" />
          <SeverityTag sev={severityOf(h)} />
          <Badge tone={SOURCE_TONE[h.source] || 'mute'}>{h.source}</Badge>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Inbox"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={15} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[640px] px-6 py-5">
            <h2 className="text-[17px] font-semibold leading-snug text-zinc-100">{h.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
              {h.repo && <span className="font-medium text-zinc-400">{h.repo}</span>}
              {(h.terminalCwd || h.repoRoot) && (
                <span className="truncate font-mono text-[10px]">
                  {h.terminalCwd || h.repoRoot}
                </span>
              )}
              <span>·</span>
              <span>{reltime(h.createdAt)}</span>
              {(h.occurrenceCount || 1) > 1 && h.source !== 'completion-hook' && (
                <span className="rounded-full border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 px-1.5 text-[9.5px] font-semibold text-[var(--gt-yellow)]">
                  x{h.occurrenceCount}
                </span>
              )}
            </div>
            <div className="my-4 border-t border-[var(--gt-border)]" />
            {body ? (
              <Markdown className="text-[12.5px] leading-relaxed text-zinc-300">{body}</Markdown>
            ) : (
              <div className="text-[12px] italic text-zinc-600">No details.</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--gt-border)] px-4 py-2.5">
          {canViewTerminal && (
            <button
              onClick={() =>
                navigateTo('terminal', {
                  sessionKey: h.terminalKey,
                  sessionId: h.sessionId,
                  cwd: h.terminalCwd || h.repoRoot,
                  repoRoot: h.repoRoot,
                })
              }
              className={ACTION_BTN}
            >
              <SquareTerminal size={11} strokeWidth={2} />
              Terminal
            </button>
          )}
          {h.runId && (
            <button onClick={() => navigateTo('runs', { runId: h.runId })} className={ACTION_BTN}>
              <ListChecks size={11} strokeWidth={2} />
              Run
            </button>
          )}
          {h.ticketPath && (
            <button
              onClick={() => navigateTo('tickets', { slug: ticketSlugFromPath(h.ticketPath!) })}
              className={ACTION_BTN}
            >
              <Ticket size={11} strokeWidth={2} />
              Ticket
            </button>
          )}
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => {
                setPresetsOpenedAt(Date.now())
                setSnoozeOpen((v) => !v)
              }}
              className={ACTION_BTN}
            >
              <Clock size={11} strokeWidth={2} />
              Snooze
            </button>
            {snoozeOpen && (
              <div className="absolute bottom-9 right-0 z-20 w-40 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-lg">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => snooze([h.id], p.until)}
                    className="block w-full px-2.5 py-1.5 text-left text-[11.5px] text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {h.readAt ? (
            <button onClick={() => markUnread(h)} title="Mark unread" className={ACTION_BTN}>
              <Mail size={11} strokeWidth={2} />
              Mark unread
            </button>
          ) : (
            <button
              onClick={() => {
                markRead([h.id])
                setReading(null)
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors duration-150 hover:border-[var(--gt-green)]/60 hover:text-[var(--gt-green)]"
            >
              <Check size={12} strokeWidth={2.5} />
              Mark read
            </button>
          )}
          <button
            onClick={() => {
              if (!confirm('Delete this Inbox item permanently?')) return
              void remove(h)
            }}
            title="Delete"
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-[var(--gt-border)] px-1.5 py-1 text-zinc-500 transition-colors duration-150 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Mail size={14} strokeWidth={2} className="text-[var(--gt-accent)]" />
        <span className="text-[12px] font-semibold text-zinc-200">Inbox</span>
        <span className="text-[11px] text-zinc-600">
          one global inbox · everything that needs you
        </span>
        <div className="flex-1" />
        {selectedIds.length > 0 && (
          <>
            <span className="text-[10.5px] font-semibold text-[var(--gt-accent-light)]">
              {selectedIds.length} selected
            </span>
            <button onClick={() => markRead(selectedIds)} className={ACTION_BTN}>
              <Check size={11} strokeWidth={2.5} />
              Read
            </button>
            <button onClick={resolveSelected} className={ACTION_BTN}>
              <Check size={11} strokeWidth={2.5} />
              Resolve
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  setPresetsOpenedAt(Date.now())
                  setSnoozeOpen((v) => !v)
                }}
                className={ACTION_BTN}
              >
                <Clock size={11} strokeWidth={2} />
                Snooze
              </button>
              {snoozeOpen && (
                <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-lg">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => snooze(selectedIds, p.until)}
                      className="block w-full px-2.5 py-1.5 text-left text-[11.5px] text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[10.5px] text-zinc-600 hover:text-zinc-300"
            >
              Clear
            </button>
          </>
        )}
        {selectedIds.length === 0 && unread.length > 0 && (
          <button
            onClick={markAllRead}
            title="Mark every unread item read"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
          >
            Mark all read
          </button>
        )}
        {selectedIds.length === 0 && unread.length > 0 && (
          <span className="rounded-full bg-[var(--gt-accent)]/25 px-2 py-0.5 text-[10px] font-bold text-[var(--gt-accent-light)]">
            {unread.length} unread
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            title="Close Inbox"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Not a HITL item on disk — a live decision about the active repo. It
            sits above the list because it is the one thing here that is
            actively blocking a feature the user can see is missing. */}
        {trustPrompt.pending && (
          <div className="px-4 pt-4">
            <RepoTrustReview prompt={trustPrompt} hideWhenSettled />
          </div>
        )}
        {items === null ? (
          <div className="p-4 text-[12px] text-zinc-600">Loading…</div>
        ) : shown.length === 0 ? (
          !trustPrompt.pending && (
            <div className="p-4 text-[12px] text-zinc-600">
              Inbox zero. Human-needs (decisions, approvals, creds, failed cron runs) land here from
              any repo.
            </div>
          )
        ) : (
          // Flat mail-style rows: hairline dividers, hover highlight, click to
          // open the message full-pane.
          <div className="divide-y divide-[var(--gt-border)]/60">
            {shown.map((h) => {
              const unreadRow = isUnread(h)
              const snippet = snippetOf(h)
              const tier = ageTierOf(h.createdAt, now)
              const tierColor = ageColor(tier)
              const picked = selected.has(h.id)
              return (
                <div
                  key={h.id}
                  className={`group flex w-full items-start gap-2 px-4 py-2.5 transition-colors duration-150 hover:bg-white/[0.04] ${
                    picked ? 'bg-[var(--gt-accent)]/10' : ''
                  }`}
                  // Aging stripe: the item's whole left edge reddens as it sits.
                  style={tierColor ? { boxShadow: `inset 2px 0 0 0 ${tierColor}` } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => toggleSelect(h.id)}
                    title="Select for bulk actions"
                    className={`mt-[5px] h-3 w-3 shrink-0 cursor-pointer accent-[var(--gt-accent)] ${
                      picked || selectedIds.length > 0
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  />
                  <button
                    onClick={() => {
                      setReading(h.id)
                      if (unreadRow) markRead([h.id])
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
                  >
                    <span
                      className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${unreadRow ? 'bg-[var(--gt-accent)]' : ''}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`min-w-0 flex-1 truncate text-[12.5px] ${unreadRow ? 'font-semibold text-zinc-100' : 'font-medium text-zinc-300'}`}
                        >
                          {h.title}
                        </span>
                        <SeverityTag sev={severityOf(h)} />
                        <Badge tone={SOURCE_TONE[h.source] || 'mute'}>{h.source}</Badge>
                        {(h.occurrenceCount || 1) > 1 && h.source !== 'completion-hook' && (
                          <span className="shrink-0 rounded-full border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 px-1.5 text-[9.5px] font-semibold text-[var(--gt-yellow)]">
                            x{h.occurrenceCount}
                          </span>
                        )}
                        <span
                          title={ageLabel(tier)}
                          className="shrink-0 text-[10px] font-medium tabular-nums"
                          style={{ color: tierColor || 'var(--color-zinc-600, #52525b)' }}
                        >
                          {reltime(h.createdAt)}
                        </span>
                      </span>
                      {(snippet || h.repo) && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
                          {h.repo && <span className="shrink-0 text-zinc-500">{h.repo}</span>}
                          {h.repo && snippet && <span>—</span>}
                          <span className="truncate">{snippet}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {snoozedItems.length > 0 && (
          <div className="border-t border-[var(--gt-border)]">
            <button
              onClick={() => setShowSnoozed((v) => !v)}
              className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[11px] text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
            >
              {showSnoozed ? (
                <ChevronDown size={12} strokeWidth={2} />
              ) : (
                <ChevronRight size={12} strokeWidth={2} />
              )}
              <Clock size={11} strokeWidth={2} />
              Snoozed
              <span className="tabular-nums text-zinc-600">{snoozedItems.length}</span>
            </button>
            {showSnoozed && (
              <div className="divide-y divide-[var(--gt-border)]/60">
                {snoozedItems.map((h) => (
                  <div
                    key={h.id}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left opacity-70"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-400">
                      {h.title}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      due in {untilLabel(snoozes[h.id], now)}
                    </span>
                    <button
                      onClick={() => unsnooze(h.id)}
                      title="Bring this back to the inbox now"
                      className="shrink-0 rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                    >
                      Wake
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'hitl',
  title: 'Inbox',
  icon: Mail,
  order: 4,
  appliesTo: () => true, // global inbox — always available
  // Badge the UNREAD count — a seen-but-unresolved item shouldn't keep nagging.
  // Snoozed items are off your plate, so they must not keep the badge lit —
  // otherwise "ask me tomorrow" still nags you today.
  badge: async (gt) => {
    const [items, snoozes] = await Promise.all([
      gt.hitl.list(),
      gt.inbox.snoozes().catch(() => ({}) as Record<string, number>),
    ])
    const now = Date.now()
    return items.filter((h) => h.status === 'open' && !h.readAt && !((snoozes[h.id] || 0) > now))
      .length
  },
  Component: InboxDrawer,
}
export default tab
