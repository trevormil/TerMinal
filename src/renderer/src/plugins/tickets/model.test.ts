import { test, expect, describe } from 'bun:test'
import { ticketsView } from './model'
import type { Ticket } from '../../lib/types'

let seq = 0
const t = (over: Partial<Ticket>): Ticket =>
  ({
    slug: `${String(++seq).padStart(4, '0')}-test`,
    id: seq,
    title: `Ticket ${seq}`,
    status: 'open',
    priority: 'medium',
    horizon: 'now',
    hitl: false,
    type: 'feature',
    source: 'test',
    created: '',
    updated: '',
    prs: [],
    refs: [],
    depends_on: [],
    acceptance: [],
    modelTier: 'auto',
    workedBy: [],
    agent: { id: 'main', scope: 'repo' as const, kind: 'classic' as const },
    body: '',
    ...over,
  }) as Ticket

describe('ticketsView', () => {
  test('empty list → empty view', () => {
    expect(ticketsView([])).toEqual({ rows: [], overflow: 0, closed: 0, active: 0, total: 0 })
  })

  test('only closed + icebox → no rows, all collapsed into closed count', () => {
    const v = ticketsView([
      t({ status: 'closed' }),
      t({ status: 'icebox' }),
      t({ status: 'closed' }),
    ])
    expect(v.rows).toEqual([])
    expect(v.closed).toBe(3)
    expect(v.active).toBe(0)
    expect(v.total).toBe(0)
  })

  test('mixed statuses → in-progress first, then stuck, then open; stable within group', () => {
    const v = ticketsView([
      t({ id: 1, status: 'open' }),
      t({ id: 2, status: 'stuck' }),
      t({ id: 3, status: 'in-progress' }),
      t({ id: 4, status: 'open' }),
      t({ id: 5, status: 'closed' }),
      t({ id: 6, status: 'in-progress' }),
    ])
    expect(v.rows.map((r) => [r.status, r.key])).toEqual([
      ['in-progress', '0003'],
      ['in-progress', '0006'],
      ['stuck', '0002'],
      ['open', '0001'],
      ['open', '0004'],
    ])
    expect(v.active).toBe(2) // in-progress
    expect(v.total).toBe(5) // non-closed, non-icebox
    expect(v.closed).toBe(1)
  })

  test('key is the zero-padded id, or externalKey when present', () => {
    const v = ticketsView([
      t({ id: 7, status: 'open', externalKey: undefined }),
      t({ id: 123, status: 'open', externalKey: '#123' }),
      t({ id: 9, status: 'open', externalKey: 'ENG-42' }),
    ])
    expect(v.rows.map((r) => r.key)).toEqual(['0007', '#123', 'ENG-42'])
  })

  test('rows carry slug and title for navigation + display', () => {
    const v = ticketsView([t({ slug: '0001-fix-map', title: 'Fix map', status: 'in-progress' })])
    expect(v.rows[0]).toMatchObject({ slug: '0001-fix-map', title: 'Fix map' })
  })

  test('caps visible rows and reports the overflow', () => {
    const v = ticketsView(Array.from({ length: 11 }, () => t({ status: 'open' })))
    expect(v.rows.length).toBe(8)
    expect(v.overflow).toBe(3)
    expect(v.total).toBe(11)
  })

  test('overflow never hides in-progress rows (they sort first)', () => {
    const v = ticketsView([
      ...Array.from({ length: 10 }, () => t({ status: 'open' })),
      t({ status: 'in-progress' }),
    ])
    expect(v.rows[0].status).toBe('in-progress')
    expect(v.overflow).toBe(3)
  })

  test('page 1 is the default: one page of rows, rest reported as overflow', () => {
    const v = ticketsView(
      Array.from({ length: 20 }, () => t({ status: 'open' })),
      1,
    )
    expect(v.rows.length).toBe(8)
    expect(v.overflow).toBe(12)
  })

  test('mid page: each extra page reveals pageSize more rows', () => {
    const v = ticketsView(
      Array.from({ length: 20 }, () => t({ status: 'open' })),
      2,
    )
    expect(v.rows.length).toBe(16)
    expect(v.overflow).toBe(4)
    expect(v.total).toBe(20)
  })

  test('last partial page: shows everything, overflow reaches zero', () => {
    const v = ticketsView(
      Array.from({ length: 11 }, () => t({ status: 'open' })),
      2,
    )
    expect(v.rows.length).toBe(11)
    expect(v.overflow).toBe(0)
  })

  test('pages beyond the list clamp to all rows without going negative', () => {
    const v = ticketsView(
      Array.from({ length: 5 }, () => t({ status: 'open' })),
      7,
    )
    expect(v.rows.length).toBe(5)
    expect(v.overflow).toBe(0)
  })

  test('collapse back to page 1 restores the original cap and overflow', () => {
    const list = Array.from({ length: 11 }, () => t({ status: 'open' }))
    const expanded = ticketsView(list, 2)
    expect(expanded.rows.length).toBe(11)
    const collapsed = ticketsView(list, 1)
    expect(collapsed.rows.length).toBe(8)
    expect(collapsed.overflow).toBe(3)
  })

  test('expanded pages keep the status ordering (in-progress still first)', () => {
    const v = ticketsView(
      [...Array.from({ length: 9 }, () => t({ status: 'open' })), t({ status: 'in-progress' })],
      2,
    )
    expect(v.rows.length).toBe(10)
    expect(v.rows[0].status).toBe('in-progress')
  })

  test('unknown status is shown with the open group, not silently dropped', () => {
    const v = ticketsView([t({ status: 'weird' }), t({ status: 'in-progress' })])
    expect(v.rows.map((r) => r.status)).toEqual(['in-progress', 'weird'])
    expect(v.total).toBe(2)
    expect(v.closed).toBe(0)
  })
})
