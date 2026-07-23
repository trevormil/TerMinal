import { useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Mail,
  X,
  Trash2,
  RotateCcw,
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

export function InboxDrawer({
  onClose,
  openTerminals = [],
}: {
  ctx?: TabContext | null
  onClose?: () => void
  openTerminals?: InboxTerminalRef[]
}) {
  const [items, setItems] = useState<HitlItem[] | null>(null)
  // Email model: one Inbox (open), one Archive (resolved). Unread lives IN the
  // inbox, shown bold — not a separate filter tab.
  const [filter, setFilter] = useState<'inbox' | 'archive'>('inbox')
  const [reading, setReading] = useState<string | null>(null)
  const [resolvingAll, setResolvingAll] = useState(false)

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

  const all = items || []
  const open = all.filter((h) => h.status === 'open')
  const resolved = all.filter((h) => h.status === 'resolved')
  // Unread = open and never seen — the true "still needs you" set. Read-state is
  // independent of resolve (see hitl.ts), so an item can be open-but-read.
  const isUnread = (h: HitlItem) => h.status === 'open' && !h.readAt
  const unread = all.filter(isUnread)
  const shown = filter === 'archive' ? resolved : open

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
  const resolveAll = async () => {
    if (open.length === 0 || resolvingAll) return
    if (!confirm(`Resolve all ${open.length} open Inbox items?`)) return
    setResolvingAll(true)
    try {
      await Promise.all(
        open.map((h) => window.gt.hitl.resolve(h.id, true, h.hostId).catch(() => false)),
      )
      await reload()
    } finally {
      setResolvingAll(false)
    }
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
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
          >
            Mark all read
          </button>
        )}
        {filter === 'inbox' && open.length > 0 && (
          <button
            onClick={resolveAll}
            disabled={resolvingAll}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-green)]/60 hover:text-[var(--gt-green)] disabled:cursor-wait disabled:opacity-60"
          >
            <Check size={12} strokeWidth={2.5} />
            {resolvingAll ? 'Resolving...' : 'Resolve all'}
          </button>
        )}
        {(
          [
            ['inbox', 'Inbox', unread.length],
            ['archive', 'Archive', 0],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${
              filter === key
                ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
            {count > 0 && (
              <span className="rounded-full bg-[var(--gt-accent)]/25 px-1.5 text-[9px] font-bold text-[var(--gt-accent-light)]">
                {count}
              </span>
            )}
          </button>
        ))}
        {onClose && (
          <button
            onClick={onClose}
            title="Close Inbox"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items === null ? (
          <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-3 text-[12px] text-zinc-600">
            {filter === 'archive'
              ? 'Nothing archived yet.'
              : 'Inbox zero. Human-needs (decisions, approvals, creds, failed cron runs) land here from any repo.'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {shown.map((h) => {
              const isOpen = reading === h.id
              const canViewTerminal = hasOpenTerminal(h, openTerminals)
              const body = [h.action, h.detail].filter(Boolean).join('\n\n')
              return (
                <div
                  key={h.id}
                  className={`overflow-hidden rounded-lg border bg-[var(--gt-panel)] ${
                    isOpen
                      ? 'border-[var(--gt-accent)]/40'
                      : h.status === 'open'
                        ? 'border-[var(--gt-border)]'
                        : 'border-[var(--gt-border)] opacity-70'
                  }`}
                >
                  {/* Subject row — click to read (like opening an email). */}
                  <button
                    onClick={() => {
                      setReading(isOpen ? null : h.id)
                      if (isUnread(h)) markRead([h.id])
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${isUnread(h) ? 'bg-[var(--gt-accent)]' : ''}`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-[12.5px] ${isUnread(h) ? 'font-semibold text-zinc-100' : 'font-medium text-zinc-300'}`}
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
                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {reltime(h.createdAt)}
                    </span>
                    {isOpen ? (
                      <ChevronDown size={13} className="shrink-0 text-zinc-600" />
                    ) : (
                      <ChevronRight size={13} className="shrink-0 text-zinc-600" />
                    )}
                  </button>
                  {/* Body — full content rendered as markdown + actions. */}
                  {isOpen && (
                    <div className="border-t border-[var(--gt-border)] px-3 py-2.5">
                      {(h.repo || h.terminalCwd || h.repoRoot) && (
                        <div className="mb-1.5 truncate font-mono text-[10px] text-zinc-600">
                          {h.repo}
                          {(h.terminalCwd || h.repoRoot) && ` · ${h.terminalCwd || h.repoRoot}`}
                        </div>
                      )}
                      {body ? (
                        <div className="max-h-80 overflow-y-auto">
                          <Markdown className="text-[12px] text-zinc-300">{body}</Markdown>
                        </div>
                      ) : (
                        <div className="text-[11.5px] italic text-zinc-600">No details.</div>
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
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
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                          >
                            <SquareTerminal size={11} strokeWidth={2} />
                            Terminal
                          </button>
                        )}
                        {h.runId && (
                          <button
                            onClick={() => navigateTo('runs', { runId: h.runId })}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                          >
                            <ListChecks size={11} strokeWidth={2} />
                            Run
                          </button>
                        )}
                        {h.ticketPath && (
                          <button
                            onClick={() =>
                              navigateTo('tickets', { slug: ticketSlugFromPath(h.ticketPath!) })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                          >
                            <Ticket size={11} strokeWidth={2} />
                            Ticket
                          </button>
                        )}
                        <div className="flex-1" />
                        {h.status === 'open' ? (
                          <button
                            onClick={async () => {
                              await window.gt.hitl.resolve(h.id, true, h.hostId)
                              reload()
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-green)]/60 hover:text-[var(--gt-green)]"
                          >
                            <Check size={12} strokeWidth={2.5} />
                            Resolve
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              await window.gt.hitl.resolve(h.id, false, h.hostId)
                              reload()
                            }}
                            title="Reopen"
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                          >
                            <RotateCcw size={11} strokeWidth={2} />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this Inbox item permanently?')) return
                            await window.gt.hitl.remove(h.id, h.hostId)
                            reload()
                          }}
                          title="Remove"
                          className="inline-flex items-center justify-center rounded-md border border-[var(--gt-border)] px-1.5 py-1 text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                        >
                          <Trash2 size={11} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
