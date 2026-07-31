import type { Ticket, UnifiedRun } from './types'

// Assembles a ticket's run history from stores that already exist.
//
// There are two independent ticket->run edges and neither one alone is complete:
//   - `run.trace.ticketSlug`, stamped by agents.ts when a run is launched for a
//     ticket. Covers every agent run, including reruns and lane fan-out.
//   - `ticket.run.id`, written into the ticket's own frontmatter by
//     `update_ticket_run`. Covers session/terminal runs, which carry no trace.
// Using both and de-duplicating is what makes the tab show the whole history
// rather than only the most recent link.
//
// Cost is deliberately absent: spend is not part of a ticket's lineage, and the
// dollar figures were cut from the product surface entirely.

export type LineageInputs = {
  ticket: Pick<Ticket, 'slug'> & Partial<Pick<Ticket, 'run'>>
  /**
   * Root of the repo the ticket belongs to. Required: `runs:all` is global
   * across every managed repo while ticket slugs are only unique *within* a
   * repo, so slug alone would silently pull another repo's runs onto this
   * ticket.
   */
  repoRoot: string
  runs: UnifiedRun[]
}

export type TicketLineage = {
  runs: UnifiedRun[]
  runCount: number
  running: boolean
  linkedRunId?: string
}

export function buildTicketLineage({ ticket, repoRoot, runs }: LineageInputs): TicketLineage {
  const linkedRunId = ticket.run?.id

  const seen = new Set<string>()
  const mine: UnifiedRun[] = []
  for (const r of runs) {
    if (r.repoRoot !== repoRoot) continue
    const isMine = r.trace?.ticketSlug === ticket.slug || (!!linkedRunId && r.id === linkedRunId)
    if (!isMine || seen.has(r.id)) continue
    seen.add(r.id)
    mine.push(r)
  }

  mine.sort((a, b) => b.startedAt - a.startedAt)

  return {
    runs: mine,
    runCount: mine.length,
    running: mine.some((r) => r.status === 'running'),
    linkedRunId,
  }
}
