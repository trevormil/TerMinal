import { useState } from 'react'
import { GitPullRequest, Circle, TriangleAlert } from 'lucide-react'
import { Card, Empty, badgeClasses, type BadgeTone } from '../../components/ui'
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
  return <Circle size={12} strokeWidth={2.25} className="text-zinc-600" />
}

// Verdict → tone: approve green / request-changes amber / blocked red.
const verdictBadgeTone = (v: string): BadgeTone =>
  v === 'approve' ? 'green' : v === 'request-changes' ? 'yellow' : v === 'blocked' ? 'red' : 'mute'
const verdictShort = (v: string) => (v === 'request-changes' ? 'changes' : v)

// Proper component (not inline render JSX) so paging + modal state survive the
// poll-driven re-renders (mirrors the Tickets widget).
function PrsWidget({ data }: { data: MrListResult | null }) {
  const [pages, setPages] = useState(1)
  const [openIid, setOpenIid] = useState<number | null>(null)
  if (!data) return null
  if (data.error)
    return (
      <Card icon={GitPullRequest} title="PRs / MRs">
        <Empty>{data.error}</Empty>
      </Card>
    )
  const v = prsView(data.mrs, pages)
  if (!v.total && !v.done)
    return (
      <Card icon={GitPullRequest} title="PRs / MRs">
        <Empty>No PRs / MRs</Empty>
      </Card>
    )
  return (
    <Card
      icon={GitPullRequest}
      title="PRs / MRs"
      right={<span className="text-[9px] tabular-nums text-zinc-600">{v.open} open</span>}
    >
      <div className="space-y-0.5">
        {v.rows.map((r) => (
          <button
            key={r.iid}
            type="button"
            onClick={() => setOpenIid(r.iid)}
            title={`#${r.iid} ${r.title}${r.draft ? ' (draft)' : ''} · ${r.branch}`}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded text-left text-[11.5px] hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
          >
            <span className="shrink-0 text-[10px]">
              <Dot ci={r.ci} />
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${r.draft ? 'text-zinc-500' : 'text-zinc-100'}`}
            >
              <span className="tabular-nums text-zinc-500">#{r.iid}</span> {r.title}
            </span>
            <span className="max-w-[90px] shrink-0 truncate font-mono text-[9px] text-zinc-600">
              {r.branch}
            </span>
            {r.verdict && (
              <span
                className={`shrink-0 rounded border px-1 text-[8.5px] font-semibold uppercase tracking-wide ${badgeClasses(verdictBadgeTone(r.verdict))}`}
              >
                {verdictShort(r.verdict)}
              </span>
            )}
          </button>
        ))}
        {(v.overflow > 0 || pages > 1) && (
          <div className="flex items-center gap-2">
            {v.overflow > 0 && (
              <button
                type="button"
                onClick={() => setPages((p) => p + 1)}
                className="cursor-pointer text-[10px] text-zinc-600 hover:text-zinc-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
              >
                +{v.overflow} more
              </button>
            )}
            {pages > 1 && (
              <button
                type="button"
                onClick={() => setPages(1)}
                className="cursor-pointer text-[10px] text-zinc-600 hover:text-zinc-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
              >
                show less
              </button>
            )}
          </div>
        )}
        {v.done > 0 && <div className="text-[10px] text-zinc-600">▸ {v.done} merged/closed</div>}
      </div>
      {openIid !== null && <PrModal iid={openIid} onClose={() => setOpenIid(null)} />}
    </Card>
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
  // Second in the cockpit's default order — right after Tickets (-1), strictly
  // below every built-in on main (session is 0). Saved user orders still win.
  order: -0.5,
  intervalMs: 60_000,
  defaultEnabled: true,
  poll: (gt) => gt.listMrs(),
  render: (d) => <PrsWidget data={d} />,
}
export default plugin
