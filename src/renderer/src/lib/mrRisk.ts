import type { Mr } from './types'
import { evaluateMergeGate, FINDINGS_UNVERIFIED } from './mergeGate'

// `review.ts` computes riskScore/riskTier per PR and `pr-risk-classifier.ts`
// backfills the ambiguous middle, but the list could not act on it. These are
// the pure list operations behind the tier chips and the sort control.

export type RiskTier = 'high' | 'medium' | 'low' | 'unscored'

export const RISK_TIERS: RiskTier[] = ['high', 'medium', 'low', 'unscored']

export function tierOf(mr: Mr): RiskTier {
  return mr.review?.riskTier ?? 'unscored'
}

/** High first — "review the high-risk PRs first" is the whole point. */
export function riskWeight(tier: RiskTier | undefined): number {
  return tier === 'high' ? 0 : tier === 'medium' ? 1 : tier === 'low' ? 2 : 3
}

export function countByTier(mrs: Mr[]): Record<RiskTier, number> {
  const out: Record<RiskTier, number> = { high: 0, medium: 0, low: 0, unscored: 0 }
  for (const m of mrs) out[tierOf(m)]++
  return out
}

/**
 * Merge-readiness as far as the *list* can tell: the verdict and test axes.
 *
 * The list's `Mr` carries a review but NOT its findings, so this is a triage
 * filter ("which PRs are worth opening"), never a merge authorisation. The
 * merge button uses `listMergeGate` below, which fails closed on the findings
 * axis, so a PR can look ready here and still be blocked on open.
 */
export function isListMergeReady(mr: Mr): boolean {
  if (mr.state !== 'opened' || mr.draft) return false
  return evaluateMergeGate({ review: mr.review, findings: FINDINGS_UNVERIFIED }).blockers.every(
    (b) => b.kind === 'findings',
  )
}

/**
 * The gate a list row's merge button must use. Always blocked on the findings
 * axis, because the list has not loaded findings and cannot prove their
 * absence — merging from here would bypass the severity gate entirely.
 */
export function listMergeGate(mr: Mr) {
  return evaluateMergeGate({ review: mr.review, findings: FINDINGS_UNVERIFIED })
}

export type MrSort = 'risk' | 'number'

export function sortMrs(mrs: Mr[], sort: MrSort): Mr[] {
  const next = [...mrs]
  if (sort === 'number') return next.sort((a, b) => b.iid - a.iid)
  return next.sort(
    (a, b) =>
      riskWeight(tierOf(a)) - riskWeight(tierOf(b)) ||
      (b.review?.riskScore ?? -1) - (a.review?.riskScore ?? -1) ||
      b.iid - a.iid,
  )
}

/** Apply the tier chips and the ready-only chip. An empty tier set means "all". */
export function applyRiskFilters(
  mrs: Mr[],
  { tiers, readyOnly }: { tiers: Set<RiskTier>; readyOnly: boolean },
): Mr[] {
  return mrs.filter(
    (m) => (tiers.size === 0 || tiers.has(tierOf(m))) && (!readyOnly || isListMergeReady(m)),
  )
}
