// The loop stop rule — pure and dependency-free so termination is exhaustively
// unit-testable in isolation (loops.ts pulls in electron, this must not). Used
// by loops.ts `decide()` for every mode; it is the hard guarantee that a loop —
// headless, paired, or single — can never run forever.

/**
 * 'done' the moment the iteration cap is hit (the hard backstop: independent of
 * model behaviour, so no infinite loop is possible) OR the contract has
 * converged (every assertion passing and taste plateaued). 'continue' otherwise.
 */
export function decideOutcome(
  iteration: number,
  maxIterations: number,
  allPass: boolean,
  plateau: boolean,
): 'continue' | 'done' {
  if (iteration >= maxIterations) return 'done'
  if (allPass && plateau) return 'done'
  return 'continue'
}
