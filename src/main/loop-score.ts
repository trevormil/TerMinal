// The taste-score parser for loop evaluations (ticket 105).
//
// Its own module, tiny as it is, because this number decides whether a loop
// terminates, keeps burning turns, or stops early — and every way it can be
// wrong is silent. A bad parse produces a plausible-looking score, so nothing
// downstream can tell it apart from a real one.
//
// It used to be an inline regex inside `decide()`:
//
//     /weighted:\s*([\d.]+)/
//
// with two defects. There is no LEFT boundary, so it also matches the tail of
// `unweighted:` — an evaluator writing
//
//     unweighted: 0.30
//     weighted:   0.82
//
// yields 0.30. And `[\d.]+` accepts `1.2.3`, which `parseFloat` truncates to
// 1.2: a score nobody wrote, in range, indistinguishable from a real one.

/** `weighted:` at a line start or after whitespace — never inside `unweighted:`. */
const WEIGHTED = /(?:^|\s)weighted:[ \t]*([0-9]*\.?[0-9]+)(?![0-9.])/m

/**
 * The weighted score in an evaluation, or `null` when there isn't one.
 *
 * `null` rather than 0 is deliberate: 0 is a REAL score meaning "terrible", so
 * collapsing "no score written" into 0 makes an unwritten evaluation look like
 * a maximally-bad one — and the plateau check then compares a real score
 * against a fiction and can call convergence that never happened.
 */
export function parseWeightedScore(text: string): number | null {
  const m = WEIGHTED.exec(text || '')
  if (!m) return null
  const n = Number.parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}
