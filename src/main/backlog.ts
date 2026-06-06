import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'
import {
  ensureProjectArea,
  existingProjectAreaPaths,
  projectAreaPathForRead,
  projectAreaPathForWrite,
  projectAreaRelForPath,
} from './project-layout'

// Per-repo backlog. v2 repos store tickets in .TerMinal/backlog; v1 repos
// store them in backlog/. Reads check both layouts so old repos keep working.

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
  depends_on: number[] // ticket ids this one is blocked by (parsed from frontmatter)
  body: string
}

export type NewTicket = {
  title: string
  type: string
  priority: string
  status: string
  body: string
}

export function backlogDir(repoRoot: string): string {
  return projectAreaPathForRead(repoRoot, 'backlog')
}

export function backlogRel(repoRoot: string): string {
  return projectAreaRelForPath(repoRoot, 'backlog', backlogDir(repoRoot))
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
    depends_on: depsArr(fm.depends_on),
    body: body.trim(),
  }
}

// depends_on is a list of ticket IDs (numbers). YAML may parse them as
// numbers or as strings ("0042"); coerce either way and drop anything that
// isn't a positive integer.
function depsArr(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v) {
    const n = typeof x === 'number' ? x : typeof x === 'string' ? parseInt(x, 10) : NaN
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

export function listTickets(repoRoot: string): Ticket[] {
  const out: Ticket[] = []
  for (const dir of existingProjectAreaPaths(repoRoot, 'backlog')) {
    for (const f of readdirSync(dir)) {
      // Tickets are NNNN-slug.md — a leading digit excludes README.md, EXAMPLE.md, etc.
      if (!/^\d/.test(f) || !f.endsWith('.md')) continue
      try {
        out.push(toTicket(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')))
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out.sort((a, b) => b.id - a.id)
}

export function getTicket(repoRoot: string, slug: string): Ticket | null {
  const safe = slug.replace(/[^\w-]/g, '')
  const p = existingProjectAreaPaths(repoRoot, 'backlog')
    .map((dir) => join(dir, `${safe}.md`))
    .find((candidate) => existsSync(candidate))
  if (!p) return null
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
  const p = existingProjectAreaPaths(repoRoot, 'backlog')
    .map((dir) => join(dir, `${safe}.md`))
    .find((candidate) => existsSync(candidate))
  if (!p) return false
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
  const dir = existsSync(projectAreaPathForWrite(repoRoot, 'backlog'))
    ? projectAreaPathForWrite(repoRoot, 'backlog')
    : ensureProjectArea(repoRoot, 'backlog')
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
    source: 'TerMinal',
    created: today(),
    updated: today(),
    prs: [],
    refs: [],
    depends_on: [],
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
