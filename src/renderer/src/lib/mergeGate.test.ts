import { describe, expect, test } from 'bun:test'
import {
  evaluateMergeGate,
  FINDINGS_UNVERIFIED,
  isBlockingFinding,
  mergeReadyChip,
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

describe('mergeReadyChip', () => {
  const chipFor = (args: Parameters<typeof evaluateMergeGate>[0]) =>
    mergeReadyChip(evaluateMergeGate(args))

  test('a fully checked, fully met bar is the only thing that reads ready', () => {
    const chip = chipFor({ review: review(), findings: [] })
    expect(chip.state).toBe('ready')
    expect(chip.label).toBe('Merge-ready')
  })

  test('unloaded findings read as unverified, NEVER as ready', () => {
    // The whole reason the badge is trustworthy. Everything else about this PR
    // is green; the findings simply never loaded. Rounding that up to
    // "Merge-ready" would tell the human the §8 bar is met when nobody checked
    // its third axis.
    const chip = chipFor({ review: review(), findings: FINDINGS_UNVERIFIED })
    expect(chip.state).not.toBe('ready')
    expect(chip.state).toBe('unverified')
    expect(chip.label).not.toMatch(/merge-ready/i)
  })

  test('the unverified label says the app could not check, not that the PR failed', () => {
    const chip = chipFor({ review: review(), findings: FINDINGS_UNVERIFIED })
    expect(chip.label).toMatch(/not loaded/i)
    expect(chip.title).toMatch(/open the PR/i)
  })

  test('a known-failing axis reads not-ready and names the reason', () => {
    expect(chipFor({ review: review({ verdict: 'comment' }), findings: [] }).label).toBe(
      'Not ready · unapproved',
    )
    expect(chipFor({ review: review({ testStatus: 'fail' }), findings: [] }).label).toBe(
      'Not ready · tests failing',
    )
    expect(chipFor({ review: review(), findings: [{ severity: 'high' }] }).label).toBe(
      'Not ready · 1 finding ≥ medium',
    )
  })

  test('every failing reason is named, in bar order', () => {
    const chip = chipFor({
      review: review({ verdict: 'comment', testStatus: 'fail' }),
      findings: [{ severity: 'high' }, { severity: 'critical' }],
    })
    expect(chip.label).toBe('Not ready · unapproved · tests failing · 2 findings ≥ medium')
  })

  test('a known failure outranks an unverifiable axis rather than hiding behind it', () => {
    // Both axes are unmet, but only one is a fact. The badge has to lead with
    // the fact — "Findings not loaded" would read as the milder problem.
    const chip = chipFor({
      review: review({ testStatus: 'fail' }),
      findings: FINDINGS_UNVERIFIED,
    })
    expect(chip.state).toBe('not-ready')
    expect(chip.label).toBe('Not ready · tests failing')
    // ...but the unverified axis is still in the tooltip, not dropped.
    expect(chip.title).toMatch(/not loaded/i)
  })

  test('a stale review is carried into the tooltip even when the badge is green', () => {
    const chip = chipFor({ review: review({ stale: true, commitsBehind: 3 }), findings: [] })
    expect(chip.state).toBe('ready')
    expect(chip.title).toMatch(/3 commit/)
  })

  test('the badge is informational only — it exposes no action', () => {
    // Guards the decision this PR records: readiness is surfaced, not enforced.
    // If a future change re-adds an `allowed`/`onOverride` shape to the chip,
    // this fails and forces the conversation again.
    expect(Object.keys(chipFor({ review: review(), findings: [] })).sort()).toEqual([
      'label',
      'state',
      'title',
    ])
  })
})

describe('stack cascade readiness (ticket #0095 × #0079)', () => {
  // "Merge stack" cascades through every layer at or below the requested one,
  // so the human confirming it has to be able to read the whole cascade. The
  // stack map shows each layer's badge from LIST data, which is exactly why a
  // lower layer can never be shown as merge-ready: its findings are not loaded.
  test('a lower layer is never shown as ready, however clean its review looks', () => {
    const chip = mergeReadyChip(
      evaluateMergeGate({ review: review(), findings: FINDINGS_UNVERIFIED }),
    )
    expect(chip.state).not.toBe('ready')
    expect(chip.label).toMatch(/not loaded/i)
  })

  test('a lower layer with a bad verdict says so, rather than hiding behind the unloaded findings', () => {
    const chip = mergeReadyChip(
      evaluateMergeGate({
        review: review({ verdict: 'request-changes' }),
        findings: FINDINGS_UNVERIFIED,
      }),
    )
    expect(chip.state).toBe('not-ready')
    expect(chip.label).toBe('Not ready · unapproved')
  })
})
