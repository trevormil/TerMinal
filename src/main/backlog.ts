import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'

// Per-repo backlog: <repoRoot>/backlog/NNNN-slug.md with YAML frontmatter.

export type Ticket = {
  slug: string
  id: number
  title: string
  status: string
  priority: string
  horizon: string
  hitl: boolean
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

function toTicket(slug: string, md: string): Ticket {
  const { fm, body } = parseFrontmatter(md)
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : [])
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    slug,
    id: Number(fm.id) || 0,
    title: str(fm.title) || slug,
    status: str(fm.status) || 'open',
    priority: str(fm.priority) || 'medium',
    horizon: str(fm.horizon) || 'now',
    hitl: fm.hitl === 'true' || fm.hitl === true,
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
    // Tickets are NNNN-slug.md — a leading digit excludes README.md, EXAMPLE.md, etc.
    if (!/^\d/.test(f) || !f.endsWith('.md')) continue
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

// In-place edit of a ticket's frontmatter fields (status/priority), preserving
// everything else. Scoped to the frontmatter block so body text can't match.
export function updateTicket(
  repoRoot: string,
  slug: string,
  patch: { status?: string; priority?: string },
): boolean {
  const safe = slug.replace(/[^\w-]/g, '')
  const p = join(backlogDir(repoRoot), `${safe}.md`)
  if (!existsSync(p)) return false
  let md: string
  try {
    md = readFileSync(p, 'utf8')
  } catch {
    return false
  }
  const m = md.match(/^(---\n[\s\S]*?\n---)([\s\S]*)$/)
  if (!m) return false
  let fm = m[1]
  const setField = (key: string, val: string) => {
    const re = new RegExp(`^(${key}:[ \\t]*).*$`, 'm')
    if (re.test(fm)) fm = fm.replace(re, `$1${val}`)
    else fm = fm.replace(/\n---$/, `\n${key}: ${val}\n---`)
  }
  if (patch.status) setField('status', patch.status)
  if (patch.priority) setField('priority', patch.priority)
  setField('updated', today())
  try {
    writeFileSync(p, fm + m[2])
    return true
  } catch {
    return false
  }
}

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
    horizon: 'now',
    hitl: false,
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
    `horizon: ${t.horizon}`,
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
