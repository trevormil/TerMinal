import { describe, expect, test } from 'bun:test'
import {
  blockedLegs,
  evaluateMergeGate,
  FINDINGS_UNVERIFIED,
  isBlockingFinding,
  severityRank,
} from './mergeGate'
import type { Finding, Review } from './types'

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

describe('severityRank', () => {
  test('orders the documented severities', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'))
    expect(severityRank('high')).toBeGreaterThan(severityRank('medium'))
    expect(severityRank('medium')).toBeGreaterThan(severityRank('low'))
    expect(severityRank('low')).toBeGreaterThan(severityRank('info'))
  })

  test('is case-insensitive and tolerates whitespace', () => {
    expect(severityRank('  HIGH ')).toBe(severityRank('high'))
  })

  test('an ABSENT severity is not blocking — an unlabelled note is just a note', () => {
    expect(severityRank('')).toBeLessThan(severityRank('medium'))
    expect(severityRank(undefined)).toBeLessThan(severityRank('medium'))
  })

  test('an UNRECOGNISED severity fails CLOSED', () => {
    // A producer spelling severities its own way (`blocker`, `sev1`, `P0`)
    // must not be able to walk criticals past a safety gate just because we
    // do not know its vocabulary.
    expect(severityRank('blocker')).toBeGreaterThan(severityRank('critical'))
    expect(severityRank('sev1')).toBeGreaterThan(severityRank('medium'))
  })
})

describe('isBlockingFinding', () => {
  test('medium and above block', () => {
    expect(isBlockingFinding({ severity: 'medium' })).toBe(true)
    expect(isBlockingFinding({ severity: 'high' })).toBe(true)
    expect(isBlockingFinding({ severity: 'critical' })).toBe(true)
  })

  test('below medium does not block', () => {
    expect(isBlockingFinding({ severity: 'low' })).toBe(false)
    expect(isBlockingFinding({ severity: 'info' })).toBe(false)
    expect(isBlockingFinding({})).toBe(false)
  })

  test('an unrecognised severity string blocks', () => {
    expect(isBlockingFinding({ severity: 'blocker' })).toBe(true)
    expect(isBlockingFinding({ severity: 'P0' })).toBe(true)
  })

  test('a resolved finding stops blocking regardless of severity', () => {
    expect(isBlockingFinding({ severity: 'critical', status: 'resolved' })).toBe(false)
    expect(isBlockingFinding({ severity: 'critical', status: 'RESOLVED' })).toBe(false)
  })

  test('any other status is still unresolved', () => {
    expect(isBlockingFinding({ severity: 'high', status: 'open' })).toBe(true)
    expect(isBlockingFinding({ severity: 'high', status: 'acknowledged' })).toBe(true)
  })
})

