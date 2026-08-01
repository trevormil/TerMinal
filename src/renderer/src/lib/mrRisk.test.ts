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
import { evaluateMergeGate, mergeReadyChip } from './mergeGate'
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
  test('a list row can never read as fully merge-ready — findings are unverified there', () => {
    // Regression for C2: the list evaluated `findings: []`, which claims "no
    // findings", and a PR with unresolved criticals rendered as green.
    const gate = listMergeGate(mr({ iid: 1, review: review() }))
    expect(gate.blockers.some((b) => b.kind === 'findings' && b.unverified)).toBe(true)
    expect(mergeReadyChip(gate).state).toBe('unverified')
  })

  test('a known-failing axis outweighs the unverifiable one', () => {
    const gate = listMergeGate(mr({ iid: 1, review: review({ testStatus: 'fail' }) }))
    expect(gate.blockers.map((b) => b.kind).sort()).toEqual(['findings', 'tests'])
    expect(mergeReadyChip(gate).state).toBe('not-ready')
  })

  test('the list and the detail view must never disagree in the unsafe direction', () => {
    // The original bug in one assertion: the SAME PR, with two unresolved
    // criticals, read as not-ready when findings were loaded and ready in the
    // list (which does not load them). The list may be more cautious than a
    // findings-loaded evaluation; it may never be more confident.
    const criticals = [{ severity: 'critical' }, { severity: 'critical' }]
    const row = mr({ iid: 1, review: review() })

    const detail = mergeReadyChip(evaluateMergeGate({ review: row.review, findings: criticals }))
    const list = mergeReadyChip(listMergeGate(row))

    expect(detail.state).toBe('not-ready')
    expect(list.state).not.toBe('ready')
    // Restated as the invariant, so a future relaxation of either side fails.
    expect(list.state === 'ready' && detail.state !== 'ready').toBe(false)
  })

  test('the filter keeps exactly the rows with no known-failing axis', () => {
    const rows = [
      mr({ iid: 1, review: review() }),
      mr({ iid: 2, review: review({ verdict: 'comment' }) }),
      mr({ iid: 3, review: review({ testStatus: 'fail' }) }),
      mr({ iid: 4 }),
    ]
    for (const row of rows) {
      expect(isListMergeReady(row)).toBe(mergeReadyChip(listMergeGate(row)).state !== 'not-ready')
    }
  })

  test('passing the filter is not a claim that the bar is met', () => {
    // isListMergeReady drives the "Merge-ready" filter (which PRs are worth
    // opening); the row it keeps is still only "nothing known against it".
    const ready = mr({ iid: 1, review: review() })
    expect(isListMergeReady(ready)).toBe(true)
    expect(mergeReadyChip(listMergeGate(ready)).state).toBe('unverified')
  })
})
