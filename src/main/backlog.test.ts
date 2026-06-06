import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTicket, listTickets } from './backlog'

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
})
