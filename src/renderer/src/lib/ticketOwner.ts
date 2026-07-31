// Pure rules behind the Owner tab of ticket detail (components/TicketDetail.tsx).
// Kept out of the component so the "is this recommendation worth showing" rule
// and the Agents-tab jump target are unit-testable without a DOM.

import type { Persona, TicketAgent } from './types'

/**
 * The persona/context id an agent is picked by. Mirrors `ticketAgentContextId`
 * in src/main/agents.ts, which resolves the same id when running a ticket.
 */
export function ticketAgentContextId(agent?: TicketAgent): string {
  if (!agent?.id) return ''
  return agent.kind === 'persistent' ? `persistent:${agent.id}` : `agent:${agent.id}`
}

/** The inverse: a picked context back to the agent triple stored on a ticket. */
export function contextToTicketAgent(context: Persona | undefined): TicketAgent | null {
  if (!context?.agentId || !context.agentScope || !context.agentKind) return null
  return { id: context.agentId, scope: context.agentScope, kind: context.agentKind }
}

/** The `Persona` entry backing a ticket's agent, if the repo still defines one. */
export function ticketAgentContext(
  contexts: Persona[],
  agent: TicketAgent | undefined,
): Persona | undefined {
  if (!agent?.id) return undefined
  return contexts.find((c) => c.agentId === agent.id && c.agentKind === agent.kind)
}

/**
 * Whether an agent recommendation is worth surfacing at all. Recommending the
 * owner a ticket already has is pure noise, so the suggestion only appears when
 * it differs — on any of the three fields that together identify an agent.
 */
export function ticketAgentDiffers(current: TicketAgent | undefined, next: TicketAgent): boolean {
  if (!current?.id) return true
  return current.id !== next.id || current.scope !== next.scope || current.kind !== next.kind
}

/**
 * The Agents tab's definition id for a ticket's owner — the payload behind
 * "View in Agents tab". Mirrors `listAgentDefinitions` in src/main/agents.ts,
 * which builds `${kind}:${scope}:${id}` and pins every persistent agent to
 * global scope. The renderer cannot import from main, so the format is restated
 * here and must stay in step.
 */
export function agentDefinitionId(agent: TicketAgent): string {
  const scope = agent.kind === 'persistent' ? 'global' : agent.scope
  return `${agent.kind}:${scope}:${agent.id}`
}
