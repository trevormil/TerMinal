import type { AgentModelPolicy } from './agents'

// The one seam that turns the declared routing fields (Ticket.modelTier +
// AgentModelPolicy) into the concrete model a run launches with. Pure — every
// input (including the per-engine Settings default) is passed in, so it is
// trivially testable and reusable by a future recommendTicketAgent() extension.

/** Ticket tier → which slot of the agent's model policy serves it. The
 *  cheap-agentic / cheap-raw distinction collapses to `cheap` for now — the
 *  policy has a single cheap slot; revisit if the slots ever diverge. */
const TIER_TO_POLICY = {
  auto: 'default',
  top: 'deep',
  'cheap-agentic': 'cheap',
  'cheap-raw': 'cheap',
} as const satisfies Record<string, keyof Omit<AgentModelPolicy, 'allowOverride'>>

/** The tiers a ticket may declare. The single source of truth — writers
 *  validate against this so a tier that resolveModel cannot route never
 *  reaches a ticket file. */
export type ModelTier = keyof typeof TIER_TO_POLICY
export const MODEL_TIERS = Object.keys(TIER_TO_POLICY) as ModelTier[]

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (MODEL_TIERS as string[]).includes(value)
}

/**
 * Coerce a caller-supplied tier to one resolveModel can actually route.
 *
 * Unknown tiers fall through to the `default` policy slot, which is the
 * EXPENSIVE model — so persisting a typo like 'cheep-raw' silently bills at
 * top rate while the ticket claims to be cheap. Normalising at the write
 * boundary keeps the file honest.
 */
export function normalizeModelTier(value: unknown): ModelTier {
  return isModelTier(value) ? value : 'auto'
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
  // Same normalisation the writers apply, so a tier that somehow reached a
  // ticket file still routes predictably instead of by index-miss.
  const slot = TIER_TO_POLICY[normalizeModelTier(input.tier)]
  const policyModel = (policy?.[slot] || '').trim()
  const override = (input.override || '').trim()
  const overrideAllowed = policy?.allowOverride !== false
  if (override && (overrideAllowed || !policyModel)) return override
  if (policyModel) return policyModel
  return (input.model || '').trim() || (input.engineDefault || '').trim() || ''
}