describe('evaluateMergeGate', () => {
  test('the documented bar met on all three axes allows the merge', () => {
    const gate = evaluateMergeGate({ review: review(), findings: [{ severity: 'low' }] })
    expect(gate.allowed).toBe(true)
    expect(gate.blockers).toEqual([])
  })

  test('a non-approve verdict blocks', () => {
    const gate = evaluateMergeGate({ review: review({ verdict: 'request-changes' }), findings: [] })
    expect(gate.allowed).toBe(false)
    expect(gate.blockers.map((b) => b.kind)).toEqual(['verdict'])
    expect(gate.blockers[0].detail).toContain('request-changes')
  })

  test('failing tests block', () => {
    const gate = evaluateMergeGate({ review: review({ testStatus: 'fail' }), findings: [] })
    expect(gate.blockers.map((b) => b.kind)).toEqual(['tests'])
  })

  test('an unknown test status blocks — unproven is not the same as passing', () => {
    expect(
      evaluateMergeGate({ review: review({ testStatus: 'unknown' }), findings: [] }).allowed,
    ).toBe(false)
  })

  test('unresolved findings at medium or above block and are counted', () => {
    const gate = evaluateMergeGate({
      review: review(),
      findings: [
        { severity: 'high' },
        { severity: 'medium' },
        { severity: 'critical', status: 'resolved' },
        { severity: 'low' },
      ],
    })
    expect(gate.allowed).toBe(false)
    const blocker = gate.blockers.find((b) => b.kind === 'findings')
    expect(blocker?.count).toBe(2)
  })

  test('a missing review blocks on both verdict and tests, not just one', () => {
    const gate = evaluateMergeGate({ review: null, findings: [] })
    expect(gate.allowed).toBe(false)
    expect(gate.blockers.map((b) => b.kind).sort()).toEqual(['tests', 'verdict'])
    expect(gate.blockers[0].detail).toContain('No code-review artifact')
  })

  test('every failing axis is reported, not just the first', () => {
    const gate = evaluateMergeGate({
      review: review({ verdict: 'comment', testStatus: 'fail' }),
      findings: [{ severity: 'high' }],
    })
    expect(gate.blockers.map((b) => b.kind).sort()).toEqual(['findings', 'tests', 'verdict'])
  })

  test('a stale review is surfaced as a warning, never as a silent pass', () => {
    const gate = evaluateMergeGate({
      review: review({ stale: true, commitsBehind: 3 }),
      findings: [],
    })
    expect(gate.allowed).toBe(true)
    expect(gate.warnings.some((w) => w.includes('3'))).toBe(true)
  })

  test('findings with unparseable shapes never crash the gate', () => {
    const junk = [{}, { severity: null }, { severity: 42 }] as unknown as Finding[]
    expect(() => evaluateMergeGate({ review: review(), findings: junk })).not.toThrow()
  })

  describe('FINDINGS_UNVERIFIED', () => {
    test('a caller that has not loaded findings is always blocked', () => {
      // The C2 regression: passing [] claimed "no findings", so a PR with two
      // unresolved criticals rendered an ENABLED merge button in the list.
      const gate = evaluateMergeGate({ review: review(), findings: FINDINGS_UNVERIFIED })
      expect(gate.allowed).toBe(false)
      expect(gate.blockers.map((b) => b.kind)).toEqual(['findings'])
    })

    test('the label says the app could not check, not that the human did not', () => {
      // "Findings not checked" read as a to-do the user had skipped. It means
      // the app never loaded them, and the copy has to say so.
      const label = evaluateMergeGate({ review: review(), findings: FINDINGS_UNVERIFIED })
        .blockers[0].label
      expect(label).toMatch(/not loaded/i)
      expect(label).toMatch(/open the PR/i)
    })

    test('it is never confused with a genuinely empty findings list', () => {
      expect(evaluateMergeGate({ review: review(), findings: [] }).allowed).toBe(true)
    })

    test('it stacks with the other axes rather than masking them', () => {
      const gate = evaluateMergeGate({
        review: review({ verdict: 'comment' }),
        findings: FINDINGS_UNVERIFIED,
      })
      expect(gate.blockers.map((b) => b.kind).sort()).toEqual(['findings', 'verdict'])
    })
  })
})

describe('blockedLegs', () => {
  test('reports the unmet legs in bar order, as kinds rather than copy', () => {
    // The override record is keyed on these, so rewording a label (which has
    // already happened once) must never change what the audit trail says.
    const gate = evaluateMergeGate({
      review: review({ verdict: 'comment', testStatus: 'fail' }),
      findings: [{ severity: 'critical' }],
    })
    expect(blockedLegs(gate)).toEqual(['verdict', 'tests', 'findings'])
  })

  test('an unverified findings list is recorded as the findings leg', () => {
    const gate = evaluateMergeGate({ review: review(), findings: FINDINGS_UNVERIFIED })
    expect(blockedLegs(gate)).toEqual(['findings'])
  })

  test('a clean gate has no legs to record', () => {
    expect(blockedLegs(evaluateMergeGate({ review: review(), findings: [] }))).toEqual([])
  })
})
