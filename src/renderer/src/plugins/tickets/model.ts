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
  /** Everything non-active (closed, icebox, …), collapsed to a single count row. */
  closed: number
  /** in-progress count (the numerator of "N/M active"). */
  active: number
  /** Active-status count (the denominator of "N/M active"). */
  total: number
}

// Allowlist, not blocklist: only active work renders as rows, so any other
// status a provider or stray frontmatter invents collapses into the count
// instead of cluttering the widget.
const ACTIVE = new Set(['open', 'in-progress', 'stuck'])
const rank = (s: string): number => (s === 'in-progress' ? 0 : s === 'stuck' ? 1 : 2)

export const PAGE_SIZE = 8

/**
 * `pagesShown` drives the see-more pagination: the widget starts at 1 page
 * (PAGE_SIZE rows) and each "+N more" click reveals one more page; "show less"
 * collapses back to 1.
 */
export function ticketsView(tickets: Ticket[], pagesShown = 1, pageSize = PAGE_SIZE): TicketsView {
  const listed = tickets.filter((t) => ACTIVE.has(t.status))
  const rows = [...listed]
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((t) => ({
      slug: t.slug,
      key: t.externalKey || String(t.id).padStart(4, '0'),
      title: t.title,
      status: t.status,
    }))
  const cap = Math.max(1, pagesShown) * pageSize
  return {
    rows: rows.slice(0, cap),
    overflow: Math.max(0, rows.length - cap),
    closed: tickets.length - listed.length,
    active: listed.filter((t) => t.status === 'in-progress').length,
    total: listed.length,
  }
}
