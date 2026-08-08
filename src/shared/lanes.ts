// The lane fan-out gate — the one place that decides whether a ticket may run
// more than one implementation lane, and how many.
//
// Pure and dependency-free (like experiments.ts) so main enforces it on the real
// entry point and the renderer can pre-disable the control off the SAME rules.
// Hiding the UI is not a gate: every rejection here is also returned to the user.

/** Hard ceiling on parallel lanes. Each lane is a real engine process on a real
 *  worktree spending real money, so the cap is deliberately small — a human has
 *  to read every lane's MR to pick a winner, and nobody reads eight diffs, let
 *  alone a hundred. */
export const MAX_LANES = 8

export type LaneGateInput = {
  /** Requested lane count. Anything <= 1 is the classic single run. */
  lanes?: number
  /** Is the `lanes` experiment on for this install? */
  experimentOn: boolean
  /** The ticket's acceptance criteria — the checklist every lane must satisfy
   *  and the only thing that makes comparing N MRs tractable. */
  acceptance?: string[]
}

export const LANE_EXPERIMENT_ERROR =
  'Ticket lanes are an experimental feature — enable Settings → Experimental → Ticket lanes to run more than one lane.'

export const LANE_ACCEPTANCE_ERROR =
  'Lanes need something to compare against: this ticket has no acceptance criteria — add at least one before fanning it out into multiple lanes.'

/** Does this ticket carry enough of a checklist to fan out against? */
export function hasLaneAcceptance(acceptance?: string[]): boolean {
  return (acceptance || []).some((c) => c.trim())
}

/**
 * Resolve a requested lane count into an allowed one, or an error explaining the
 * refusal. A solo run (<= 1) is never gated — it is the normal path.
 */
export function laneGate(input: LaneGateInput): { n: number } | { error: string } {
  const requested = Math.floor(input.lanes || 1)
  if (requested <= 1) return { n: 1 }
  if (!input.experimentOn) return { error: LANE_EXPERIMENT_ERROR }
  if (!hasLaneAcceptance(input.acceptance)) return { error: LANE_ACCEPTANCE_ERROR }
  return { n: Math.min(MAX_LANES, requested) }
}
