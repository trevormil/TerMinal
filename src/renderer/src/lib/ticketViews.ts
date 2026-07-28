import type { Ticket } from './types'

// Filtering, grouping, and sorting for the Tickets tab. Pure and separate from
// the component so a saved view is just data — the same spec drives the live
// toolbar and anything persisted in `.TerMinal/tickets.json`.

export type TicketGroupBy = 'status' | 'priority' | 'type' | 'horizon' | 'agent' | 'none'
export type TicketSortBy = 'id-desc' | 'id-asc' | 'updated-desc' | 'priority'

export type TicketViewSpec = {
  /** 'all' means no constraint on that axis. */
  type: string
  horizon: string
  priority: string
  status: string
  hitl: boolean
  /** Free text over title, id, and body. */
  q: string
  groupBy: TicketGroupBy
  sortBy: TicketSortBy
}

/** A named TicketViewSpec, persisted per repo. Distinct from `TicketView`,
 *  which is an embedded webview of an external platform. */
export type SavedTicketView = TicketViewSpec & { name: string }

export const DEFAULT_TICKET_VIEW: TicketViewSpec = {
  type: 'all',
  horizon: 'all',
  priority: 'all',
  status: 'all',
  hitl: false,
  q: '',
  groupBy: 'status',
  sortBy: 'id-desc',
}

export function activeTicketFilterCount(view: TicketViewSpec): number {
  return [
    view.type !== DEFAULT_TICKET_VIEW.type,
    view.horizon !== DEFAULT_TICKET_VIEW.horizon,
    view.priority !== DEFAULT_TICKET_VIEW.priority,
    view.status !== DEFAULT_TICKET_VIEW.status,
    view.hitl !== DEFAULT_TICKET_VIEW.hitl,
  ].filter(Boolean).length
}

export function ticketFilterRailStorageKey(repoRoot: string): string {
  return `gt.tickets.filterRail.${repoRoot}`
}

// Active work first; finished states sink. Anything unrecognized sorts last
// rather than disappearing.
const STATUS_ORDER = ['open', 'in-progress', 'stuck', 'closed', 'icebox']
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const rank = (order: string[], v: string) => {
  const i = order.indexOf(v)
  return i < 0 ? order.length : i
}

export function filterTickets(tickets: Ticket[], view: TicketViewSpec): Ticket[] {
  const q = view.q.trim().toLowerCase()
  return tickets.filter((t) => {
    if (view.type !== 'all' && t.type !== view.type) return false
    if (view.horizon !== 'all' && t.horizon !== view.horizon) return false
    if (view.priority !== 'all' && t.priority !== view.priority) return false
    if (view.status !== 'all' && t.status !== view.status) return false
    if (view.hitl && !t.hitl) return false
    if (!q) return true
    return (
      t.title.toLowerCase().includes(q) ||
      String(t.id).includes(q) ||
      (t.body || '').toLowerCase().includes(q)
    )
  })
}

function groupKey(t: Ticket, by: TicketGroupBy): string {
  switch (by) {
    case 'status':
      return t.status
    case 'priority':
      return t.priority
    case 'type':
      return t.type
    case 'horizon':
      return t.horizon
    case 'agent':
      return t.agent?.id || 'unassigned'
    default:
      return 'all'
  }
}

function compare(a: Ticket, b: Ticket, by: TicketSortBy): number {
  switch (by) {
    case 'id-asc':
      return a.id - b.id
    case 'updated-desc':
      return (b.updated || '').localeCompare(a.updated || '')
    case 'priority':
      return rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority) || b.id - a.id
    default:
      return b.id - a.id
  }
}

export function groupTickets(
  tickets: Ticket[],
  view: TicketViewSpec,
): { key: string; items: Ticket[] }[] {
  const groups = new Map<string, Ticket[]>()
  for (const t of tickets) {
    const key = groupKey(t, view.groupBy)
    const bucket = groups.get(key)
    if (bucket) bucket.push(t)
    else groups.set(key, [t])
  }
  // Status and priority have a meaningful order; everything else is alphabetical
  // so the group list is at least stable between renders.
  const order =
    view.groupBy === 'status' ? STATUS_ORDER : view.groupBy === 'priority' ? PRIORITY_ORDER : null
  return [...groups.entries()]
    .sort(([a], [b]) => (order ? rank(order, a) - rank(order, b) : a.localeCompare(b)))
    .map(([key, items]) => ({ key, items: [...items].sort((x, y) => compare(x, y, view.sortBy)) }))
}

/** Whether a saved view describes exactly the spec currently in effect — used
 *  to show which saved view (if any) the toolbar is sitting on. */
export function matchesView(saved: SavedTicketView, spec: TicketViewSpec): boolean {
  const { name: _name, ...rest } = saved
  return (Object.keys(rest) as (keyof TicketViewSpec)[]).every((k) => rest[k] === spec[k])
}
