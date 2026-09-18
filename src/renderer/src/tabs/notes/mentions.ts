import type { Ticket } from '../../lib/types'
type MentionTicket = Pick<Ticket, 'slug'> &
  Partial<Pick<Ticket, 'externalKey' | 'linear' | 'provider' | 'url'>>
export function mentionedTickets<T extends MentionTicket>(content: string, tickets: T[]): T[] {
  const tokens = new Set(content.match(/[A-Za-z0-9_-]+/g) || [])
  return tickets.filter((ticket) =>
    [ticket.slug.replace(/\.md$/, ''), ticket.externalKey, ticket.linear?.identifier].some(
      (key) => key && tokens.has(key),
    ),
  )
}
export function ticketMentionNavigation(ticket: MentionTicket): Record<string, unknown> {
  return {
    slug: ticket.slug,
    ...(ticket.provider === 'linear' && ticket.url ? { viewUrl: ticket.url } : {}),
  }
}
