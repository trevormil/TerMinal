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
  /** Strict, checkable criteria defining a correct/best implementation.
   *  Optional in general; REQUIRED when the implementer runs >1 lane, since
   *  lanes are gated and ranked against these. See docs: lanes workflow. */
  acceptance: string[]
  /** Recommended model tier (downgrade gate): auto | top | cheap-agentic | cheap-raw. */
  modelTier: string
  /** Model(s) that authored the implementation, stamped when the MR opens. */
  workedBy: string[]
  agent: TicketAgent
  run?: TicketRunLink
  body: string
  provider?: 'local' | 'github' | 'linear'
  providerLabel?: string
  externalId?: string
  externalKey?: string
  url?: string
}

export type TicketAgent = {
  id: string
  scope: 'repo' | 'global'
  kind: 'classic' | 'persistent'
}

export type TicketAgentRecommendation = {
  agent: TicketAgent
  reason: string
  signals: string[]
}

export type TicketRunLink = {
  id: string
  source: 'agent' | 'cron' | 'bg' | 'session'
  sessionId?: string
  startedAt?: string
  status?: string
}

export type TicketPatch = {
  status?: string
  priority?: string
  acceptance?: string[]
  /** Replaces the `prs:` list wholesale. Callers that mean "add a PR" must
   *  read the ticket and merge first — see `linkTicketPr`. */
  prs?: string[]
  agent?: Partial<TicketAgent>
  run?: Partial<TicketRunLink>
}

export type NewTicket = {
  title: string
  type: string
  priority: string
  status: string
  body: string
  acceptance?: string[]
  agent?: Partial<TicketAgent>
}

export type TicketAgentRecommendationInput = {
  title?: string
  type?: string
  body?: string
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
  const type = str(fm.type) || 'feature'
  return {
    slug,
    id: Number(fm.id) || 0,
    title: str(fm.title) || slug,
    status: str(fm.status) || 'open',
    priority: str(fm.priority) || 'medium',
    horizon: str(fm.horizon) || 'now',
    hitl: fm.hitl === 'true' || fm.hitl === true,
    type,
    source: str(fm.source),
    created: str(fm.created),
    updated: str(fm.updated),
    prs: arr(fm.prs),
    refs: arr(fm.refs),
    depends_on: depsArr(fm.depends_on),
    acceptance: arr(fm.acceptance),
    modelTier: str(fm.model_tier) || 'auto',
    workedBy: Array.isArray(fm.worked_by)
      ? (fm.worked_by as unknown[]).map(String)
      : str(fm.worked_by) ? [str(fm.worked_by)] : [],
    agent: ticketAgentFromFrontmatter(fm, type),
    run: ticketRunFromFrontmatter(fm),
    body: body.trim(),
    provider: 'local',
    providerLabel: 'Local backlog',
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

export function defaultTicketAgent(type = 'feature'): TicketAgent {
  return recommendTicketAgent({ type }).agent
}

const ROUTES: {
  agent: TicketAgent
  reason: string
  type?: string[]
  keywords: string[]
}[] = [
  {
    agent: { id: 'security-sweep', scope: 'global', kind: 'classic' },
    reason: 'Security-sensitive wording or ticket type should go to the security sweep specialist.',
    type: ['security'],
    keywords: ['security', 'auth', 'authorization', 'permission', 'xss', 'csrf', 'ssrf', 'injection', 'secret', 'token', 'cve', 'vulnerability'],
  },
  {
    agent: { id: 'test-coverage', scope: 'global', kind: 'classic' },
    reason: 'Testing and coverage work should go to the test-coverage specialist.',
    type: ['testing'],
    keywords: ['test', 'tests', 'testing', 'coverage', 'spec', 'flaky', 'assertion', 'tdd'],
  },
  {
    agent: { id: 'docs', scope: 'global', kind: 'classic' },
    reason: 'Documentation work should go to the docs specialist.',
    type: ['docs'],
    keywords: ['docs', 'documentation', 'readme', 'runbook', 'adr', 'changelog', 'guide'],
  },
  {
    agent: { id: 'perf-pass', scope: 'global', kind: 'classic' },
    reason: 'Performance-sensitive work should go to the performance specialist.',
    type: ['performance'],
    keywords: ['performance', 'perf', 'latency', 'slow', 'memory', 'n+1', 'cache', 'optimize', 'profiling'],
  },
  {
    agent: { id: 'ci-improver', scope: 'global', kind: 'classic' },
    reason: 'Developer workflow, CI, and tooling work should go to the CI/DX specialist.',
    type: ['dx'],
    keywords: ['ci', 'lint', 'typecheck', 'build failure', 'workflow', 'developer', 'devex', 'tooling', 'script'],
  },
]

export function recommendTicketAgent(input: TicketAgentRecommendationInput = {}): TicketAgentRecommendation {
  const type = (input.type || 'feature').toLowerCase()
  const text = `${input.title || ''}\n${input.body || ''}`.toLowerCase()
  const scored = ROUTES.map((route) => {
    const signals: string[] = []
    if (route.type?.includes(type)) signals.push(`type:${type}`)
    for (const keyword of route.keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)) signals.push(keyword)
    }
    return { route, signals }
  }).filter((x) => x.signals.length > 0)

  if (scored.length > 0) {
    scored.sort((a, b) => b.signals.length - a.signals.length)
    const top = scored[0]
    return { agent: top.route.agent, reason: top.route.reason, signals: top.signals.slice(0, 5) }
  }
  return {
    agent: { id: '1000x-ai-engineer', scope: 'global', kind: 'classic' },
    reason: 'General feature, bug, UX, or implementation work defaults to the 1000x AI engineer implementer.',
    signals: type ? [`type:${type}`] : [],
  }
}

