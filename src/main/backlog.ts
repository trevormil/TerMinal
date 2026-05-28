import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Per-repo backlog: <repoRoot>/backlog/NNNN-slug.md with YAML frontmatter.
// Minimal parser/writer for the known flat schema (scalars + string arrays) —
// no YAML dep needed.

export type Ticket = {
  slug: string
  id: number
  title: string
  status: string
  priority: string
  type: string
  source: string
  created: string
  updated: string
  prs: string[]
  refs: string[]
  body: string
}

export type NewTicket = {
  title: string
  type: string
  priority: string
  status: string
  body: string
}

function backlogDir(repoRoot: string): string {
  return join(repoRoot, 'backlog')
}

function parse(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: md }
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([\w-]+):\s*(.*)$/)
    if (!mm) continue
    const [, key, rawVal] = mm
    const val = rawVal.trim()
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      fm[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return { fm, body: m[2] }
}

function toTicket(slug: string, md: string): Ticket {
  const { fm, body } = parse(md)
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : [])
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    slug,
    id: Number(fm.id) || 0,
    title: str(fm.title) || slug,
    status: str(fm.status) || 'open',
    priority: str(fm.priority) || 'medium',
    type: str(fm.type) || 'feature',
    source: str(fm.source),
    created: str(fm.created),
    updated: str(fm.updated),
    prs: arr(fm.prs),
    refs: arr(fm.refs),
    body: body.trim(),
  }
}

export function listTickets(repoRoot: string): Ticket[] {
  const dir = backlogDir(repoRoot)
  if (!existsSync(dir)) return []
  const out: Ticket[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f === 'EXAMPLE.md') continue
    try {
      out.push(toTicket(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')))
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => b.id - a.id)
}

export function getTicket(repoRoot: string, slug: string): Ticket | null {
  const safe = slug.replace(/[^\w-]/g, '')
  const p = join(backlogDir(repoRoot), `${safe}.md`)
  if (!existsSync(p)) return null
  return toTicket(safe, readFileSync(p, 'utf8'))
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'ticket'
  )
}

const today = () => new Date().toISOString().slice(0, 10)

export function createTicket(repoRoot: string, input: NewTicket): Ticket {
  const dir = backlogDir(repoRoot)
  if (!existsSync(dir)) throw new Error('no backlog/ in this repo')
  const nextId = listTickets(repoRoot).reduce((max, t) => Math.max(max, t.id), 0) + 1
  const num = String(nextId).padStart(4, '0')
  const slug = `${num}-${slugify(input.title)}`
  const t: Ticket = {
    slug,
    id: nextId,
    title: input.title,
    status: input.status || 'open',
    priority: input.priority || 'medium',
    type: input.type || 'feature',
    source: 'gauntlet-terminal',
    created: today(),
    updated: today(),
    prs: [],
    refs: [],
    body: input.body || '',
  }
  const fm = [
    '---',
    `id: ${t.id}`,
    `title: "${t.title.replace(/"/g, "'")}"`,
    `status: ${t.status}`,
    `priority: ${t.priority}`,
    `type: ${t.type}`,
    `source: ${t.source}`,
    `created: ${t.created}`,
    `updated: ${t.updated}`,
    `prs: []`,
    `refs: []`,
    '---',
    '',
    t.body.trim(),
    '',
  ].join('\n')
  writeFileSync(join(dir, `${slug}.md`), fm)
  return t
}
