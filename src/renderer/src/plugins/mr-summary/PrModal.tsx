import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, ExternalLink, GitBranch, TriangleAlert, X } from 'lucide-react'
import { Badge, Empty } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { ciTone, sevTone, stateTone, testTone, verdictTone } from '../../lib/badges'
import { navigateTo } from '../../lib/nav'
import type { CiInfo, MrDetail, TabContext, Ticket } from '../../lib/types'

// Deep-link into the MRs tab (replay once — the receiver mounts after the tab
// switches; mirrors the tdd/git widgets).
const openInMrsTab = (iid: number) => {
  navigateTo('mrs', { iid })
  setTimeout(() => navigateTo('mrs', { iid }), 50)
}

const FINDINGS_SHOWN = 5

// Ticket → PR back-reference: a ticket links its PRs by URL in `prs`.
const prIidFromUrl = (url: string): number | null => {
  const m = url.match(/(?:\/pull\/|\/-\/merge_requests\/)(\d+)/)
  return m ? Number(m[1]) : null
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </div>
      {children}
    </div>
  )
}

/**
 * LIGHT drill-in for the PRs cockpit widget: read-focused only — header, CI,
 * review verdict/score, findings/tests summary, linked ticket, description.
 * Deliberately NO embedded diffs and NO mutating actions (review/iterate/merge
 * live in the MRs tab's MrDetailView). Portaled to document.body so it escapes
 * the drawer's stacking context. Two escape hatches: "Open in PRs tab" and
 * "Open on forge".
 */
export function PrModal({ iid, onClose }: { iid: number; onClose: () => void }) {
  // undefined = loading, null = not found.
  const [detail, setDetail] = useState<MrDetail | null | undefined>(undefined)
  // undefined = loading (CI is slow, fetched lazily), null = none/unavailable.
  const [ci, setCi] = useState<CiInfo | null | undefined>(undefined)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [tabCtx, setTabCtx] = useState<TabContext | null>(null)

  useEffect(() => {
    window.gt
      .getMr(iid)
      .then(setDetail)
      .catch(() => setDetail(null))
    window.gt
      .getMrCi(iid)
      .then(setCi)
      .catch(() => setCi(null))
    // Linked ticket, when one references this PR/MR in its `prs` urls.
    window.gt.tickets
      .list()
      .then((ts) => setTicket(ts.find((t) => t.prs.some((u) => prIidFromUrl(u) === iid)) ?? null))
      .catch(() => setTicket(null))
    window.gt
      .tabContext()
      .then(setTabCtx)
      .catch(() => setTabCtx(null))
  }, [iid])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = tabCtx?.forgeLabel || 'PR'
  const sym = tabCtx?.forgeSym || '#'
  const r = detail?.reviewMeta
  const findings = detail?.findings ?? []

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-bg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--gt-border)] px-4 py-2">
          <span className="font-mono text-[11px] text-zinc-500">
            {sym}
            {iid}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                openInMrsTab(iid)
                onClose()
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
            >
              <ArrowUpRight size={11} strokeWidth={2} />
              Open in {label}s tab
            </button>
            {detail?.webUrl && (
              <button
                onClick={() => window.gt.openExternal(detail.webUrl)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
              >
                <ExternalLink size={11} strokeWidth={2} />
                Open on forge
              </button>
            )}
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {detail === undefined ? (
            <div className="text-[12px] text-zinc-600">Loading…</div>
          ) : detail === null ? (
            <div className="text-[12px] text-zinc-600">
              {label} {sym}
              {iid} not found.
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold text-zinc-100">
                    {detail.title}
                  </span>
                  <Badge tone={stateTone(detail.state)}>{detail.state}</Badge>
                  {detail.draft && <Badge tone="warn">Draft</Badge>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <GitBranch size={11} strokeWidth={2} />
                    {detail.sourceBranch} → {detail.targetBranch}
                  </span>
                  {detail.author && <span>@{detail.author}</span>}
                </div>
              </div>

              <Section label="CI">
                {ci === undefined ? (
                  <span className="text-[11px] text-zinc-600">Loading CI…</span>
                ) : ci === null ? (
                  <Empty>no CI for this {label}</Empty>
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <Badge tone={ciTone(ci.status)}>{ci.status}</Badge>
                    {ci.jobs.length > 0 && (
                      <span className="tabular-nums">
                        {ci.jobs.length} job{ci.jobs.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                )}
              </Section>

              <Section label="Review">
                {r ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge>
                    {r.overall != null && (
                      <span className="tabular-nums text-zinc-300">score {r.overall}</span>
                    )}
                    <Badge tone={testTone(r.testStatus)}>tests {r.testStatus}</Badge>
                    {r.stale && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <TriangleAlert size={10} strokeWidth={2.5} />
                        stale{r.commitsBehind ? ` ${r.commitsBehind}↓` : ''}
                      </span>
                    )}
                  </div>
                ) : (
                  <Empty>Not reviewed</Empty>
                )}
              </Section>

              {findings.length > 0 && (
                <Section label={`Findings · ${findings.length}`}>
                  <div className="space-y-1">
                    {findings.slice(0, FINDINGS_SHOWN).map((f, i) => (
                      <div key={f.id ?? i} className="flex items-start gap-2 text-[11.5px]">
                        <Badge tone={sevTone(String(f.severity ?? ''))}>
                          {String(f.severity ?? '—')}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-zinc-400">
                          {f.title || f.text || f.body || f.id || 'finding'}
                        </span>
                      </div>
                    ))}
                    {findings.length > FINDINGS_SHOWN && (
                      <div className="text-[10px] text-zinc-600">
                        +{findings.length - FINDINGS_SHOWN} more in the {label}s tab
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {ticket && (
                <Section label="Linked ticket">
                  <div className="truncate text-[11.5px] text-zinc-400">
                    <span className="font-mono text-zinc-500">
                      {ticket.externalKey || String(ticket.id).padStart(4, '0')}
                    </span>{' '}
                    {ticket.title}
                  </div>
                </Section>
              )}

              <Section label="Description">
                {detail.description.trim() ? (
                  <Markdown className="text-[12px] text-[var(--gt-text-soft)]">
                    {detail.description}
                  </Markdown>
                ) : (
                  <Empty>No description</Empty>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