function explicitAgent(input: Partial<TicketAgent> | undefined): TicketAgent | null {
  if (!input?.id?.trim()) return null
  const scope = input.scope === 'repo' || input.scope === 'global' ? input.scope : 'global'
  const kind = input.kind === 'persistent' || input.kind === 'classic' ? input.kind : 'classic'
  return { id: input.id.trim(), scope, kind }
}

function normalizeTicketAgent(input: Partial<TicketAgent> | undefined, type: string, recommendation?: TicketAgentRecommendation): TicketAgent {
  const explicit = explicitAgent(input)
  if (explicit) return explicit
  const fallback = recommendation?.agent || recommendTicketAgent({ type }).agent
  return { id: fallback.id, scope: fallback.scope, kind: fallback.kind }
}

function ticketAgentFromFrontmatter(fm: Record<string, unknown>, type: string): TicketAgent {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return normalizeTicketAgent(
    {
      id: str(fm.agent_id),
      scope: str(fm.agent_scope) as TicketAgent['scope'],
      kind: str(fm.agent_kind) as TicketAgent['kind'],
    },
    type,
  )
}

function ticketRunFromFrontmatter(fm: Record<string, unknown>): TicketRunLink | undefined {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const id = str(fm.agent_run_id)
  if (!id) return undefined
  const sourceRaw = str(fm.agent_run_source)
  const source =
    sourceRaw === 'cron' || sourceRaw === 'bg' || sourceRaw === 'session' || sourceRaw === 'agent'
      ? sourceRaw
      : 'agent'
  return {
    id,
    source,
    sessionId: str(fm.agent_session_id) || undefined,
    startedAt: str(fm.agent_run_started_at) || undefined,
    status: str(fm.agent_run_status) || undefined,
  }
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
  patch: TicketPatch,
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
  // Replace a key plus any indented `- ` block-sequence lines that follow it
  // with a fresh block list (or inline `[]` when empty).
  const setListField = (key: string, items: string[]) => {
    const block = items.length
      ? `${key}:\n${items.map((c) => `  - "${c.replace(/"/g, "'")}"`).join('\n')}`
      : `${key}: []`
    const re = new RegExp(`^${key}:[^\\n]*(?:\\n[ \\t]+-[^\\n]*)*`, 'm')
    if (re.test(fm)) fm = fm.replace(re, block)
    else fm = fm.replace(/\n---$/, `\n${block}\n---`)
  }
  if (patch.status) setField('status', patch.status)
  if (patch.priority) setField('priority', patch.priority)
  if (patch.acceptance) setListField('acceptance', patch.acceptance)
  if (patch.prs) setListField('prs', patch.prs)
  if (patch.agent) {
    const current = toTicket(safe, md)
    const agent = normalizeTicketAgent(patch.agent, current.type)
    setField('agent_id', agent.id)
    setField('agent_scope', agent.scope)
    setField('agent_kind', agent.kind)
  }
  if (patch.run?.id) {
    setField('agent_run_id', patch.run.id)
    setField('agent_run_source', patch.run.source || 'agent')
    if (patch.run.sessionId) setField('agent_session_id', patch.run.sessionId)
    if (patch.run.startedAt) setField('agent_run_started_at', patch.run.startedAt)
    if (patch.run.status) setField('agent_run_status', patch.run.status)
  }
  setField('updated', today())
  try {
    writeFileSync(p, fm + m[2])
    return true
  } catch {
    return false
  }
}

/** Append a PR/MR url to a ticket's `prs:` list (idempotent) and, when the
 *  ticket is still untouched, flip it to in-progress. Used by the background-
 *  task watcher to close the loop between a spawned run and its ticket. */
export function linkTicketPr(repoRoot: string, slug: string, url: string): boolean {
  const t = getTicket(repoRoot, slug)
  if (!t) return false
  if (t.prs.includes(url)) return true
  return updateTicket(repoRoot, slug, {
    prs: [...t.prs, url],
    ...(t.status === 'open' ? { status: 'in-progress' } : {}),
  })
}

/** Emit a frontmatter list in the same shape `updateTicket`'s setListField
 *  writes, so a create → update round-trip doesn't reformat the file. */
function fmList(key: string, items: string[]): string {
  return items.length
    ? `${key}:\n${items.map((c) => `  - "${c.replace(/"/g, "'")}"`).join('\n')}`
    : `${key}: []`
}

export function createTicket(repoRoot: string, input: NewTicket): Ticket {
  const dir = existsSync(projectAreaPathForWrite(repoRoot, 'backlog'))
    ? projectAreaPathForWrite(repoRoot, 'backlog')
    : ensureProjectArea(repoRoot, 'backlog')
  const nextId = listTickets(repoRoot).reduce((max, t) => Math.max(max, t.id), 0) + 1
  const num = String(nextId).padStart(4, '0')
  const slug = `${num}-${slugify(input.title)}`
  const recommendation = recommendTicketAgent({ title: input.title, type: input.type || 'feature', body: input.body || '' })
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
    acceptance: input.acceptance || [],
    modelTier: 'auto',
    workedBy: [],
    agent: normalizeTicketAgent(input.agent, input.type || 'feature', recommendation),
    run: undefined,
    body: input.body || '',
    provider: 'local',
    providerLabel: 'Local backlog',
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
    `depends_on: []`,
    fmList('acceptance', t.acceptance),
    `model_tier: ${t.modelTier}`,
    `worked_by: []`,
    `agent_id: ${t.agent.id}`,
    `agent_scope: ${t.agent.scope}`,
    `agent_kind: ${t.agent.kind}`,
    '---',
    '',
    t.body.trim(),
    '',
  ].join('\n')
  writeFileSync(join(dir, `${slug}.md`), fm)
  return t
}
