import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, GitPullRequest, Play } from 'lucide-react'
import { Badge, type BadgeTone } from './ui'
import { navigateTo } from '../lib/nav'
import { buildTicketLineage, type TicketLineage } from '../lib/ticketLineage'
import { stateTone, verdictTone, testTone } from '../lib/badges'
import type { Mr, Ticket, UnifiedRun } from '../lib/types'

// The Lineage tab: where this ticket's work actually went — the changes it
// produced (with the review verdict) and every run that worked it. Assembly of
// the ticket->run join lives in lib/ticketLineage.ts so the rules are
// unit-tested; this file is fetch + render.
//
// No dollars. Spend is not part of a ticket's lineage and cost display is out
// of the product.

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

// A ticket's `prs:` entries are forge URLs (…/-/merge_requests/N or …/pull/N).
// Parse the change number so we can link to the in-app MR view instead of
// opening the upstream forge in a browser.
export function prIidFromUrl(url: string): number | null {
  const m = url.match(/(?:\/-\/merge_requests\/|\/pull\/|\/merge_requests\/)(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Loads the ticket's run history. Lives in a hook rather than inside the panel
 * because the tab strip needs the count *before* you open the tab.
 *
 * `null` means "not loaded yet" and always resolves: a failed store read
 * settles as an empty lineage rather than leaving a permanent loading state.
 * An empty `repoRoot` is not a fetch at all — see TicketLineagePanel.
 */
export function useTicketLineage(
  ticket: Pick<Ticket, 'slug' | 'run'>,
  repoRoot: string,
): TicketLineage | null {
  const [lineage, setLineage] = useState<TicketLineage | null>(null)
  // Read by the poll tick so `running` never has to be an effect dependency —
  // as a dep it re-ran the effect the moment the first load resolved
  // (undefined -> false) and fetched the whole run list a second time.
  const running = useRef(false)

  useEffect(() => {
    let live = true
    setLineage(null)
    if (!repoRoot) return
    const load = async () => {
      let runs: UnifiedRun[] = []
      try {
        // Local runs only: a remote host reports its own repoRoot, which cannot
        // be matched against this repo's local path, so remote work is out of
        // scope until runs carry a repo identity rather than a filesystem path.
        runs = await window.gt.agents.allRuns()
      } catch {
        // Store unavailable — settle as "no runs" so the panel resolves to its
        // empty state instead of sitting on "Loading…" forever.
      }
      if (!live) return
      const next = buildTicketLineage({ ticket, repoRoot, runs })
      running.current = next.running
      setLineage(next)
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

  return lineage
}

/** Count shown on the Lineage tab: everything the tab has to show. */
export function lineageTabCount(
  ticket: Pick<Ticket, 'prs'>,
  lineage: TicketLineage | null,
): number {
  return ticket.prs.length + (lineage?.runCount || 0)
}

const Kicker = ({ label, meta }: { label: string; meta?: ReactNode }) => (
  <div className="mb-2 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-zinc-500">
    {label}
    {meta}
  </div>
)

const Quiet = ({ children }: { children: ReactNode }) => (
  <div className="text-[11.5px] text-zinc-600">{children}</div>
)

export function TicketLineagePanel({
  ticket,
  repoRoot,
  lineage,
  mrByIid,
  forgeLabel,
  forgeSym,
  onViewMr,
}: {
  ticket: Ticket
  /** Active repo. Empty when the host has no repo context — see below. */
  repoRoot: string
  lineage: TicketLineage | null
  mrByIid: Map<number, Mr>
  forgeLabel: string
  forgeSym: string
  onViewMr?: (iid: number) => void
}) {
  return (
    <div className="p-5">
      <section className="mb-5">
        <Kicker label="changes" />
        {ticket.prs.length === 0 ? (
          <Quiet>No {forgeLabel}s linked to this ticket yet.</Quiet>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {ticket.prs.map((p) => {
              const iid = prIidFromUrl(p)
              if (iid == null)
                return (
                  <button
                    key={p}
                    onClick={() => window.gt.openExternal(p)}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[var(--gt-accent-2)] hover:underline"
                  >
                    {p.replace(/^https?:\/\/[^/]+\//, '')}
                    <ArrowUpRight size={11} strokeWidth={2} />
                  </button>
                )
              const mr = mrByIid.get(iid)
              return (
                <button
                  key={p}
                  onClick={() => (onViewMr ? onViewMr(iid) : window.gt.openExternal(p))}
                  title={
                    onViewMr
                      ? `View ${forgeLabel} ${forgeSym}${iid} in-app`
                      : `Open ${forgeLabel} ${forgeSym}${iid} in the browser`
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1 text-[11px] hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                >
                  <GitPullRequest size={12} strokeWidth={2} className="text-zinc-500" />
                  <span className="font-mono text-zinc-300">
                    {forgeSym}
                    {forgeLabel}
                    {iid}
                  </span>
                  {mr && <Badge tone={stateTone(mr.state)}>{mr.state}</Badge>}
                  {mr?.review && (
                    <Badge tone={verdictTone(mr.review.verdict)}>{mr.review.verdict}</Badge>
                  )}
                  {mr?.review && (
                    <Badge tone={testTone(mr.review.testStatus)}>
                      tests {mr.review.testStatus}
                    </Badge>
                  )}
                </button>
              )
            })}
            {ticket.workedBy.length > 0 && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500"
                title="Model(s) that wrote this change"
              >
                ✍ written by {ticket.workedBy.join(', ')}
              </span>
            )}
          </div>
        )}
      </section>

      <section>
        {/* Run *detail* still lives in the Runs tab; this is only the index of
            which runs this ticket produced, which closes the reverse direction
            of the ticket -> run link. */}
        <Kicker
          label="runs"
          meta={lineage?.running ? <Badge tone="blue">running</Badge> : undefined}
        />
        {!repoRoot ? (
          // Silent hiding was the old behaviour and it lies: an empty repoRoot
          // is "we don't know", not "there are none". Say so, and point at the
          // surface that does have repo context.
          <Quiet>
            Run history needs repo context.{' '}
            <button
              onClick={() => navigateTo('tickets', { slug: ticket.slug })}
              className="text-[var(--gt-accent-2)] hover:underline"
            >
              Open this ticket in the Tickets tab
            </button>{' '}
            to see it.
          </Quiet>
        ) : lineage === null ? (
          <Quiet>Loading run history…</Quiet>
        ) : lineage.runCount === 0 ? (
          <Quiet>No runs have worked this ticket yet.</Quiet>
        ) : (
          <div className="divide-y divide-[var(--gt-border)] overflow-hidden rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]">
            {lineage.runs.map((r) => (
              <button
                key={r.id}
                onClick={() => navigateTo('runs', { runId: r.id })}
                title={`Open this run in the Runs tab${r.agentTitle ? ` · ${r.agentTitle}` : ''}`}
                className="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/5"
              >
                <Play size={11} strokeWidth={2} className="shrink-0 text-zinc-700" />
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
                <ArrowUpRight
                  size={11}
                  strokeWidth={2}
                  className="shrink-0 text-zinc-700 group-hover:text-[var(--gt-accent)]"
                />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
