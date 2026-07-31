import type { Mr } from './types'
import { evaluateMergeGate, mergeReadyChip, FINDINGS_UNVERIFIED } from './mergeGate'

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
 * The gate behind a list row's merge-ready badge. The findings axis is always
 * unmet here, because the list has not loaded findings and cannot prove their
 * absence — so a row can never claim the full §8 bar, only "nothing known to be
 * wrong". The detail view, which does load findings, is the only place the
 * badge can go green.
 */
export function listMergeGate(mr: Mr) {
  return evaluateMergeGate({ review: mr.review, findings: FINDINGS_UNVERIFIED })
}

/**
 * The "Merge-ready" filter: hide the PRs the list can already tell are not
 * ready, and keep the ones with nothing known against them.
 *
 * Defined as the badge's own state so the filter and the badge can never
 * disagree — a row the filter keeps is exactly a row whose badge is not red.
 * It is a triage filter ("which PRs are worth opening"), never a statement that
 * the bar is met: everything it keeps still shows an amber badge until someone
 * opens the PR and the findings actually load.
 */
export function isListMergeReady(mr: Mr): boolean {
  if (mr.state !== 'opened' || mr.draft) return false
  return mergeReadyChip(listMergeGate(mr)).state !== 'not-ready'
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
