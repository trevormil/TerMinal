import type { Finding, Review } from './types'

// The merge-ready bar from CLAUDE.md §8, made mechanical:
//   review verdict `approve` + tests pass + zero unresolved findings >= medium.
//
// The bar is unchanged and still applies — the human applies it. This module is
// pure computation behind an INFORMATIONAL chip and a list filter: it reports
// what it can prove about a PR's readiness and never blocks, prompts, or
// intercepts a merge. Because the chip is now the signal a human acts on, it
// must never overstate: anything it could not verify reads as "not ready".

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
  /** Chip-sized restatement of `label`, for the one-line row summary. */
  short: string
  detail: string
  count?: number
  /**
   * True only for the findings axis when the caller never loaded findings.
   * Distinguishes "we know there are blocking findings" from "we cannot say" —
   * the chip has to word those differently, and both are still "not ready".
   */
  unverified?: true
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
 * unresolved criticals read as merge-ready. Callers that genuinely know the
 * findings pass the real array; everyone else passes this and the gate fails
 * closed.
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
      short: 'unapproved',
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
      short: 'tests failing',
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
      short: 'findings not loaded',
      detail:
        'This view does not load review findings, so the severity axis of the merge bar cannot be evaluated here. Open the PR to see them.',
      unverified: true,
    })
  } else {
    const blocking = (findings || []).filter(isBlockingFinding)
    if (blocking.length > 0) {
      blockers.push({
        kind: 'findings',
        label: `${blocking.length} finding${blocking.length === 1 ? '' : 's'} ≥ medium`,
        short: `${blocking.length} finding${blocking.length === 1 ? '' : 's'} ≥ medium`,
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

/**
 * `ready`      — every axis of the bar was checked and met.
 * `unverified` — nothing is known to fail, but an axis could not be checked.
 * `not-ready`  — at least one axis is known to fail.
 *
 * `unverified` exists so the chip never has to round "we could not check" to
 * one of the other two. Rounding it up to `ready` is the failure that matters:
 * a chip claiming a PR is mergeable when its findings simply never loaded
 * misinforms the human who is applying the §8 bar.
 */
export type MergeReadyState = 'ready' | 'unverified' | 'not-ready'

export type MergeReadyChip = {
  state: MergeReadyState
  /** Chip text, short enough for a list row. */
  label: string
  /** Full wording for the tooltip: every unmet axis, one per line. */
  title: string
}

/** The informational chip for a gate. Never authorises anything. */
export function mergeReadyChip(gate: MergeGate): MergeReadyChip {
  if (gate.blockers.length === 0)
    return {
      state: 'ready',
      label: 'Merge-ready',
      title: ['Meets the merge bar: approved, tests pass, no findings ≥ medium.', ...gate.warnings]
        .join('\n')
        .trim(),
    }

  const title = [...gate.blockers.map((b) => `${b.label}\n${b.detail}`), ...gate.warnings].join(
    '\n\n',
  )

  // Only unverifiable axes: say so plainly rather than implying a failure.
  if (gate.blockers.every((b) => b.unverified))
    return { state: 'unverified', label: 'Findings not loaded', title }

  // Known failures lead; an unverified axis is a trailing caveat, not a reason.
  const reasons = gate.blockers.filter((b) => !b.unverified).map((b) => b.short)
  return { state: 'not-ready', label: `Not ready · ${reasons.join(' · ')}`, title }
}
