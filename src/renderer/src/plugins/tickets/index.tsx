import { useState } from 'react'
import { Ticket as TicketIcon, CircleDot, Circle, TriangleAlert } from 'lucide-react'
import { Card, Empty } from '../../components/ui'
import type { Plugin, Ticket } from '../../lib/types'
import { ticketsView } from './model'
import { TicketModal } from './TicketModal'

function Dot({ status }: { status: string }) {
  if (status === 'in-progress')
    return <CircleDot size={12} strokeWidth={2.25} className="gt-pulse text-[var(--gt-yellow)]" />
  if (status === 'stuck')
    return <TriangleAlert size={12} strokeWidth={2.25} className="text-[var(--gt-red)]" />
  return <Circle size={12} strokeWidth={2.25} className="text-zinc-600" />
}

// Proper component (not inline render JSX) so paging + modal state survive the
// poll-driven re-renders.
function TicketsWidget({ data }: { data: Ticket[] | null }) {
  const [pages, setPages] = useState(1)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const v = ticketsView(data || [], pages)
  if (!v.total && !v.closed)
    return (
      <Card icon={TicketIcon} title="Tickets">
        <Empty>No tickets</Empty>
      </Card>
    )
  return (
    <Card
      icon={TicketIcon}
      title="Tickets"
      right={
        <span className="text-[9px] tabular-nums text-zinc-600">
          {v.active}/{v.total} active
        </span>
      }
    >
      <div className="space-y-0.5">
        {v.rows.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => setOpenSlug(t.slug)}
            title={`${t.key} ${t.title}`}
            className="group flex w-full cursor-pointer items-center gap-1.5 text-left text-[11.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
          >
            <span className="shrink-0 text-[10px]">
              <Dot status={t.status} />
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${t.status === 'in-progress' ? 'text-zinc-100 group-hover:text-white' : 'text-zinc-400 group-hover:text-zinc-100'}`}
            >
              <span className="tabular-nums text-zinc-500">{t.key}</span> {t.title}
            </span>
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
        {v.closed > 0 && <div className="text-[10px] text-zinc-600">▸ {v.closed} closed</div>}
      </div>
      {openSlug && <TicketModal slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </Card>
  )
}

// The repo's ticket backlog, OpenCode-style: in-progress pulsing on top, then
// stuck, then open; closed + icebox collapsed to a count. Works for every
// provider (local/github/linear/obsidian all normalize to the same shape).
const plugin: Plugin<Ticket[]> = {
  id: 'tickets',
  title: 'Tickets',
  icon: TicketIcon,
  blurb: 'The repo ticket backlog — in-progress first, closed collapsed to a count.',
  // First in the cockpit's default order — strictly below every other built-in
  // (session is 0, command widgets default to 50). Saved user orders still win.
  order: -1,
  intervalMs: 5000,
  defaultEnabled: true,
  poll: (gt) => gt.tickets.list(),
  render: (d) => <TicketsWidget data={d} />,
}
export default plugin
