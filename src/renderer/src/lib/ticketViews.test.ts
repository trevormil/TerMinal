import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_TICKET_VIEW,
  activeTicketFilterCount,
  filterTickets,
  groupTickets,
  matchesView,
  ticketFilterRailStorageKey,
  type TicketViewSpec,
} from './ticketViews'
import type { Ticket } from './types'

const t = (over: Partial<Ticket>): Ticket =>
  ({
    slug: `000${over.id}-x`,
    id: 1,
    title: 'Some ticket',
    status: 'open',
    priority: 'medium',
    horizon: 'now',
    hitl: false,
    type: 'feature',
    updated: '2026-07-01',
    body: '',
    depends_on: [],
    prs: [],
    acceptance: [],
    workedBy: [],
    agent: { id: 'docs', scope: 'global', kind: 'classic' },
    ...over,
  }) as Ticket

const view = (over: Partial<TicketViewSpec> = {}): TicketViewSpec => ({
  ...DEFAULT_TICKET_VIEW,
  ...over,
})

describe('filterTickets', () => {
  const tickets = [
    t({ id: 1, title: 'Rate limit join', type: 'feature', priority: 'high', body: 'uses redis' }),
    t({
      id: 2,
      title: 'Fix crash',
      type: 'bug',
      priority: 'critical',
      horizon: 'next',
      hitl: true,
    }),
    t({ id: 3, title: 'Write docs', type: 'docs', priority: 'low', status: 'closed' }),
  ]

  test('the default view filters nothing out', () => {
    expect(filterTickets(tickets, view()).length).toBe(3)
  })

  test('filters by type, priority, horizon, status, and hitl', () => {
    expect(filterTickets(tickets, view({ type: 'bug' })).map((x) => x.id)).toEqual([2])
    expect(filterTickets(tickets, view({ priority: 'low' })).map((x) => x.id)).toEqual([3])
    expect(filterTickets(tickets, view({ horizon: 'next' })).map((x) => x.id)).toEqual([2])
    expect(filterTickets(tickets, view({ status: 'closed' })).map((x) => x.id)).toEqual([3])
    expect(filterTickets(tickets, view({ hitl: true })).map((x) => x.id)).toEqual([2])
  })

  test('filters combine as AND, not OR', () => {
    expect(filterTickets(tickets, view({ type: 'bug', priority: 'low' })).length).toBe(0)
  })

  // The old search only looked at title and id, so a ticket you remembered by
  // a phrase in its body was unfindable.
  test('search matches title, id, and body', () => {
    expect(filterTickets(tickets, view({ q: 'rate limit' })).map((x) => x.id)).toEqual([1])
    expect(filterTickets(tickets, view({ q: '2' })).map((x) => x.id)).toEqual([2])
    expect(filterTickets(tickets, view({ q: 'redis' })).map((x) => x.id)).toEqual([1])
  })

  test('search is case-insensitive and ignores surrounding whitespace', () => {
    expect(filterTickets(tickets, view({ q: '  REDIS ' })).map((x) => x.id)).toEqual([1])
  })

  test('a search matching nothing yields an empty list, not everything', () => {
    expect(filterTickets(tickets, view({ q: 'nonexistent' }))).toEqual([])
  })
})

