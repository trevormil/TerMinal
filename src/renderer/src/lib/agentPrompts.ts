import type { Agent, Engine, Ticket, UnifiedRun } from './types'
import { withLaunchContext } from './launch'

export function ticketImplementationPrompt(
  ticket: Pick<Ticket, 'id' | 'title' | 'body'>,
  opts: { persona?: string; pipeline?: string; model?: string } = {},
): string {
  return withLaunchContext(
    `Implement backlog ticket #${ticket.id}: ${ticket.title}

${ticket.body}

Implement the ticket end to end. Keep changes surgical, add or adjust tests, commit your work, and open a PR that references ticket #${ticket.id}. If fully delivered, set the ticket status to closed; otherwise set it in-progress. Link the PR in the ticket's prs: field. End with a short summary of what changed and the PR URL.`,
    opts,
  )
}

export function fileTicketPrompt(text: string, opts: { model?: string } = {}): string {
  return withLaunchContext(
    `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions. Allocate the next id, write .TerMinal/backlog/NNNN-slug.md with valid YAML frontmatter matching the ticket example (legacy v1 repos may use backlog/), put detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR.

Request: ${text.trim()}`,
    opts,
  )
}

export function agentPrompt(
  agent: Pick<Agent, 'id' | 'title' | 'prompt'>,
  opts: { persona?: string; pipeline?: string; model?: string } = {},
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
  opts: { forgeSym?: string; forgeLabel?: string; persona?: string; pipeline?: string; model?: string } = {},
): string {
  const sym = opts.forgeSym || '#'
  const label = opts.forgeLabel || 'PR'
  const ref = pr.webUrl || `${sym}${pr.iid}`
  const ctx = `${label} ${sym}${pr.iid} (${ref}${pr.title ? ` - "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
  return withLaunchContext(
    kind === 'review'
      ? `Do a thorough senior code review of ${ctx} Inspect git diff against the target branch and git log. Evaluate correctness, security, architecture, conformance, quality, and dependencies. Where you find clear, safe fixes, apply them with tests, commit, and push. End with a concise verdict and findings.`
      : `Iterate on ${ctx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases. Keep changes surgical, commit, and push back to ${pr.sourceBranch}. End with final status and a short summary.`,
    opts,
  )
}

export function rerunPrompt(run: UnifiedRun, engine?: Engine): string {
  const tool = engine || run.engine || 'agent'
  return `Re-run the "${run.agentTitle}" agent (${run.agentId}) for this repository using ${tool}. Follow the same intent as the previous run. Commit any changes and open or update a PR if appropriate.`
}
