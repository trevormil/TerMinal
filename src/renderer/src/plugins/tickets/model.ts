import type { Ticket } from '../../lib/types'

// Pure list → view-model transform for the Tickets cockpit widget. Kept out of
// the component so sorting/grouping/collapse/count rules are unit-testable.

export type TicketRow = {
  slug: string
  /** Zero-padded local id, or the provider's externalKey (e.g. "#123", "ENG-42"). */
  key: string
  title: string
  status: string
}

export type TicketsView = {
  rows: TicketRow[]
  /** Rows beyond the visible cap ("+N more"). */
  overflow: number
  /** closed + icebox, collapsed to a single count row. */
  closed: number
  /** in-progress count (the numerator of "N/M active"). */
  active: number
  /** Non-closed, non-icebox count (the denominator of "N/M active"). */
  total: number
}

const COLLAPSED = new Set(['closed', 'icebox'])
// Unknown statuses rank with 'open' so a provider quirk never hides a ticket.
const rank = (s: string): number => (s === 'in-progress' ? 0 : s === 'stuck' ? 1 : 2)

export function ticketsView(tickets: Ticket[], maxRows = 8): TicketsView {
  const listed = tickets.filter((t) => !COLLAPSED.has(t.status))
  const rows = [...listed]
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((t) => ({
      slug: t.slug,
      key: t.externalKey || String(t.id).padStart(4, '0'),
      title: t.title,
      status: t.status,
    }))
  return {
    rows: rows.slice(0, maxRows),
    overflow: Math.max(0, rows.length - maxRows),
    closed: tickets.length - listed.length,
    active: listed.filter((t) => t.status === 'in-progress').length,
    total: listed.length,
  }
}
