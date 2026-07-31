import type { Ticket, UnifiedRun } from './types'

// Assembles a ticket's run history and spend from stores that already exist.
//
// There are two independent ticket->run edges and neither one alone is complete:
//   - `run.trace.ticketSlug`, stamped by agents.ts when a run is launched for a
//     ticket. Covers every agent run, including reruns and lane fan-out.
//   - `ticket.run.id`, written into the ticket's own frontmatter by
//     `update_ticket_run`. Covers session/terminal runs, which carry no trace.
// Using both and de-duplicating is what makes the card show the whole history
// rather than only the most recent link.
//
// Cost deliberately reads the AIRun ledger (`observability:runs`) rather than the
// SQLite rollup in observability-index.ts, which ticket 77 is actively changing.

export type LedgerEntry = { runId?: string; costUsd?: number }

export type LineageInputs = {
  ticket: Pick<Ticket, 'slug'> & Partial<Pick<Ticket, 'run'>>
  /**
   * Root of the repo the ticket belongs to. Required: `runs:all` is global
   * across every managed repo while ticket slugs are only unique *within* a
   * repo, so slug alone would silently pull another repo's runs — and its
   * dollars — onto this ticket.
   */
  repoRoot: string
  runs: UnifiedRun[]
  aiRuns: LedgerEntry[]
}

export type LineageRun = UnifiedRun & { costUsd: number }

export type TicketLineage = {
  runs: LineageRun[]
  runCount: number
  totalCostUsd: number
  /** False when no run has a known price, so the UI can omit cost instead of claiming $0. */
  hasCost: boolean
  running: boolean
  linkedRunId?: string
}

/** Sum every ledger entry for a run id — one run can bill several AI calls. */
function ledgerCost(entries: LedgerEntry[]): Map<string, number> {
  const by = new Map<string, number>()
  for (const e of entries) {
    if (!e.runId) continue
    by.set(e.runId, (by.get(e.runId) || 0) + (e.costUsd || 0))
  }
  return by
}

export function buildTicketLineage({
  ticket,
  repoRoot,
  runs,
  aiRuns,
}: LineageInputs): TicketLineage {
  const linkedRunId = ticket.run?.id
  const byLedger = ledgerCost(aiRuns)

  const seen = new Set<string>()
  const mine: LineageRun[] = []
  for (const r of runs) {
    if (r.repoRoot !== repoRoot) continue
    const isMine = r.trace?.ticketSlug === ticket.slug || (!!linkedRunId && r.id === linkedRunId)
    if (!isMine || seen.has(r.id)) continue
    seen.add(r.id)
    // A run's self-reported cost wins over the ledger, matching the Runs tab.
    const cost = r.costUsd ?? byLedger.get(r.id) ?? 0
    mine.push({ ...r, costUsd: cost })
  }

  mine.sort((a, b) => b.startedAt - a.startedAt)

  const totalCostUsd = mine.reduce((sum, r) => sum + r.costUsd, 0)
  const hasCost = mine.some((r) => r.costUsd > 0)

  return {
    runs: mine,
    runCount: mine.length,
    totalCostUsd,
    hasCost,
    running: mine.some((r) => r.status === 'running'),
    linkedRunId,
  }
}
