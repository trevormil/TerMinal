import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Badge, type BadgeTone } from './ui'
import { navigateTo } from '../lib/nav'
import { fmtUsd } from '../lib/format'
import { buildTicketLineage, type TicketLineage } from '../lib/ticketLineage'
import type { Ticket, UnifiedRun } from '../lib/types'

// The reverse view of the factory loop: from a ticket, every run it produced,
// what each one cost, and a way back into the Runs tab. Assembly lives in
// lib/ticketLineage.ts so the join rules are unit-tested; this file is purely
// fetch + render.

// Matches the Runs tab's mappings so the same run never wears two different
// colours depending on which tab you are looking at.
const statusTone = (s: string): BadgeTone =>
  s === 'done' || s === 'pass'
    ? 'green'
    : s === 'failed' || s === 'fail'
      ? 'red'
      : s === 'running'
        ? 'blue'
        : s === 'canceled' || s === 'interrupted'
          ? 'yellow'
          : 'mute'

const sourceTone = (s: UnifiedRun['source']): BadgeTone =>
  s === 'cron' ? 'accent' : s === 'bg' ? 'yellow' : s === 'session' ? 'green' : 'blue'

const fmtDur = (start: number, end?: number) => {
  if (!end || end < start) return ''
  const s = Math.round((end - start) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function TicketLineageCard({ ticket, repoRoot }: { ticket: Ticket; repoRoot: string }) {
  const [lineage, setLineage] = useState<TicketLineage | null>(null)
  // Read by the poll tick so `running` never has to be an effect dependency —
  // as a dep it re-ran the effect the moment the first load resolved
  // (undefined -> false) and fetched the whole run list a second time.
  const running = useRef(false)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        // Local runs only: a remote host reports its own repoRoot, which cannot
        // be matched against this repo's local path, so remote work is out of
        // scope until runs carry a repo identity rather than a filesystem path.
        const [runs, aiRuns] = await Promise.all([
          window.gt.agents.allRuns(),
          window.gt.observability.runs(500),
        ])
        if (!live) return
        const next = buildTicketLineage({ ticket, repoRoot, runs, aiRuns })
        running.current = next.running
        setLineage(next)
      } catch {
        /* stores unavailable — the card simply stays hidden */
      }
    }
    void load()
    // Only poll while something is actually in flight; a ticket's history is
    // otherwise static and this pane is not a live dashboard.
    const t = setInterval(() => {
      if (running.current) void load()
    }, 4000)
    return () => {
      live = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.slug, repoRoot])

  if (!lineage || lineage.runCount === 0) return null

  return (
    <div className="mb-3 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]">
      <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5">
        <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">run history</span>
        {lineage.running && <Badge tone="blue">running</Badge>}
        <span className="ml-auto text-[11px] text-zinc-500">
          {lineage.runCount} run{lineage.runCount === 1 ? '' : 's'}
          {lineage.hasCost && (
            <>
              {' · '}
              <span
                className="text-zinc-300"
                title="Sum of every AI call billed to this ticket's runs"
              >
                {fmtUsd(lineage.totalCostUsd)}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="divide-y divide-[var(--gt-border)]">
        {lineage.runs.map((r) => (
          <button
            key={r.id}
            onClick={() => navigateTo('runs', { runId: r.id })}
            title={`Open this run in the Runs tab${r.agentTitle ? ` · ${r.agentTitle}` : ''}`}
            className="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/5"
          >
            <Badge tone={sourceTone(r.source)}>{r.source}</Badge>
            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            <span className="truncate text-zinc-300">{r.agentTitle || r.agentId}</span>
            {r.id === lineage.linkedRunId && (
              <span
                className="shrink-0 text-[10px] text-zinc-600"
                title="The run recorded on this ticket's frontmatter"
              >
                linked
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
              {fmtDur(r.startedAt, r.endedAt)}
            </span>
            {r.costUsd > 0 && (
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                {fmtUsd(r.costUsd)}
              </span>
            )}
            <ArrowUpRight
              size={11}
              strokeWidth={2}
              className="shrink-0 text-zinc-700 group-hover:text-[var(--gt-accent)]"
            />
          </button>
        ))}
      </div>
    </div>
  )
}
