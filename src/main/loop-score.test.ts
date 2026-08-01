import { describe, expect, test } from 'bun:test'
import { parseWeightedScore } from './loop-score'

// Ticket 105. This number decides whether a loop TERMINATES, keeps burning
// turns, or stops early — and every failure mode is silent, because a wrong
// score still looks like a plausible score.
//
// The bug: `/weighted:\s*([\d.]+)/` has no left boundary, so it matches the
// tail of `unweighted:` too. An evaluator that writes both lines yields the
// wrong one, and nothing anywhere reports a discrepancy.

describe('parseWeightedScore ignores unweighted: (ticket 105)', () => {
  test('the exact reported case: unweighted first, weighted second', () => {
    // The old regex returns 0.3 here — the unweighted value — and feeds it
    // straight into the plateau/termination decision.
    expect(parseWeightedScore('unweighted: 0.30\nweighted:   0.82\n')).toBe(0.82)
  })

  test('order does not matter — weighted first still wins', () => {
    expect(parseWeightedScore('weighted: 0.82\nunweighted: 0.30\n')).toBe(0.82)
  })

  test('a file with ONLY unweighted: has no weighted score', () => {
    // Must not fall back to the unweighted number just because it is there.
    expect(parseWeightedScore('unweighted: 0.30\n')).toBe(null)
  })

  test('other keys ending in the word are not matched either', () => {
    expect(parseWeightedScore('reweighted: 0.99\n')).toBe(null)
    expect(parseWeightedScore('# notes about unweighted: 0.11\n')).toBe(null)
  })
})

describe('parseWeightedScore rejects malformed numbers (ticket 105)', () => {
  test('a version-like value is not silently truncated to 1.2', () => {
    // `[\d.]+` accepts "1.2.3" and parseFloat quietly yields 1.2 — a score
    // nobody wrote, in range, indistinguishable from a real one.
    expect(parseWeightedScore('weighted: 1.2.3\n')).toBe(null)
  })

  test('a non-numeric value is not a score', () => {
    expect(parseWeightedScore('weighted: n/a\n')).toBe(null)
    expect(parseWeightedScore('weighted:\n')).toBe(null)
  })

  test('ordinary forms still parse', () => {
    expect(parseWeightedScore('weighted: 0.82')).toBe(0.82)
    expect(parseWeightedScore('weighted: .82')).toBe(0.82)
    expect(parseWeightedScore('weighted: 1')).toBe(1)
    expect(parseWeightedScore('  weighted:   0.5  ')).toBe(0.5)
  })

  test('a markdown-formatted score line parses', () => {
    // Evaluators write prose; the line is rarely alone on a bare line.
    expect(parseWeightedScore('## Scores\n\nweighted: 0.71\n\nNotes follow.')).toBe(0.71)
  })

  test('an empty or absent file yields null, not 0', () => {
    // 0 is a REAL score meaning "terrible". Collapsing "no score" into 0 makes
    // an unwritten evaluation look like a maximally-bad one, and the plateau
    // check then compares a real score against a fiction.
    expect(parseWeightedScore('')).toBe(null)
    expect(parseWeightedScore('no scores here')).toBe(null)
  })
})
