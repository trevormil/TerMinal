import { test, expect, describe } from 'bun:test'
import { activeTicketDetailTab, detailTabCountSuffix, ticketDetailTabs } from './detailTabs'

describe('activeTicketDetailTab', () => {
  test('a ticket opens on its own content, not on lineage or the log', () => {
    expect(activeTicketDetailTab(null, '0012-thing')).toBe('ticket')
  })

  test('switching tabs sticks while you stay on the same ticket', () => {
    const selection = { slug: '0012-thing', tab: 'lineage' as const }
    expect(activeTicketDetailTab(selection, '0012-thing')).toBe('lineage')
  })

  test('every tab is reachable', () => {
    for (const tab of ['ticket', 'lineage', 'log'] as const) {
      expect(activeTicketDetailTab({ slug: '0012-thing', tab }, '0012-thing')).toBe(tab)
    }
  })

  test('selecting a different ticket resets to its content', () => {
    // The bug this prevents: click into Log, click the next ticket in the list,
    // and land on an empty log instead of the body you meant to read.
    const selection = { slug: '0012-thing', tab: 'log' as const }
    expect(activeTicketDetailTab(selection, '0013-other')).toBe('ticket')
  })

  test('coming back to the original ticket does not restore its old tab', () => {
    // Matches the Agents tab, which resets rather than persisting detailTab.
    // A stale selection must not outlive the visit that made it.
    const selection = { slug: '0012-thing', tab: 'log' as const }
    expect(activeTicketDetailTab(selection, '0013-other')).toBe('ticket')
    // ...and the caller re-keys the selection on the ticket it now belongs to,
    // so returning to 0012 is a fresh visit.
    expect(activeTicketDetailTab({ slug: '0013-other', tab: 'ticket' }, '0012-thing')).toBe(
      'ticket',
    )
  })
})

describe('detailTabCountSuffix', () => {
  test('renders the count when there is history to see without switching', () => {
    expect(detailTabCountSuffix(3)).toBe('· 3')
    expect(detailTabCountSuffix(1)).toBe('· 1')
  })

  test('an empty tab is silent rather than showing "· 0"', () => {
    expect(detailTabCountSuffix(0)).toBeNull()
  })

  test('an unknown count is silent, not zero', () => {
    // Lineage counts nothing while its runs are still loading; "· 0" would be
    // a claim the UI cannot make yet.
    expect(detailTabCountSuffix(undefined)).toBeNull()
  })

  test('a negative count never renders', () => {
    expect(detailTabCountSuffix(-1)).toBeNull()
  })
})

describe('ticketDetailTabs', () => {
  test('ticket content leads and carries no count', () => {
    const tabs = ticketDetailTabs({ lineageCount: 2, logCount: 5 })
    expect(tabs.map((t) => t.id)).toEqual(['ticket', 'lineage', 'log'])
    expect(tabs[0].count).toBeUndefined()
  })

  test('lineage and log carry their counts', () => {
    const tabs = ticketDetailTabs({ lineageCount: 2, logCount: 5 })
    expect(tabs.find((t) => t.id === 'lineage')?.count).toBe(2)
    expect(tabs.find((t) => t.id === 'log')?.count).toBe(5)
  })

  test('a brand-new ticket still shows all three tabs, silently', () => {
    // No runs, no PRs, no comments: the tabs are present and suffix-free — an
    // empty ticket must never render an error or a count of zero.
    const tabs = ticketDetailTabs({ lineageCount: 0, logCount: 0 })
    expect(tabs).toHaveLength(3)
    expect(tabs.map((t) => detailTabCountSuffix(t.count))).toEqual([null, null, null])
  })
})
