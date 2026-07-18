import { Ticket as TicketIcon, CircleDot, Circle, TriangleAlert } from 'lucide-react'
import { Card, Empty } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import type { Plugin, Ticket } from '../../lib/types'
import { ticketsView } from './model'

function Dot({ status }: { status: string }) {
  if (status === 'in-progress')
    return <CircleDot size={12} strokeWidth={2.25} className="gt-pulse text-[var(--gt-yellow)]" />
  if (status === 'stuck')
    return <TriangleAlert size={12} strokeWidth={2.25} className="text-[var(--gt-red)]" />
  return <Circle size={12} strokeWidth={2.25} className="text-zinc-600" />
}

// Deep-link into the Tickets tab (replay once — the receiver mounts after the
// tab switches; mirrors the tdd/mr-summary widgets).
const openTicket = (slug: string) => {
  navigateTo('tickets', { slug })
  setTimeout(() => navigateTo('tickets', { slug }), 50)
}

// The repo's ticket backlog, OpenCode-style: in-progress pulsing on top, then
// stuck, then open; closed + icebox collapsed to a count. Works for every
// provider (local/github/linear/obsidian all normalize to the same shape).
const plugin: Plugin<Ticket[]> = {
  id: 'tickets',
  title: 'Tickets',
  icon: TicketIcon,
  blurb: 'The repo ticket backlog — in-progress first, closed collapsed to a count.',
  order: 3.5,
  intervalMs: 5000,
  defaultEnabled: true,
  poll: (gt) => gt.tickets.list(),
  render: (d) => {
    const v = ticketsView(d || [])
    if (!v.total && !v.closed)
      return (
        <Card icon={TicketIcon} title="Tickets">
          <Empty>no tickets</Empty>
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
              onClick={() => openTicket(t.slug)}
              title={`${t.key} ${t.title}`}
              className="flex w-full items-start gap-1.5 text-left text-[11.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
            >
              <span className="mt-px shrink-0 text-[10px]">
                <Dot status={t.status} />
              </span>
              <span
                className={`min-w-0 flex-1 truncate ${t.status === 'in-progress' ? 'text-zinc-100' : 'text-zinc-400'}`}
              >
                <span className="tabular-nums text-zinc-500">{t.key}</span> {t.title}
              </span>
            </button>
          ))}
          {v.overflow > 0 && <div className="text-[10px] text-zinc-600">+{v.overflow} more</div>}
          {v.closed > 0 && <div className="text-[10px] text-zinc-600">▸ {v.closed} closed</div>}
        </div>
      </Card>
    )
  },
}
export default plugin
