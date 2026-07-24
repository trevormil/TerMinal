import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
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
import { navigateTo } from '../../lib/nav'
import type { Tab, TabContext, HitlItem } from '../../lib/types'

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

function reltime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

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
  useEffect(() => {
    reload()
    // pick up newly auto-filed items (e.g. a failed cron) live
    const off = window.gt.activity.onEvent((ev) => {
      if (ev.kind === 'blocked' || ev.kind === 'task-complete') reload()
    })
    const t = setInterval(reload, 15_000)
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
  const unread = all.filter(isUnread)
  const shown = all

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
        {unread.length > 0 && (
          <button
            onClick={markAllRead}
            title="Mark every unread item read"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
          >
            Mark all read
          </button>
        )}
        {unread.length > 0 && (
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
        {items === null ? (
          <div className="p-4 text-[12px] text-zinc-600">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-4 text-[12px] text-zinc-600">
            Inbox zero. Human-needs (decisions, approvals, creds, failed cron runs) land here from
            any repo.
          </div>
        ) : (
          // Flat mail-style rows: hairline dividers, hover highlight, click to
          // open the message full-pane.
          <div className="divide-y divide-[var(--gt-border)]/60">
            {shown.map((h) => {
              const unreadRow = isUnread(h)
              const snippet = snippetOf(h)
              return (
                <button
                  key={h.id}
                  onClick={() => {
                    setReading(h.id)
                    if (unreadRow) markRead([h.id])
                  }}
                  className="group flex w-full cursor-pointer items-start gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.04]"
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
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
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
              )
            })}
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
  badge: async (gt) =>
    (await gt.hitl.list()).filter((h) => h.status === 'open' && !h.readAt).length,
  Component: InboxDrawer,
}
export default tab
