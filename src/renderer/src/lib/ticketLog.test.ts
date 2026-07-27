import { describe, expect, test } from 'bun:test'
import { groupLogEntries } from './ticketLog'
import type { TicketComment } from './types'

const at = (min: number) => new Date(Date.UTC(2026, 6, 27, 12, min)).toISOString()
const c = (over: Partial<TicketComment> & { at: string }): TicketComment => ({
  author: 'trevor',
  kind: 'human',
  body: 'x',
  ...over,
})

describe('groupLogEntries', () => {
  test('an empty log has no blocks', () => {
    expect(groupLogEntries([])).toEqual([])
  })

  test('consecutive entries from one author collapse into a single block', () => {
    const blocks = groupLogEntries([c({ at: at(0) }), c({ at: at(2) }), c({ at: at(4) })])
    expect(blocks.length).toBe(1)
    expect(blocks[0].author).toBe('trevor')
    expect(blocks[0].entries.length).toBe(3)
  })

  test('a different author starts a new block', () => {
    const blocks = groupLogEntries([
      c({ at: at(0) }),
      c({ at: at(1), author: 'docs', kind: 'agent' }),
      c({ at: at(2) }),
    ])
    expect(blocks.map((b) => b.author)).toEqual(['trevor', 'docs', 'trevor'])
    expect(blocks[1].kind).toBe('agent')
  })

  // Two notes an hour apart are two moments, even from the same person —
  // collapsing them would misrepresent when the work happened.
  test('a long gap starts a new block even for the same author', () => {
    const blocks = groupLogEntries([c({ at: at(0) }), c({ at: at(45) })])
    expect(blocks.length).toBe(2)
  })

  test('the same author on a different engine is a different voice, so a new block', () => {
    const blocks = groupLogEntries([
      c({ at: at(0), author: 'docs', kind: 'agent', via: 'codex/gpt-5' }),
      c({ at: at(1), author: 'docs', kind: 'agent', via: 'claude/opus' }),
    ])
    expect(blocks.length).toBe(2)
    expect(blocks.map((b) => b.via)).toEqual(['codex/gpt-5', 'claude/opus'])
  })

  test('a block is stamped with its first entry, so the header reads as its start', () => {
    const blocks = groupLogEntries([c({ at: at(0) }), c({ at: at(3) })])
    expect(blocks[0].at).toBe(at(0))
  })

  test('every entry survives grouping exactly once, in order', () => {
    const input = [
      c({ at: at(0), body: 'a' }),
      c({ at: at(1), body: 'b', author: 'docs', kind: 'agent' }),
      c({ at: at(2), body: 'c' }),
      c({ at: at(90), body: 'd' }),
    ]
    const flat = groupLogEntries(input).flatMap((b) => b.entries)
    expect(flat.map((e) => e.body)).toEqual(['a', 'b', 'c', 'd'])
  })
})
