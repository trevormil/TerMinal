import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, X } from 'lucide-react'
import { TicketDetail } from '../../components/TicketDetail'
import { navigateTo } from '../../lib/nav'
import type { Mr, Persona, TabContext, Ticket } from '../../lib/types'

// Deep-link into the Tickets tab (replay once — the receiver mounts after the
// tab switches; mirrors the tdd/mr-summary widgets).
const openInTicketsTab = (slug: string) => {
  navigateTo('tickets', { slug })
  setTimeout(() => navigateTo('tickets', { slug }), 50)
}

/**
 * In-place drill-in for the Tickets cockpit widget: the same formatted detail
 * as the Tickets tab's right-hand pane (via the shared TicketDetail), rendered
 * as a modal over the session view. Portaled to document.body so it escapes
 * the drawer's stacking context. PR links open externally here (no in-app MR
 * view outside the tab); "Open in Tickets tab" is the full-flow escape hatch.
 */
export function TicketModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [curSlug, setCurSlug] = useState(slug)
  // undefined = loading, null = not found.
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined)
  const [allTickets, setAllTickets] = useState<Ticket[] | null>(null)
  const [agentContexts, setAgentContexts] = useState<Persona[]>([])
  const [mrByIid, setMrByIid] = useState<Map<number, Mr>>(() => new Map())
  const [tabCtx, setTabCtx] = useState<TabContext | null>(null)

  // The widget's poll already has list records, but re-fetch fresh on open —
  // get() re-reads the single ticket and the list backfills depends_on lookups
  // (and doubles as a fallback if get() has nothing for this provider).
  const load = () => {
    Promise.all([
      window.gt.tickets.get(curSlug).catch(() => null),
      window.gt.tickets.list().catch(() => null),
    ]).then(([fresh, list]) => {
      setAllTickets(list)
      setTicket(fresh || list?.find((t) => t.slug === curSlug) || null)
    })
  }
  useEffect(load, [curSlug])
  useEffect(() => {
    window.gt.agents
      .personas()
      .then(setAgentContexts)
      .catch(() => setAgentContexts([]))
    // Enrich PR links with live state/verdict badges, same as the tab.
    window.gt
      .listMrs()
      .then((r) => setMrByIid(new Map((r.mrs || []).map((m) => [m.iid, m]))))
      .catch(() => setMrByIid(new Map()))
    window.gt
      .tabContext()
      .then(setTabCtx)
      .catch(() => setTabCtx(null))
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-bg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--gt-border)] px-4 py-2">
          <span className="font-mono text-[11px] text-zinc-500">
            {ticket ? ticket.externalKey || `#${ticket.id}` : curSlug}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                openInTicketsTab(curSlug)
                onClose()
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
            >
              <ArrowUpRight size={11} strokeWidth={2} />
              Open in Tickets tab
            </button>
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {ticket === undefined ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : ticket === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Ticket not found.</div>
          ) : (
            <TicketDetail
              ticket={ticket}
              allTickets={allTickets}
              agentContexts={agentContexts}
              mrByIid={mrByIid}
              forgeLabel={tabCtx?.forgeLabel || 'PR'}
              forgeSym={tabCtx?.forgeSym || '#'}
              onChanged={load}
              onSelectTicket={setCurSlug}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
