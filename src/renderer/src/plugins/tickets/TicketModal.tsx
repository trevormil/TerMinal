import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, X } from 'lucide-react'
import { TicketDetail } from '../../components/TicketDetail'
import { useWebSurface } from '../../tabs/browser/webSurface'
import { navigateTo } from '../../lib/nav'
import type { Mr, Persona, TabContext, Ticket } from '../../lib/types'

// Deep-link into the Tickets tab (replay once — the receiver mounts after the
// tab switches; mirrors the tdd/mr-summary widgets).
const openInTicketsTab = (slug: string) => {
  navigateTo('tickets', { slug })
  setTimeout(() => navigateTo('tickets', { slug }), 50)
}

// Linear tickets deep-link the tab's embedded Linear view instead — in linear
// mode the tab is webview-first and a slug has nothing to select.
const openInTicketsTabView = (url: string) => {
  navigateTo('tickets', { viewUrl: url })
  setTimeout(() => navigateTo('tickets', { viewUrl: url }), 50)
}

/** Linear's own issue page, embedded. Shares the `persist:browser` session with
 *  the Browser tab and the Tickets tab's Linear view, so the sign-in carries
 *  over instead of being asked for per modal. */
function LinearIssueSurface({ url }: { url: string }) {
  const surface = useWebSurface({ initialUrl: url, partition: 'persist:browser' })
  return <div ref={surface.hostRef} className="min-h-0 min-w-0 flex-1" />
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

  // Linear tickets get Linear's own UI, near-fullscreen — no custom md-style
  // view. Everything else keeps the shared TicketDetail modal.
  const linearUrl = ticket?.provider === 'linear' ? ticket.url || '' : ''

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className={`flex flex-col overflow-hidden rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-bg)] ${
          linearUrl ? 'h-[94vh] w-[96vw]' : 'max-h-[86vh] w-[760px] max-w-[92vw]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--gt-border)] px-4 py-2">
          <span className="font-mono text-[11px] text-zinc-500">
            {ticket ? ticket.externalKey || `#${ticket.id}` : curSlug}
            {ticket?.linear ? ` · ${ticket.linear.stateName}` : ''}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (linearUrl) openInTicketsTabView(linearUrl)
                else openInTicketsTab(curSlug)
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
        {/* TicketDetail owns its own scrolling (pinned header + tab strip), so
            this only bounds the height. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {ticket === undefined ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : ticket === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Ticket not found.</div>
          ) : linearUrl ? (
            <LinearIssueSurface url={linearUrl} />
          ) : (
            <TicketDetail
              ticket={ticket}
              allTickets={allTickets}
              agentContexts={agentContexts}
              mrByIid={mrByIid}
              forgeLabel={tabCtx?.forgeLabel || 'PR'}
              forgeSym={tabCtx?.forgeSym || '#'}
              repoRoot={tabCtx?.repoRoot || ''}
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
