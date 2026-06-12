import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTicket, listTickets, recommendTicketAgent, updateTicket } from './backlog'

const ticketMd = (id: number, title: string) =>
  `---\nid: ${id}\ntitle: "${title}"\nstatus: open\npriority: medium\ntype: feature\n---\n\nbody\n`

describe('listTickets', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gt-backlog-'))
    mkdirSync(join(root, 'backlog'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (name: string, content: string) =>
    writeFileSync(join(root, 'backlog', name), content)

  test('recommends ticket agents from type and content signals', () => {
    expect(recommendTicketAgent({ type: 'feature', title: 'Build generic feature' }).agent.id).toBe('1000x-ai-engineer')
    expect(recommendTicketAgent({ type: 'feature', title: 'Fix auth token leak' }).agent.id).toBe('security-sweep')
    expect(recommendTicketAgent({ type: 'bug', body: 'Flaky tests need better coverage' }).agent.id).toBe('test-coverage')
    expect(recommendTicketAgent({ type: 'docs', title: 'Document setup' }).agent.id).toBe('docs')
  })

  test('only counts NNNN-slug.md ticket files', () => {
    write('0001-real-ticket.md', ticketMd(1, 'Real ticket'))
    write('0002-another.md', ticketMd(2, 'Another'))
    write('README.md', '# Backlog\n\nThis is not a ticket.\n')
    write('EXAMPLE.md', ticketMd(999, 'Example'))
    write('notes.txt', 'scratch')

    const tickets = listTickets(root)
    expect(tickets.map((t) => t.id).sort((a, b) => a - b)).toEqual([1, 2])
    // README.md / EXAMPLE.md / notes.txt must not slip in as tickets.
    expect(tickets.some((t) => t.slug === 'README')).toBe(false)
    expect(tickets.some((t) => t.slug === 'EXAMPLE')).toBe(false)
  })

  test('empty backlog dir → []', () => {
    expect(listTickets(root)).toEqual([])
  })

  test('missing backlog dir → []', () => {
    expect(listTickets(join(root, 'nonexistent'))).toEqual([])
  })

  test('reads v2 tickets under .TerMinal/backlog', () => {
    const v2 = mkdtempSync(join(tmpdir(), 'gt-backlog-v2-'))
    try {
      mkdirSync(join(v2, '.TerMinal', 'backlog'), { recursive: true })
      writeFileSync(join(v2, '.TerMinal', 'template.json'), '{"version":2}\n')
      writeFileSync(join(v2, '.TerMinal', 'backlog', '0003-v2.md'), ticketMd(3, 'V2 ticket'))
      expect(listTickets(v2).map((t) => t.id)).toEqual([3])
    } finally {
      rmSync(v2, { recursive: true, force: true })
    }
  })

  test('creates new tickets in v2 layout when marker exists', () => {
    const v2 = mkdtempSync(join(tmpdir(), 'gt-backlog-v2-write-'))
    try {
      mkdirSync(join(v2, '.TerMinal'), { recursive: true })
      writeFileSync(join(v2, '.TerMinal', 'template.json'), '{"version":2}\n')
      const t = createTicket(v2, { title: 'Write v2 ticket', type: 'feature', priority: 'medium', status: 'open', body: '' })
      expect(existsSync(join(v2, '.TerMinal', 'backlog', `${t.slug}.md`))).toBe(true)
      expect(existsSync(join(v2, 'backlog', `${t.slug}.md`))).toBe(false)
    } finally {
      rmSync(v2, { recursive: true, force: true })
    }
  })

  test('created tickets include an assigned agent and explicit assignments round-trip', () => {
    const v2 = mkdtempSync(join(tmpdir(), 'gt-backlog-agent-'))
    try {
      mkdirSync(join(v2, '.TerMinal'), { recursive: true })
      writeFileSync(join(v2, '.TerMinal', 'template.json'), '{"version":2}\n')
      const t = createTicket(v2, {
        title: 'Document setup',
        type: 'docs',
        priority: 'medium',
        status: 'open',
        body: '',
      })
      expect(t.agent).toEqual({ id: 'docs', scope: 'global', kind: 'classic' })
      expect(listTickets(v2)[0].agent).toEqual({ id: 'docs', scope: 'global', kind: 'classic' })

      const generic = createTicket(v2, {
        title: 'Build generic feature',
        type: 'feature',
        priority: 'medium',
        status: 'open',
        body: '',
      })
      expect(generic.agent).toEqual({ id: '1000x-ai-engineer', scope: 'global', kind: 'classic' })

      expect(updateTicket(v2, t.slug, { agent: { id: 'repo-runner', scope: 'repo', kind: 'classic' } })).toBe(true)
      expect(listTickets(v2).find((x) => x.slug === t.slug)?.agent).toEqual({ id: 'repo-runner', scope: 'repo', kind: 'classic' })
    } finally {
      rmSync(v2, { recursive: true, force: true })
    }
  })

  test('acceptance criteria round-trip as a block list (commas preserved)', () => {
    const v2 = mkdtempSync(join(tmpdir(), 'gt-backlog-accept-'))
    try {
      mkdirSync(join(v2, '.TerMinal'), { recursive: true })
      writeFileSync(join(v2, '.TerMinal', 'template.json'), '{"version":2}\n')
      const t = createTicket(v2, {
        title: 'Rate limit join',
        type: 'feature',
        priority: 'high',
        status: 'open',
        body: '',
      })
      // Fresh ticket has an empty acceptance list.
      expect(listTickets(v2)[0].acceptance).toEqual([])

      const criteria = [
        'join endpoint returns 429 over the rate limit',
        'limit configurable via env, default 60/min', // comma must survive
        'existing auth tests still pass',
      ]
      expect(updateTicket(v2, t.slug, { acceptance: criteria })).toBe(true)
      // Block-list round-trip: the comma in criterion 2 is NOT split.
      expect(listTickets(v2)[0].acceptance).toEqual(criteria)

      // Editing again replaces the whole block (no orphaned lines).
      expect(updateTicket(v2, t.slug, { acceptance: ['only one now'] })).toBe(true)
      expect(listTickets(v2)[0].acceptance).toEqual(['only one now'])

      // Clearing writes an empty list.
      expect(updateTicket(v2, t.slug, { acceptance: [] })).toBe(true)
      expect(listTickets(v2)[0].acceptance).toEqual([])
    } finally {
      rmSync(v2, { recursive: true, force: true })
    }
  })

  test('ticket run links round-trip through frontmatter updates', () => {
    const v2 = mkdtempSync(join(tmpdir(), 'gt-backlog-run-'))
    try {
      mkdirSync(join(v2, '.TerMinal'), { recursive: true })
      writeFileSync(join(v2, '.TerMinal', 'template.json'), '{"version":2}\n')
      const t = createTicket(v2, {
        title: 'Implement observability',
        type: 'feature',
        priority: 'medium',
        status: 'open',
        body: '',
      })

      expect(
        updateTicket(v2, t.slug, {
          run: {
            id: 'run-123',
            source: 'agent',
            sessionId: 'session-abc',
            startedAt: '2026-06-08T12:00:00.000Z',
            status: 'running',
          },
        }),
      ).toBe(true)

      expect(listTickets(v2)[0].run).toEqual({
        id: 'run-123',
        source: 'agent',
        sessionId: 'session-abc',
        startedAt: '2026-06-08T12:00:00.000Z',
        status: 'running',
      })
    } finally {
      rmSync(v2, { recursive: true, force: true })
    }
  })
})
