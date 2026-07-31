import { describe, expect, test } from 'bun:test'
import {
  applyRiskFilters,
  countByTier,
  isListMergeReady,
  listMergeGate,
  sortMrs,
  tierOf,
  type RiskTier,
} from './mrRisk'
import { evaluateMergeGate } from './mergeGate'
import type { Mr, Review } from './types'

const review = (over: Partial<Review> = {}): Review => ({
  number: 1,
  overall: 8,
  verdict: 'approve',
  testStatus: 'pass',
  stale: false,
  commitsBehind: 0,
  riskScore: 2,
  riskTier: 'medium',
  ...over,
})

const mr = (over: Partial<Mr> & { iid: number }): Mr => ({
  title: 't',
  state: 'opened',
  author: 'a',
  webUrl: '',
  sourceBranch: 'b',
  draft: false,
  review: null,
  labels: [],
  workedBy: [],
  ...over,
})

describe('tierOf / countByTier', () => {
  test('a PR with no review counts as unscored, not as low risk', () => {
    expect(tierOf(mr({ iid: 1 }))).toBe('unscored')
  })

  test('counts every tier including the empty ones', () => {
    const counts = countByTier([
      mr({ iid: 1, review: review({ riskTier: 'high' }) }),
      mr({ iid: 2, review: review({ riskTier: 'high' }) }),
      mr({ iid: 3 }),
    ])
    expect(counts).toEqual({ high: 2, medium: 0, low: 0, unscored: 1 })
  })
})

describe('sortMrs', () => {
  const mrs = [
    mr({ iid: 10, review: review({ riskTier: 'low', riskScore: 1 }) }),
    mr({ iid: 11, review: review({ riskTier: 'high', riskScore: 4 }) }),
    mr({ iid: 12 }),
    mr({ iid: 13, review: review({ riskTier: 'high', riskScore: 5 }) }),
    mr({ iid: 14, review: review({ riskTier: 'medium', riskScore: 3 }) }),
  ]

  test('risk sort puts high first and unscored last', () => {
    expect(sortMrs(mrs, 'risk').map((m) => m.iid)).toEqual([13, 11, 14, 10, 12])
  })

  test('within a tier the higher numeric score wins', () => {
    const sorted = sortMrs(mrs, 'risk')
    expect(sorted[0].review?.riskScore).toBe(5)
    expect(sorted[1].review?.riskScore).toBe(4)
  })

  test('number sort is newest-first and ignores risk', () => {
    expect(sortMrs(mrs, 'number').map((m) => m.iid)).toEqual([14, 13, 12, 11, 10])
  })

  test('does not mutate the input array', () => {
    const input = [...mrs]
    sortMrs(input, 'risk')
    expect(input.map((m) => m.iid)).toEqual([10, 11, 12, 13, 14])
  })
})

describe('isListMergeReady', () => {
  test('an approved, green, open PR is ready', () => {
    expect(isListMergeReady(mr({ iid: 1, review: review() }))).toBe(true)
  })

  test('drafts and non-open PRs are never ready', () => {
    expect(isListMergeReady(mr({ iid: 1, review: review(), draft: true }))).toBe(false)
    expect(isListMergeReady(mr({ iid: 1, review: review(), state: 'merged' }))).toBe(false)
  })

  test('an unapproved verdict or a failing suite is not ready', () => {
    expect(isListMergeReady(mr({ iid: 1, review: review({ verdict: 'comment' }) }))).toBe(false)
    expect(isListMergeReady(mr({ iid: 1, review: review({ testStatus: 'fail' }) }))).toBe(false)
  })

  test('an unreviewed PR is not ready', () => {
    expect(isListMergeReady(mr({ iid: 1 }))).toBe(false)
  })
})

describe('applyRiskFilters', () => {
  const mrs = [
    mr({ iid: 1, review: review({ riskTier: 'high' }) }),
    mr({ iid: 2, review: review({ riskTier: 'low', verdict: 'comment' }) }),
    mr({ iid: 3 }),
  ]

  test('an empty tier set means all tiers', () => {
    expect(applyRiskFilters(mrs, { tiers: new Set(), readyOnly: false })).toHaveLength(3)
  })

  test('tier chips narrow to the selected tiers', () => {
    const tiers = new Set<RiskTier>(['high', 'unscored'])
    expect(applyRiskFilters(mrs, { tiers, readyOnly: false }).map((m) => m.iid)).toEqual([1, 3])
  })

  test('ready-only composes with the tier chips', () => {
    expect(applyRiskFilters(mrs, { tiers: new Set(), readyOnly: true }).map((m) => m.iid)).toEqual([
      1,
    ])
    expect(
      applyRiskFilters(mrs, { tiers: new Set<RiskTier>(['low']), readyOnly: true }),
    ).toHaveLength(0)
  })
})

describe('listMergeGate', () => {
  test('a list row can NEVER merge — findings are unverified there', () => {
    // Regression for C2: the list button used `findings: []`, which claims
    // "no findings" and enabled a green Merge on a PR with unresolved
    // criticals. The list must fail closed and send you to the detail view.
    const gate = listMergeGate(mr({ iid: 1, review: review() }))
    expect(gate.allowed).toBe(false)
    expect(gate.blockers.some((b) => b.kind === 'findings')).toBe(true)
  })

  test('it still reports the other axes so the tooltip stays useful', () => {
    const gate = listMergeGate(mr({ iid: 1, review: review({ testStatus: 'fail' }) }))
    expect(gate.blockers.map((b) => b.kind).sort()).toEqual(['findings', 'tests'])
  })

  test('the list and the detail view must never disagree in the unsafe direction', () => {
    // The original bug in one assertion: the SAME PR, with two unresolved
    // criticals, was blocked by the detail view (which loads findings) and
    // green in the list (which does not). The list may be stricter than the
    // detail view; it may never be looser. A lighter confirm dialog does not
    // change that — the gate is what fails closed, not the wording.
    const criticals = [{ severity: 'critical' }, { severity: 'critical' }]
    const row = mr({ iid: 1, review: review() })

    const detail = evaluateMergeGate({ review: row.review ?? null, findings: criticals })
    const list = listMergeGate(row)

    expect(detail.allowed).toBe(false)
    expect(list.allowed).toBe(false)
    // Restated as the invariant, so a future relaxation of either side fails.
    expect(list.allowed && !detail.allowed).toBe(false)
  })

  test('triage readiness stays separate from merge authorisation', () => {
    // isListMergeReady drives the "Merge-ready" chip (which PRs are worth
    // opening); it must NOT be read as permission to merge.
    const ready = mr({ iid: 1, review: review() })
    expect(isListMergeReady(ready)).toBe(true)
    expect(listMergeGate(ready).allowed).toBe(false)
  })
})
