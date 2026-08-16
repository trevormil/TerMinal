import { useState } from 'react'
import { GitPullRequest, Circle, TriangleAlert } from 'lucide-react'
import { Empty } from '../../components/ui/display'
import { Badge } from '../../components/ui/badge'
import type { Plugin, MrListResult } from '../../lib/types'
import { prsView, type PrRow } from './model'
import { PrModal } from './PrModal'

// CI-state glyph, in the Tickets widget's glyph language: green dot = tests
// pass, alarm triangle = fail, quiet dot = no signal yet (no review artifact).
function Dot({ ci }: { ci: PrRow['ci'] }) {
  if (ci === 'pass')
    return <Circle size={12} strokeWidth={2.25} className="text-[var(--gt-green)]" />
  if (ci === 'fail')
    return <TriangleAlert size={12} strokeWidth={2.25} className="text-[var(--gt-red)]" />
  return <Circle size={12} strokeWidth={2.25} className="text-muted-foreground" />
}

// Verdict → variant: approve success / request-changes warning / blocked
// destructive.
const verdictBadgeVariant = (v: string) =>
  v === 'approve' ? 'success' : v === 'request-changes' ? 'warning' : v === 'blocked' ? 'destructive' : 'secondary'
const verdictShort = (v: string) => (v === 'request-changes' ? 'changes' : v)

// Proper component (not inline render JSX) so paging + modal state survive the
// poll-driven re-renders (mirrors the Tickets widget).
function PrsWidget({ data }: { data: MrListResult | null }) {
  const [pages, setPages] = useState(1)
  const [openIid, setOpenIid] = useState<number | null>(null)
  if (!data) return null
  if (data.error) return <Empty>{data.error}</Empty>
  const v = prsView(data.mrs, pages)
  if (!v.total && !v.done) return <Empty>No PRs / MRs</Empty>
  return (
    <>
      <div className="space-y-0.5">
        {v.rows.map((r) => (
          <button
            key={r.iid}
            type="button"
            onClick={() => setOpenIid(r.iid)}
            title={`#${r.iid} ${r.title}${r.draft ? ' (draft)' : ''} · ${r.branch}`}
            className="group/row flex w-full cursor-pointer items-center gap-1.5 text-left text-[11.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
          >
            <span className="shrink-0 text-[10px]">
              <Dot ci={r.ci} />
            </span>
            <span
              className={`min-w-0 flex-1 truncate transition-colors ${r.draft ? 'text-muted-foreground group-hover/row:text-foreground/80' : 'text-foreground group-hover/row:text-foreground'}`}
            >
              <span className="tabular-nums text-muted-foreground">#{r.iid}</span> {r.title}
            </span>
            <span className="max-w-[90px] shrink-0 truncate font-mono text-[9px] text-muted-foreground">
              {r.branch}
            </span>
            {r.verdict && (
              <Badge variant={verdictBadgeVariant(r.verdict)} className="shrink-0 px-1 text-[8.5px]">
                {verdictShort(r.verdict)}
              </Badge>
            )}
          </button>
        ))}
        {(v.overflow > 0 || pages > 1) && (
          <div className="flex items-center gap-2">
            {v.overflow > 0 && (
              <button
                type="button"
                onClick={() => setPages((p) => p + 1)}
                className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
              >
                +{v.overflow} more
              </button>
            )}
            {pages > 1 && (
              <button
                type="button"
                onClick={() => setPages(1)}
                className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
              >
                Show less
              </button>
            )}
          </div>
        )}
        {v.done > 0 && <div className="text-[10px] text-muted-foreground">▸ {v.done} merged/closed</div>}
      </div>
      {openIid !== null && <PrModal iid={openIid} onClose={() => setOpenIid(null)} />}
    </>
  )
}

// The repo's open PRs/MRs, sibling of the Tickets widget: open first with a
// CI glyph + review-verdict badge per row, merged/closed collapsed to a count,
// click → light read-only modal (full flow lives in the MRs tab).
const plugin: Plugin<MrListResult> = {
  id: 'mr-summary', // kept from the count-only ancestor so saved widget order/visibility survive
  title: 'PRs / MRs',
  icon: GitPullRequest,
  blurb: 'Open PRs/MRs with CI + review verdict per row; click for a light detail modal.',
  // Hosted by the work column's accordion, which orders its sections itself
  // (SECTION_PLUGIN_IDS) — right after Tickets, as it was in the widget stack.
  order: -0.5,
  intervalMs: 60_000,
  defaultEnabled: true,
  poll: (gt) => gt.listMrs(),
  render: (d) => <PrsWidget data={d} />,
  // Open PRs/MRs. An errored poll counts nothing — the section header stays
  // bare and the error shows once, in the body.
  count: (d) => (d && !d.error ? prsView(d.mrs).open : null),
}
export default plugin
