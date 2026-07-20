import type { AgentModelPolicy } from './agents'

// The one seam that turns the declared routing fields (Ticket.modelTier +
// AgentModelPolicy) into the concrete model a run launches with. Pure — every
// input (including the per-engine Settings default) is passed in, so it is
// trivially testable and reusable by a future recommendTicketAgent() extension.

/** Ticket tier → which slot of the agent's model policy serves it. The
 *  cheap-agentic / cheap-raw distinction collapses to `cheap` for now — the
 *  policy has a single cheap slot; revisit if the slots ever diverge. */
const TIER_TO_POLICY: Record<string, keyof Omit<AgentModelPolicy, 'allowOverride'>> = {
  auto: 'default',
  top: 'deep',
  'cheap-agentic': 'cheap',
  'cheap-raw': 'cheap',
}

export type ResolveModelInput = {
  /** Explicit per-run pick (run dialog / rerun). Wins unless the policy locks it out. */
  override?: string
  /** Owner agent's model policy (step 2 + the allowOverride lock). */
  policy?: AgentModelPolicy
  /** Ticket's declared tier: auto | top | cheap-agentic | cheap-raw. Absent → auto. */
  tier?: string
  /** The agent's plain configured model (legacy spec.model fallback). */
  model?: string
  /** engineDefaultModel(engine), passed in so this stays pure. */
  engineDefault?: string
  /** The engine this run launches with. */
  engine?: string
  /** The engine the policy's model slugs were written for (the agent's own
   *  engine). A policy naming e.g. codex slugs must not leak into a run the
   *  user relaunched on another engine — when both engines are known and
   *  differ, the policy (and its override lock) is ignored. */
  policyEngine?: string
}

/** Resolve the concrete model for a run, in priority order:
 *  override (unless allowOverride: false and the policy selects a model) →
 *  tier mapped through the policy → agent model → engine Settings default → ''.
 *  '' means "no --model flag — let the engine pick its own default". */
export function resolveModel(input: ResolveModelInput): string {
  const crossEngine = !!input.engine && !!input.policyEngine && input.engine !== input.policyEngine
  const policy = crossEngine ? undefined : input.policy
  const slot = TIER_TO_POLICY[input.tier || 'auto'] || 'default'
  const policyModel = (policy?.[slot] || '').trim()
  const override = (input.override || '').trim()
  const overrideAllowed = policy?.allowOverride !== false
  if (override && (overrideAllowed || !policyModel)) return override
  if (policyModel) return policyModel
  return (input.model || '').trim() || (input.engineDefault || '').trim() || ''
}
