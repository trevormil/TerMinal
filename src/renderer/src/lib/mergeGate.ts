import type { Finding, Review } from './types'

// The merge-ready bar from CLAUDE.md §8, made mechanical:
//   review verdict `approve` + tests pass + zero unresolved findings >= medium.
//
// This gate only ADDS friction. It never merges anything, never relaxes the
// human merge gate, and never auto-approves — the worst it can do is make you
// type a reason first.

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const

/**
 * Rank a severity string.
 *
 * An ABSENT severity ranks below `low` — an unlabelled finding is usually a
 * note, and blocking on those would make the gate useless. But an unrecognised
 * NON-EMPTY severity (`blocker`, `sev1`, `P0`) fails CLOSED: a producer that
 * spells severities differently must not be able to slip criticals past a
 * safety gate just because we do not know its vocabulary.
 */
export function severityRank(severity: unknown): number {
  const key = String(severity ?? '')
    .trim()
    .toLowerCase()
  if (!key) return ABSENT
  const i = SEVERITY_ORDER.indexOf(key as (typeof SEVERITY_ORDER)[number])
  return i === -1 ? UNRECOGNISED : i
}

/** Below `low`: no severity was stated at all. */
export const ABSENT = -1
/** Above `critical`: a severity was stated and we do not understand it. */
export const UNRECOGNISED = SEVERITY_ORDER.length

const MEDIUM = SEVERITY_ORDER.indexOf('medium')

/** A finding blocks when it is unresolved and at least medium severity. */
export function isBlockingFinding(finding: Finding): boolean {
  if (String(finding.status ?? '').toLowerCase() === 'resolved') return false
  return severityRank(finding.severity) >= MEDIUM
}

export type MergeBlocker = {
  kind: 'verdict' | 'tests' | 'findings'
  label: string
  detail: string
  count?: number
}

export type MergeGate = {
  allowed: boolean
  blockers: MergeBlocker[]
  /** Non-blocking things the human should still see before merging. */
  warnings: string[]
}

/**
 * Pass as `findings` when the caller has NOT loaded them.
 *
 * `[]` is a claim — "this PR has no findings" — and a list view that never
 * fetches findings cannot make that claim. Conflating the two let a PR with two
 * unresolved criticals render an enabled Merge button. Callers that genuinely
 * know the findings pass the real array; everyone else passes this and the gate
 * fails closed.
 */
export const FINDINGS_UNVERIFIED = Symbol('findings-unverified')

export function evaluateMergeGate({
  review,
  findings,
}: {
  review: Review | null
  findings: Finding[] | typeof FINDINGS_UNVERIFIED
}): MergeGate {
  const blockers: MergeBlocker[] = []
  const warnings: string[] = []

  if (!review || review.verdict !== 'approve') {
    blockers.push({
      kind: 'verdict',
      label: 'Not approved',
      detail: review
        ? `Review verdict is "${review.verdict || 'none'}", not "approve".`
        : 'No code-review artifact for this PR.',
    })
  }

  // "unknown" is not "pass". An unproven suite is a blocker, not a shrug.
  if (!review || review.testStatus !== 'pass') {
    blockers.push({
      kind: 'tests',
      label: 'Tests not passing',
      detail: review
        ? `Test status is "${review.testStatus || 'unknown'}", not "pass".`
        : 'No test result recorded for this PR.',
    })
  }

  if (findings === FINDINGS_UNVERIFIED) {
    blockers.push({
      kind: 'findings',
      // "not checked" read as though the human had forgotten to do something.
      // The truth is that this view never loaded them, so the app cannot say.
      label: 'Findings not loaded — open the PR to verify',
      detail:
        'This view does not load review findings, so the severity axis of the merge bar cannot be evaluated here. Open the PR to see them.',
    })
  } else {
    const blocking = (findings || []).filter(isBlockingFinding)
    if (blocking.length > 0) {
      blockers.push({
        kind: 'findings',
        label: `${blocking.length} finding${blocking.length === 1 ? '' : 's'} ≥ medium`,
        detail: blocking
          .slice(0, 5)
          .map((f) => `${String(f.severity).toLowerCase()}: ${f.title || f.text || 'untitled'}`)
          .join('\n'),
        count: blocking.length,
      })
    }
  }

  if (review?.stale)
    warnings.push(
      `Review artifact is ${review.commitsBehind || 0} commit(s) behind the branch head.`,
    )

  return { allowed: blockers.length === 0, blockers, warnings }
}

/** One-line summary for the override record. */
export function describeBlockers(gate: MergeGate): string {
  return gate.blockers.map((b) => b.label).join('; ')
}

/**
 * The unmet legs as machine-readable kinds, deduped and in bar order.
 *
 * The override record stores these alongside the human wording: labels get
 * reworded (this one already has), so "which merges skipped the findings leg"
 * must not be a string search.
 */
export function blockedLegs(gate: MergeGate): MergeBlocker['kind'][] {
  const order: MergeBlocker['kind'][] = ['verdict', 'tests', 'findings']
  return order.filter((kind) => gate.blockers.some((b) => b.kind === kind))
}
