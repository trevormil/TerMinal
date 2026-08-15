import { describe, expect, test } from 'bun:test'
import { ticketImplementationPrompt } from './agentPrompts'
import type { Ticket, TicketComment } from './types'

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 42,
    title: 'Rate limit the join endpoint',
    body: 'Return 429 over the limit.',
    provider: 'local',
    comments: [],
    ...over,
  }) as Ticket

const comment = (over: Partial<TicketComment> = {}): TicketComment => ({
  at: '2026-07-27T14:00:00.000Z',
  author: 'trevor',
  kind: 'human',
  body: 'note',
  ...over,
})

describe('ticketImplementationPrompt', () => {
  test('carries the ticket body and reference', () => {
    const p = ticketImplementationPrompt(ticket())
    expect(p).toContain('Return 429 over the limit.')
    expect(p).toContain('#42')
  })

  // The whole point of the log: a prior run's findings must reach the next run,
  // or the context dies with the run that learned it.
  test('includes prior log entries so a later run inherits the context', () => {
    const p = ticketImplementationPrompt(
      ticket({
        comments: [
          comment({ body: 'redis is not available in CI' }),
          comment({
            author: 'pr-creation',
            kind: 'agent',
            via: 'codex/gpt-5',
            body: 'in-memory bucket works',
          }),
        ],
      }),
    )
    expect(p).toContain('redis is not available in CI')
    expect(p).toContain('in-memory bucket works')
    expect(p).toContain('trevor')
    expect(p).toContain('pr-creation')
  })

  test('a ticket with no log adds no log section at all', () => {
    expect(ticketImplementationPrompt(ticket())).not.toMatch(/prior (log|notes)/i)
  })

  test('a ticket whose comments field is absent does not crash', () => {
    const t = ticket()
    delete (t as { comments?: unknown }).comments
    expect(() => ticketImplementationPrompt(t)).not.toThrow()
  })

  // Reachability: the agent has to be told the tool exists, or nothing writes.
  test('tells the agent to record findings back onto the ticket', () => {
    expect(ticketImplementationPrompt(ticket())).toContain('comment_ticket')
  })
})
