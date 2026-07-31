import { test, expect, describe } from 'bun:test'
import { agentDefinitionId, ticketAgentDiffers } from './ticketOwner'
import type { TicketAgent } from './types'

const owner: TicketAgent = { id: 'backend-dev', scope: 'repo', kind: 'classic' }

describe('ticketAgentDiffers', () => {
  test('recommending the owner you already have is silence', () => {
    expect(ticketAgentDiffers(owner, { ...owner })).toBe(false)
  })

  test('a different agent id is worth surfacing', () => {
    expect(ticketAgentDiffers(owner, { ...owner, id: 'frontend-dev' })).toBe(true)
  })

  test('same id, different scope is a different agent', () => {
    // A repo-local `backend-dev` and the global one are two separate agents
    // with two separate scripts — treating them as equal would silently
    // suppress a real re-route.
    expect(ticketAgentDiffers(owner, { ...owner, scope: 'global' })).toBe(true)
  })

  test('same id, different kind is a different agent', () => {
    expect(ticketAgentDiffers(owner, { ...owner, kind: 'persistent' })).toBe(true)
  })

  test('an unowned ticket always shows the recommendation', () => {
    expect(ticketAgentDiffers(undefined, owner)).toBe(true)
    expect(ticketAgentDiffers({ id: '', scope: 'repo', kind: 'classic' }, owner)).toBe(true)
  })
})

describe('agentDefinitionId', () => {
  test('classic agents keep their own scope', () => {
    expect(agentDefinitionId(owner)).toBe('classic:repo:backend-dev')
    expect(agentDefinitionId({ ...owner, scope: 'global' })).toBe('classic:global:backend-dev')
  })

  test('persistent agents are always global, whatever the ticket claims', () => {
    // main only ever emits `persistent:global:<id>`; a ticket carrying
    // scope: 'repo' on a persistent agent must not produce an id that matches
    // nothing in the Agents tab.
    expect(agentDefinitionId({ id: 'archivist', scope: 'repo', kind: 'persistent' })).toBe(
      'persistent:global:archivist',
    )
    expect(agentDefinitionId({ id: 'archivist', scope: 'global', kind: 'persistent' })).toBe(
      'persistent:global:archivist',
    )
  })
})
