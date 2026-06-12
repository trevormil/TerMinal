import type { Agent, AgentDefinition, Engine, Persona, Ticket, UnifiedRun } from './types'
import { withLaunchContext } from './launch'

export function ticketImplementationPrompt(
  ticket: Pick<Ticket, 'id' | 'title' | 'body' | 'provider' | 'providerLabel' | 'externalKey' | 'url'>,
  opts: { persona?: string; pipeline?: string; model?: string; runContext?: Persona; ticketProvider?: 'local' | 'github' | 'linear'; ticketProviderLabel?: string } = {},
): string {
  const provider = ticket.provider || opts.ticketProvider || 'local'
  const ref = ticket.externalKey || `#${ticket.id}`
  const providerLine =
    provider === 'github'
      ? 'Ticket provider: GitHub Issues. Use the gh CLI in this repository to update issue status/labels. Do not create or edit local backlog markdown for this ticket.'
      : provider === 'linear'
        ? 'Ticket provider: Linear. Use the configured Linear MCP/CLI to update issue status/priority. Do not create or edit local backlog markdown for this ticket.'
        : "Ticket provider: local backlog. Update this repo's .TerMinal/backlog markdown ticket, including status and prs: when a PR is opened."
  return withLaunchContext(
    `Implement ticket ${ref}: ${ticket.title}

${ticket.body}

${providerLine}

Implement the ticket end to end. Keep changes surgical, add or adjust tests, commit your work, and open a PR that references ticket ${ref}${ticket.url ? ` (${ticket.url})` : ''}. If fully delivered, set the ticket status to closed; otherwise set it in-progress. Link or reference the PR in the ticket provider when supported. End with a short summary of what changed and the PR URL.`,
    opts,
  )
}

export function fileTicketPrompt(
  text: string,
  opts: { model?: string; ticketProvider?: 'local' | 'github' | 'linear'; ticketProviderLabel?: string } = {},
): string {
  const provider = opts.ticketProvider || 'local'
  const instruction =
    provider === 'github'
      ? 'File exactly ONE new GitHub Issue for the request below using the gh CLI in this repository. Set useful labels for type/priority/status when labels exist or can be safely created. Do NOT implement anything or open a PR.'
      : provider === 'linear'
        ? 'File exactly ONE new Linear issue for the request below using the configured Linear MCP/CLI. Use the repo/provider conventions for team, status, and priority. Do NOT implement anything or open a PR.'
        : "File exactly ONE new backlog ticket for the request below, using this project's ticket conventions. Allocate the next id, write .TerMinal/backlog/NNNN-slug.md with valid YAML frontmatter matching the ticket example (legacy v1 repos may use backlog/), put detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR."
  return withLaunchContext(
    `${instruction}

Request: ${text.trim()}`,
    opts,
  )
}

export function agentPrompt(
  agent: Pick<Agent, 'id' | 'title' | 'prompt'>,
  opts: { persona?: string; pipeline?: string; model?: string; runContext?: Persona } = {},
): string {
  return withLaunchContext(
    `Run the "${agent.title}" agent (${agent.id}) for this repository.

${agent.prompt}

Follow this repository's workflow instructions. Commit any changes you make and open a PR when the agent's task produces code, docs, tickets, or other repo changes.`,
    opts,
  )
}

export function scheduleDesignerPrompt(text: string, opts: { model?: string } = {}): string {
  return withLaunchContext(
    `Design a new TerMinal schedule for this repository from this request:

${text.trim()}

Use an existing agent id from this repo when possible. Write the schedule using the project's schedule conventions, save it, and summarize the inferred cadence and agent.`,
    opts,
  )
}

export function prAgentPrompt(
  pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
  kind: 'review' | 'iterate',
  opts: { forgeSym?: string; forgeLabel?: string; persona?: string; pipeline?: string; model?: string; runContext?: Persona; reviewAgent?: AgentDefinition } = {},
): string {
  const sym = opts.forgeSym || '#'
  const label = opts.forgeLabel || 'PR'
  const ref = pr.webUrl || `${sym}${pr.iid}`
  const ctx = `${label} ${sym}${pr.iid} (${ref}${pr.title ? ` - "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
  const reviewAgent = opts.reviewAgent
  const reviewContract = reviewAgent
    ? `Use the selected TerMinal code-review agent definition "${reviewAgent.title}" (${reviewAgent.ref.kind}:${reviewAgent.ref.scope}:${reviewAgent.ref.id}).

Agent guidance:
${reviewAgent.instructions.prompt || ''}

Output contract:
${reviewAgent.instructions.outputContract || 'Write the review artifact and findings/suggestions state expected by the repository.'}`
    : 'Use the repository code-review agent contract from .agents/code-review.md when present.'
  return withLaunchContext(
    kind === 'review'
      ? `Review ${ctx}.

${reviewContract}

Resolve the target branch and current head commit, inspect the diff and relevant history, run the project test gate, and write the required review artifacts. Do not implement fixes during review; file owner-scoped follow-up tickets for out-of-scope work. End with verdict, artifact path, test status, and key findings.`
      : `Iterate on ${ctx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases. Keep changes surgical, commit, and push back to ${pr.sourceBranch}. End with final status and a short summary.`,
    opts,
  )
}

export function rerunPrompt(run: UnifiedRun, engine?: Engine): string {
  const tool = engine || run.engine || 'agent'
  return `Re-run the "${run.agentTitle}" agent (${run.agentId}) for this repository using ${tool}. Follow the same intent as the previous run. Commit any changes and open or update a PR if appropriate.`
}
