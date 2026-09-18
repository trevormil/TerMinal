import { useEffect, useState } from 'react'
import { navigateTo } from '../../lib/nav'
import type { Ticket } from '../../lib/types'
import { mentionedTickets, ticketMentionNavigation } from './mentions'

export function TicketMentions({ content, repoRoot }: { content: string; repoRoot: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  useEffect(() => {
    let alive = true
    setTickets([])
    if (repoRoot)
      window.gt.tickets
        .list()
        .then((items) => {
          if (alive) setTickets(items)
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [repoRoot])
  const matches = mentionedTickets(content, tickets)
  if (!matches.length) return null
  return (
    <nav
      aria-label="Mentioned tickets"
      className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-xs text-zinc-400"
    >
      <span>Mentioned tickets</span>
      {matches.map((ticket) => (
        <button
          key={ticket.slug}
          className="rounded border border-[var(--gt-border)] px-2 py-1 hover:text-white"
          onClick={() => navigateTo('tickets', ticketMentionNavigation(ticket))}
        >
          {ticket.externalKey || ticket.slug} · {ticket.title}
        </button>
      ))}
    </nav>
  )
}