describe('groupTickets', () => {
  const tickets = [
    t({ id: 1, status: 'open', priority: 'low', type: 'bug', updated: '2026-07-03' }),
    t({ id: 2, status: 'closed', priority: 'critical', type: 'bug', updated: '2026-07-01' }),
    t({ id: 3, status: 'open', priority: 'high', type: 'docs', updated: '2026-07-02' }),
  ]

  test('groups by status with active statuses before finished ones', () => {
    const groups = groupTickets(tickets, view({ groupBy: 'status' }))
    expect(groups.map((g) => g.key)).toEqual(['open', 'closed'])
    expect(groups[0].items.map((x) => x.id)).toEqual([3, 1])
  })

  test('groups by priority in severity order, not alphabetical', () => {
    const groups = groupTickets(tickets, view({ groupBy: 'priority' }))
    expect(groups.map((g) => g.key)).toEqual(['critical', 'high', 'low'])
  })

  test('groups by type and by owner agent', () => {
    expect(
      groupTickets(tickets, view({ groupBy: 'type' }))
        .map((g) => g.key)
        .sort(),
    ).toEqual(['bug', 'docs'])
    expect(groupTickets(tickets, view({ groupBy: 'agent' })).map((g) => g.key)).toEqual(['docs'])
  })

  test('groupBy none returns a single group holding everything', () => {
    const groups = groupTickets(tickets, view({ groupBy: 'none' }))
    expect(groups.length).toBe(1)
    expect(groups[0].items.length).toBe(3)
  })

  test('sorts newest id first by default and honours the other orders', () => {
    const ids = (v: Partial<TicketViewSpec>) =>
      groupTickets(tickets, view({ groupBy: 'none', ...v }))[0].items.map((x) => x.id)
    expect(ids({})).toEqual([3, 2, 1])
    expect(ids({ sortBy: 'id-asc' })).toEqual([1, 2, 3])
    expect(ids({ sortBy: 'updated-desc' })).toEqual([1, 3, 2])
    expect(ids({ sortBy: 'priority' })).toEqual([2, 3, 1])
  })

  test('every ticket lands in exactly one group', () => {
    for (const groupBy of ['status', 'priority', 'type', 'horizon', 'agent'] as const) {
      const groups = groupTickets(tickets, view({ groupBy }))
      expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(tickets.length)
    }
  })

  test('an empty list produces no groups', () => {
    expect(groupTickets([], view())).toEqual([])
  })
})

describe('matchesView', () => {
  const saved = (over: Partial<TicketViewSpec> = {}) => ({
    name: 'Bugs',
    ...DEFAULT_TICKET_VIEW,
    ...over,
  })

  test('a saved view matches the spec it was saved from, ignoring its name', () => {
    expect(matchesView(saved({ type: 'bug' }), view({ type: 'bug' }))).toBe(true)
  })

  test('any differing axis means no match, so the picker does not lie', () => {
    expect(matchesView(saved({ type: 'bug' }), view({ type: 'docs' }))).toBe(false)
    expect(matchesView(saved({ groupBy: 'priority' }), view({ groupBy: 'status' }))).toBe(false)
    expect(matchesView(saved({ sortBy: 'id-asc' }), view({ sortBy: 'id-desc' }))).toBe(false)
    expect(matchesView(saved({ hitl: true }), view({ hitl: false }))).toBe(false)
    expect(matchesView(saved({ q: 'redis' }), view({ q: '' }))).toBe(false)
  })
})

describe('activeTicketFilterCount', () => {
  test('the default view has no hidden rail filters active', () => {
    expect(activeTicketFilterCount(view())).toBe(0)
  })

  test('counts only rail filters, not search or display controls', () => {
    expect(
      activeTicketFilterCount(
        view({
          type: 'bug',
          horizon: 'next',
          priority: 'critical',
          status: 'open',
          hitl: true,
          q: 'visible search',
          groupBy: 'priority',
          sortBy: 'updated-desc',
        }),
      ),
    ).toBe(5)
  })

  test('saved views update the collapsed badge count from the applied spec', () => {
    const saved = {
      name: 'Critical bugs',
      ...DEFAULT_TICKET_VIEW,
      type: 'bug',
      priority: 'critical',
    }
    const { name: _name, ...spec } = saved

    expect(matchesView(saved, spec)).toBe(true)
    expect(activeTicketFilterCount(spec)).toBe(2)
  })
})

describe('ticketFilterRailStorageKey', () => {
  test('is a gt-prefixed repo-scoped key', () => {
    expect(ticketFilterRailStorageKey('/repo/a')).toBe('gt.tickets.filterRail./repo/a')
    expect(ticketFilterRailStorageKey('/repo/b')).toBe('gt.tickets.filterRail./repo/b')
  })
})
