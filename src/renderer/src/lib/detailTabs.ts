// Pure rules behind the horizontal detail-tab strip (components/DetailTabs.tsx)
// and the Tickets detail specifically. Kept out of the components so the
// selection and counting behaviour is unit-testable without a DOM.

/**
 * The `· N` suffix on a tab label, or nothing at all. A zero count is silence:
 * "· 0" reads as a broken counter, and the tab's own body already says it is
 * empty when you open it.
 */
export function detailTabCountSuffix(count?: number): string | null {
  return typeof count === 'number' && count > 0 ? `· ${count}` : null
}

export type TicketDetailTabId = 'ticket' | 'lineage' | 'log'

/** A tab choice is only valid for the ticket it was made on. */
export type TicketDetailSelection = { slug: string; tab: TicketDetailTabId }

/**
 * Which tab a ticket opens on. Ticket content is the default and a selection is
 * keyed to its ticket, so moving to another ticket always lands back on the
 * body rather than inheriting the tab you happened to leave behind. This is the
 * Agents tab's reset-on-selection-change rule, expressed as a derivation
 * instead of an effect so a new ticket never renders one frame of the old tab.
 */
export function activeTicketDetailTab(
  selection: TicketDetailSelection | null,
  slug: string,
): TicketDetailTabId {
  return selection && selection.slug === slug ? selection.tab : 'ticket'
}

export type TicketDetailTab = { id: TicketDetailTabId; label: string; count?: number }

/**
 * The three tabs, in reading order. Counts are what you can see without
 * switching: how much lineage exists, how long the log is.
 */
export function ticketDetailTabs({
  lineageCount,
  logCount,
}: {
  lineageCount: number
  logCount: number
}): readonly TicketDetailTab[] {
  return [
    { id: 'ticket', label: 'Ticket' },
    { id: 'lineage', label: 'Lineage', count: lineageCount },
    { id: 'log', label: 'Log', count: logCount },
  ]
}
