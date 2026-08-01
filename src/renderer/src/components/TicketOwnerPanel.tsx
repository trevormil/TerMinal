import type { ReactNode } from 'react'
import { Bot, ArrowUpRight, Sparkles } from 'lucide-react'
import { Badge } from './ui'
import { navigateTo } from '../lib/nav'
import {
  agentDefinitionId,
  contextToTicketAgent,
  ticketAgentContext,
  ticketAgentContextId,
  ticketAgentDiffers,
} from '../lib/ticketOwner'
import type { Persona, Ticket, TicketAgent, TicketAgentRecommendation } from '../lib/types'

// The Owner tab: who owns this ticket, how to change it, and — when the router
// disagrees — why it thinks somebody else should. Lifted out of the ticket
// header, which was carrying the whole ownership apparatus inline.
//
// Deliberately NOT here: the agent's contract, model policy, or scorecard. The
// Agents tab owns those; this pane links to them rather than restating them.

const Kicker = ({ label }: { label: string }) => (
  <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-500">{label}</div>
)

const Quiet = ({ children }: { children: ReactNode }) => (
  <div className="text-[11.5px] leading-relaxed text-zinc-600">{children}</div>
)

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</span>
    <span className="font-mono text-[11px] text-zinc-300">{value}</span>
  </div>
)

/**
 * Jump to this agent in the Agents tab. Dispatched twice — once to switch tabs
 * and once after the tab has mounted and can act on the payload — matching the
 * tickets widget and the Files column.
 */
function viewInAgentsTab(agent: TicketAgent) {
  const payload = { definitionId: agentDefinitionId(agent), agentId: agent.id, kind: agent.kind }
  navigateTo('agents', payload)
  setTimeout(() => navigateTo('agents', payload), 50)
}

export function TicketOwnerPanel({
  ticket,
  agentContexts,
  recommendation,
  onChanged,
}: {
  ticket: Ticket
  agentContexts: Persona[]
  recommendation: TicketAgentRecommendation | null
  onChanged: () => void
}) {
  const agent = ticket.agent
  const owned = Boolean(agent?.id)
  const ownerContext = ticketAgentContext(agentContexts, agent)
  // Owned but unknown: the ticket names an agent this repo no longer defines.
  // Say so plainly rather than rendering a card full of blanks.
  const orphaned = owned && !ownerContext

  const assign = async (next: TicketAgent) => {
    await window.gt.tickets.update(ticket.slug, { agent: next })
    onChanged()
  }

  // Recommending the owner you already have is pure noise, so the suggestion
  // only appears when it differs — the rule the old header line had, kept.
  const suggestion =
    recommendation && ticketAgentDiffers(agent, recommendation.agent) ? recommendation : null
  const suggestionTitle = suggestion
    ? ticketAgentContext(agentContexts, suggestion.agent)?.title || suggestion.agent.id
    : ''

  return (
    <div className="p-5">
      <section className="mb-5">
        <Kicker label="current owner" />
        {!owned ? (
          <Quiet>
            No owner assigned. Every ticket is worked by exactly one agent — pick one below.
          </Quiet>
        ) : (
          <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Bot size={14} strokeWidth={2.25} className="text-[var(--gt-accent-light)]" />
              <span className="text-[13px] font-semibold text-zinc-100">
                {ownerContext?.title || agent.id}
              </span>
              <button
                onClick={() => viewInAgentsTab(agent)}
                title="Open this agent in the Agents tab — contract, model policy, run history."
                className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--gt-accent-2)] hover:underline"
              >
                View in Agents tab
                <ArrowUpRight size={11} strokeWidth={2} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Fact label="id" value={agent.id} />
              <Fact label="scope" value={agent.scope} />
              <Fact label="kind" value={agent.kind} />
              <Fact label="model tier" value={ticket.modelTier || 'auto'} />
            </div>
            {orphaned && (
              <div className="mt-2 text-[11.5px] leading-relaxed text-[var(--gt-yellow)]">
                This repo defines no agent by that id — the ticket is owned on paper only. Reassign
                it below.
              </div>
            )}
            {ownerContext?.description && !orphaned && (
              <div className="mt-2 text-[11.5px] leading-relaxed text-zinc-500">
                {ownerContext.description}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-5">
        <Kicker label={owned ? 'reassign' : 'assign'} />
        <select
          value={ticketAgentContextId(agent)}
          onChange={async (e) => {
            const next = contextToTicketAgent(agentContexts.find((a) => a.id === e.target.value))
            if (next) await assign(next)
          }}
          className="w-full max-w-md cursor-pointer rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)] px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
        >
          {/* An unresolvable owner still needs a selected value, or the picker
              silently displays the first agent in the list as if it were the
              owner. */}
          {(!owned || orphaned) && (
            <option value={ticketAgentContextId(agent)} disabled>
              {owned ? `${agent.id} — not defined here` : 'No owner — choose an agent'}
            </option>
          )}
          {agentContexts.map((a) => (
            <option key={a.id} value={a.id} className="bg-[var(--gt-panel)] text-zinc-200">
              {a.title}
            </option>
          ))}
        </select>
      </section>

      {suggestion && (
        <section>
          <Kicker label="suggested owner" />
          <div className="rounded-lg border border-[var(--gt-accent)]/35 bg-[var(--gt-accent)]/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles size={13} strokeWidth={2.25} className="text-[var(--gt-accent-light)]" />
              <Badge tone="accent">{suggestionTitle}</Badge>
              <button
                onClick={() => assign(suggestion.agent)}
                className="ml-auto rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
              >
                Make owner
              </button>
            </div>
            {/* The rationale used to live in a `title=` hover, where it was
                unreadable at any length. It has room here. */}
            {suggestion.reason ? (
              <div className="mt-2 text-[12px] leading-relaxed text-zinc-300">
                {suggestion.reason}
              </div>
            ) : (
              <Quiet>No rationale recorded for this suggestion.</Quiet>
            )}
            {suggestion.signals.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">
                  matched on
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestion.signals.map((s) => (
                    <span
                      key={s}
                      className="rounded border border-[var(--gt-border)] bg-black/20 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-400"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
