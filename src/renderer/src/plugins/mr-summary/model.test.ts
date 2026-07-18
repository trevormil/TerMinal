import { test, expect, describe } from 'bun:test'
import { prsView } from './model'
import type { Mr, Review } from '../../lib/types'

let seq = 0
const review = (over: Partial<Review> = {}): Review => ({
  number: 1,
  overall: 88,
  verdict: 'approve',
  testStatus: 'pass',
  stale: false,
  commitsBehind: 0,
  riskScore: 1,
  riskTier: 'low',
  ...over,
})
const mr = (over: Partial<Mr> = {}): Mr => ({
  iid: ++seq,
  title: `PR ${seq}`,
  state: 'opened',
  author: 'trevor',
  webUrl: `https://github.com/x/y/pull/${seq}`,
  sourceBranch: `feat/branch-${seq}`,
  draft: false,
  review: null,
  labels: [],
  workedBy: [],
  ...over,
})

describe('prsView', () => {
  test('empty list → empty view', () => {
    expect(prsView([])).toEqual({ rows: [], overflow: 0, done: 0, open: 0, total: 0 })
  })

  test('only merged + closed → no rows, all collapsed into done count', () => {
    const v = prsView([mr({ state: 'merged' }), mr({ state: 'closed' }), mr({ state: 'merged' })])
    expect(v.rows).toEqual([])
    expect(v.done).toBe(3)
    expect(v.open).toBe(0)
    expect(v.total).toBe(0)
  })

  test('open PRs listed first; merged/closed collapsed; stable within group', () => {
    const v = prsView([
      mr({ iid: 1, state: 'opened' }),
      mr({ iid: 2, state: 'merged' }),
      mr({ iid: 3, state: 'opened' }),
      mr({ iid: 4, state: 'closed' }),
    ])
    expect(v.rows.map((r) => r.iid)).toEqual([1, 3])
    expect(v.open).toBe(2)
    expect(v.total).toBe(2)
    expect(v.done).toBe(2)
  })

  test('unknown state is shown after open rows, not silently dropped', () => {
    const v = prsView([mr({ iid: 9, state: 'locked' }), mr({ iid: 10, state: 'opened' })])
    expect(v.rows.map((r) => r.iid)).toEqual([10, 9])
    expect(v.total).toBe(2)
    expect(v.done).toBe(0)
    expect(v.open).toBe(1)
  })

  test('rows carry iid, title, branch, state, draft for display + navigation', () => {
    const v = prsView([
      mr({ iid: 7, title: 'Add widget', sourceBranch: 'feat/widget', draft: true }),
    ])
    expect(v.rows[0]).toMatchObject({
      iid: 7,
      title: 'Add widget',
      branch: 'feat/widget',
      state: 'opened',
      draft: true,
    })
  })

  test('ci glyph derives from the review testStatus: pass/fail, pending otherwise', () => {
    const v = prsView([
      mr({ iid: 1, review: review({ testStatus: 'pass' }) }),
      mr({ iid: 2, review: review({ testStatus: 'fail' }) }),
      mr({ iid: 3, review: review({ testStatus: 'unknown' }) }),
      mr({ iid: 4, review: null }),
    ])
    expect(v.rows.map((r) => r.ci)).toEqual(['pass', 'fail', 'pending', 'pending'])
  })

  test('verdict + score surface only when a review artifact exists', () => {
    const v = prsView([
      mr({ iid: 1, review: review({ verdict: 'approve', overall: 91 }) }),
      mr({ iid: 2, review: review({ verdict: 'request-changes', overall: 64 }) }),
      mr({ iid: 3, review: null }),
    ])
    expect(v.rows.map((r) => [r.verdict, r.overall])).toEqual([
      ['approve', 91],
      ['request-changes', 64],
      [null, null],
    ])
  })

  test('caps visible rows at one page and reports the overflow', () => {
    const v = prsView(Array.from({ length: 11 }, () => mr()))
    expect(v.rows.length).toBe(8)
    expect(v.overflow).toBe(3)
    expect(v.total).toBe(11)
  })

  test('pagesShown reveals more pages; overflow shrinks accordingly', () => {
    const mrs = Array.from({ length: 20 }, () => mr())
    const v2 = prsView(mrs, 2)
    expect(v2.rows.length).toBe(16)
    expect(v2.overflow).toBe(4)
    const v3 = prsView(mrs, 3)
    expect(v3.rows.length).toBe(20)
    expect(v3.overflow).toBe(0)
  })

  test('overflow never hides open rows when unknown-state rows pad the list', () => {
    const v = prsView([
      ...Array.from({ length: 10 }, () => mr({ state: 'locked' })),
      mr({ state: 'opened' }),
    ])
    expect(v.rows[0].state).toBe('opened')
    expect(v.overflow).toBe(3)
  })
})
