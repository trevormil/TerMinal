import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { repoStatePathForRead, repoStatePathForWrite } from './repo-state'
import {
  appendTicketComment as appendLocalComment,
  createTicket as createLocalTicket,
  defaultTicketAgent,
  getTicket as getLocalTicket,
  listTickets as listLocalTickets,
  updateTicket as updateLocalTicket,
  type LinearMeta,
  type NewTicket,
  type Ticket,
  type TicketAgent,
  type TicketPatch,
} from './backlog'
import { commentHeader, type TicketComment } from './ticket-comments'
import { run as runCli } from './forge'
import type {
  GithubTicketConfig,
  LinearTicketConfig,
  NewTicketComment,
  RepoTicketsConfig,
  SavedTicketView,
  TicketGroupBy,
  TicketProviderKind,
  TicketProviderTestResult,
  TicketSortBy,
  TicketView,
  WebviewTicketConfig,
} from '../shared/types/tickets'
export type {
  GithubTicketConfig,
  LinearTicketConfig,
  NewTicketComment,
  RepoTicketsConfig,
  SavedTicketView,
  TicketProviderKind,
  TicketProviderTestResult,
  TicketView,
  WebviewTicketConfig,
} from '../shared/types/tickets'

const PROVIDER_KINDS: TicketProviderKind[] = ['local', 'github', 'linear', 'webview']
// Normalize an unknown stored value to a known provider kind — anything
// unrecognized falls back to local (never silently misroute reads/writes).
function normProvider(p: unknown): TicketProviderKind {
  return PROVIDER_KINDS.includes(p as TicketProviderKind) ? (p as TicketProviderKind) : 'local'
}

// Providers that existed once and no longer do. A saved config still naming one
// degrades to the local backlog via normProvider — correct, but invisible, and a
// repo silently swapping ticket stores is exactly the kind of change that has to
// be said out loud. So the degrade warns, ONCE per repo per app run: the config
// is re-read on every list/get/save, and a warning per read would be its own bug.
const RETIRED_PROVIDERS: Record<string, string> = {
  obsidian: 'Obsidian vault',
}
const warnedRetired = new Set<string>()

/** The one-time warning for a repo whose saved provider was retired, or null.
 *  Returned rather than emitted: this module stays free of the Activity feed
 *  (which pulls in Electron), so the caller that already has it does the emit. */
export function retiredProviderWarning(repoRoot: string): { title: string; detail: string } | null {
  const savedProvider = readConfig(repoRoot).provider
  const label = RETIRED_PROVIDERS[String(savedProvider)]
  if (!label) return null
  const key = repoRoot || '<none>'
  if (warnedRetired.has(key)) return null
  warnedRetired.add(key)
  return {
    title: `Ticket provider retired · ${label}`,
    detail: `This repo's saved ticket provider (${savedProvider}) no longer exists — TerMinal is reading its tickets from the local backlog instead. Pick a provider in Settings → Tickets. Nothing was deleted.`,
  }
}

export type RepoTicketProvider = {
  kind: TicketProviderKind
  label: string
  configPath?: string
  linearTeam?: string
  linearTeamKey?: string
}

const DEFAULT_STATUS_LABELS: Record<string, string> = {
  'in-progress': 'status:in-progress',
  stuck: 'status:stuck',
  icebox: 'status:icebox',
}

const DEFAULT_PRIORITY_LABELS: Record<string, string> = {
  critical: 'priority:critical',
  high: 'priority:high',
  medium: 'priority:medium',
  low: 'priority:low',
}

const DEFAULT_TYPE_LABELS: Record<string, string> = {
  feature: 'type:feature',
  bug: 'type:bug',
  security: 'type:security',
  docs: 'type:docs',
  dx: 'type:dx',
  testing: 'type:testing',
  ux: 'type:ux',
  performance: 'type:performance',
}

const PROVIDER_LABEL: Record<TicketProviderKind, string> = {
  local: 'Local backlog',
  github: 'GitHub Issues',
  linear: 'Linear',
  webview: 'Webview',
}

// Views are loaded into a real <webview>, so the url is a capability, not a
// label: anything but http(s) (javascript:, file:, data:) is dropped here at the
// config boundary rather than trusted downstream.
const GROUP_BYS: TicketGroupBy[] = ['status', 'priority', 'type', 'horizon', 'agent', 'none']
const SORT_BYS: TicketSortBy[] = ['id-desc', 'id-asc', 'updated-desc', 'priority']

// A stored view is user data that ends up driving list rendering, so every axis
// is normalized to a known value and an unnamed view is dropped — a nameless
// entry in the view picker would be unselectable and unremovable.
function sanitizeSavedViews(raw: unknown): SavedTicketView[] {
  if (!Array.isArray(raw)) return []
  const out: SavedTicketView[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const name = String(r.name ?? '').trim()
    if (!name) continue
    const str = (k: string, fallback: string) => {
      const value = String(r[k] ?? '').trim()
      return value || fallback
    }
    // Generic over the allowed literals so the narrowed union survives — the
    // stored axes are `TicketGroupBy`/`TicketSortBy`, not free strings.
    const oneOf = <T extends string>(k: string, allowed: T[], fallback: T): T => {
      const value = String(r[k] ?? '').trim() as T
      return allowed.includes(value) ? value : fallback
    }
    out.push({
      name,
      type: str('type', 'all'),
      horizon: str('horizon', 'all'),
      priority: str('priority', 'all'),
      status: str('status', 'all'),
      hitl: r.hitl === true,
      q: typeof r.q === 'string' ? r.q : '',
      groupBy: oneOf('groupBy', GROUP_BYS, 'status'),
      sortBy: oneOf('sortBy', SORT_BYS, 'id-desc'),
    })
  }
  return out
}

// Same http(s)-only rule as sanitizeViews (below) — the url is a capability
// (loaded into a real <webview>), not a label, so it's validated at the config
// boundary rather than trusted downstream.
function sanitizeWebview(raw: unknown): WebviewTicketConfig | null {
  const url = String((raw as WebviewTicketConfig)?.url ?? '').trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }
  const label = String((raw as WebviewTicketConfig)?.label ?? '').trim()
  return { url, ...(label ? { label } : {}) }
}

function sanitizeViews(raw: unknown): TicketView[] {
  if (!Array.isArray(raw)) return []
  const out: TicketView[] = []
  for (const v of raw) {
    const url = String((v as TicketView)?.url ?? '').trim()
    if (!url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
    const label = String((v as TicketView)?.label ?? '').trim()
    out.push({ label: label || url, url, ...((v as TicketView)?.default ? { default: true } : {}) })
  }
  return out
}

// Provider config (+ custom/saved views) is PERSONAL state — which provider
// you read a repo's tickets through, your Linear team pick, your view lenses —
// so it lives in the sidecar like the rest. Reads fall back to a legacy
// in-repo copy (state-path-ok: read-only fallback); writes go sidecar-only.
function configPath(repoRoot: string): string {
  return repoStatePathForRead(repoRoot, 'tickets.json')
}

function readConfig(repoRoot: string): RepoTicketsConfig {
  if (!repoRoot) return {}
  const p = configPath(repoRoot)
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as RepoTicketsConfig) : {}
  } catch {
    return {}
  }
}

export function readRepoTicketConfig(repoRoot: string): RepoTicketsConfig {
  const cfg = readConfig(repoRoot)
  const provider = normProvider(cfg.provider)
  const views = sanitizeViews(cfg.views)
  // Linear mode always carries its own embedded web UI as a view: Linear's UX
  // is the point of the integration, so the tab offers it without requiring a
  // hand-written views[] entry. Synthesized at read time, never written back;
  // an explicitly configured Linear view (any linear.app URL) suppresses it.
  if (provider === 'linear' && !views.some((v) => v.url.includes('linear.app'))) {
    views.unshift({ label: 'Linear', url: cfg.linear?.workspace || 'https://linear.app' })
  }
  return {
    provider,
    ...(cfg.github ? { github: cfg.github } : {}),
    ...(cfg.linear ? { linear: cfg.linear } : {}),
    ...(cfg.webview ? { webview: cfg.webview } : {}),
    ...(views.length ? { views } : {}),
    ...(cfg.savedViews?.length ? { savedViews: sanitizeSavedViews(cfg.savedViews) } : {}),
  }
}

// The repo's configured read-only ticket views, independent of its provider.
export function repoTicketViews(repoRoot: string): TicketView[] {
  return sanitizeViews(readConfig(repoRoot).views)
}

export function saveRepoTicketConfig(repoRoot: string, cfg: RepoTicketsConfig): RepoTicketsConfig {
  if (!repoRoot) throw new Error('not a git repo')
  const provider = normProvider(cfg.provider)
  const next: RepoTicketsConfig = {
    provider,
    ...(provider === 'github' && cfg.github ? { github: cfg.github } : {}),
    ...(provider === 'linear'
      ? {
          linear: {
            mcp: cfg.linear?.mcp || {
              command: 'bunx',
              args: ['mcp-remote@0.1.38', 'https://mcp.linear.app/mcp'],
            },
            tools: {
              list: cfg.linear?.tools?.list || 'list_issues',
              get: cfg.linear?.tools?.get || 'get_issue',
              create: cfg.linear?.tools?.create || 'save_issue',
              update: cfg.linear?.tools?.update || 'save_issue',
              comment: cfg.linear?.tools?.comment || 'save_comment',
            },
            ...(cfg.linear?.team ? { team: cfg.linear.team } : {}),
            ...(cfg.linear?.teamKey ? { teamKey: cfg.linear.teamKey } : {}),
            ...(cfg.linear?.listArgs ? { listArgs: cfg.linear.listArgs } : {}),
            ...(cfg.linear?.workspace?.trim() ? { workspace: cfg.linear.workspace.trim() } : {}),
          },
        }
      : {}),
    ...(provider === 'webview' && sanitizeWebview(cfg.webview)
      ? { webview: sanitizeWebview(cfg.webview)! }
      : {}),
    // Outside the provider-conditional blocks on purpose: a view is a lens, not
    // a provider, so it must survive whichever provider is configured. An omitted
    // `views` key means "unchanged" (callers that only edit provider config must
    // not wipe them); an explicit array — including [] — replaces.
    ...(() => {
      const next =
        cfg.views === undefined
          ? sanitizeViews(readConfig(repoRoot).views)
          : sanitizeViews(cfg.views)
      return next.length ? { views: next } : {}
    })(),
    // Same contract as `views`: omitted means unchanged, an explicit array
    // (including []) replaces. A saved view is a lens, not provider config.
    ...(() => {
      const next =
        cfg.savedViews === undefined
          ? sanitizeSavedViews(readConfig(repoRoot).savedViews)
          : sanitizeSavedViews(cfg.savedViews)
      return next.length ? { savedViews: next } : {}
    })(),
  }
  const dest = repoStatePathForWrite(repoRoot, 'tickets.json')
  if (!dest) throw new Error('not a git repo')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, JSON.stringify(next, null, 2) + '\n')
  return next
}

export function repoTicketProvider(repoRoot: string): RepoTicketProvider {
  const cfg = readConfig(repoRoot)
  const kind = normProvider(cfg.provider)
  return {
    kind,
    label: PROVIDER_LABEL[kind],
    ...(existsSync(configPath(repoRoot)) ? { configPath: configPath(repoRoot) } : {}),
    ...(kind === 'linear' && cfg.linear?.team ? { linearTeam: cfg.linear.team } : {}),
    ...(kind === 'linear' && cfg.linear?.teamKey ? { linearTeamKey: cfg.linear.teamKey } : {}),
  }
}

function normLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x === 'string') out.push(x)
    else if (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string')
      out.push((x as { name: string }).name)
  }
  return out
}

function firstMappedLabel(labels: string[], map: Record<string, string>, fallback: string): string {
  const found = Object.entries(map).find(([, label]) => labels.includes(label))
  return found?.[0] || fallback
}

// GitHub and Linear both return a comment list on the issue when we ask for
// one; their author fields differ, so normalize both into TicketComment. Every
// remote comment is `human` — an agent commenting through us round-trips as a
// plain platform comment, which is what the platform's own UI expects.
function externalComments(raw: unknown): TicketComment[] {
  if (!Array.isArray(raw)) return []
  const out: TicketComment[] = []
  for (const c of raw as any[]) {
    const body = typeof c?.body === 'string' ? c.body.trim() : ''
    if (!body) continue
    out.push({
      at: String(c.createdAt || c.created_at || ''),
      author: String(
        c.author?.login || c.user?.name || c.user?.displayName || c.user?.login || 'unknown',
      ),
      kind: 'human',
      body,
    })
  }
  return out
}

export function githubIssueToTicket(issue: any, cfg: GithubTicketConfig = {}): Ticket {
  const labels = normLabels(issue.labels)
  const statusLabels = { ...DEFAULT_STATUS_LABELS, ...(cfg.statusLabels || {}) }
  const priorityLabels = { ...DEFAULT_PRIORITY_LABELS, ...(cfg.priorityLabels || {}) }
  const typeLabels = { ...DEFAULT_TYPE_LABELS, ...(cfg.typeLabels || {}) }
  const number = Number(issue.number) || 0
  const state = String(issue.state || '').toLowerCase()
  const status = state === 'closed' ? 'closed' : firstMappedLabel(labels, statusLabels, 'open')
  return {
    slug: `github-${number}`,
    id: number,
    title: issue.title || `Issue ${number}`,
    status,
    priority: firstMappedLabel(labels, priorityLabels, 'medium'),
    horizon: 'now',
    hitl: labels.includes('hitl'),
    type: firstMappedLabel(labels, typeLabels, 'feature'),
    source: issue.author?.login ? `GitHub · ${issue.author.login}` : 'GitHub Issues',
    created: String(issue.createdAt || '').slice(0, 10),
    updated: String(issue.updatedAt || '').slice(0, 10),
    prs: [],
    refs: issue.url ? [issue.url] : [],
    depends_on: [],
    related: [],
    acceptance: [],
    modelTier: 'auto',
    workedBy: [],
    agent: defaultTicketAgent(firstMappedLabel(labels, typeLabels, 'feature')),
    body: issue.body || '',
    comments: externalComments(issue.comments),
    provider: 'github',
    providerLabel: 'GitHub Issues',
    externalId: String(number),
    externalKey: `#${number}`,
    url: issue.url || '',
  }
}

async function ghJson(repoRoot: string, args: string[], timeout = 12_000): Promise<any> {
  const r = await runCli('gh', args, repoRoot, { timeout })
  if (r.err) throw new Error((r.stderr || r.err.message || 'gh error').trim())
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

async function ghRun(repoRoot: string, args: string[], timeout = 12_000): Promise<string> {
  const r = await runCli('gh', args, repoRoot, { timeout })
  if (r.err) throw new Error((r.stderr || r.err.message || 'gh error').trim())
  return r.stdout
}

async function ensureGithubLabel(repoRoot: string, label: string) {
  const colors: Record<string, string> = {
    critical: 'b60205',
    high: 'd93f0b',
    medium: 'fbca04',
    low: '0e8a16',
    'in-progress': '1d76db',
    stuck: 'b60205',
    icebox: '5319e7',
  }
  const suffix = label.split(':').pop() || label
  const color = colors[suffix] || 'ededed'
  const r = await runCli(
    'gh',
    ['label', 'create', label, '--color', color, '--description', 'Managed by TerMinal tickets'],
    repoRoot,
    { timeout: 8_000 },
  )
  if (r.err && !/already exists/i.test(`${r.stderr} ${r.err.message}`))
    throw new Error((r.stderr || r.err.message).trim())
}

async function getGithubTicket(
  repoRoot: string,
  cfg: GithubTicketConfig,
  number: string,
): Promise<Ticket | null> {
  if (!/^\d+$/.test(number)) return null
  const issue = await ghJson(repoRoot, [
    'issue',
    'view',
    number,
    '--json',
    // `comments` is fetched on the detail read only — the list read stays
    // lean, since nothing renders a comment log from the list.
    'number,title,state,body,labels,url,createdAt,updatedAt,author,comments',
  ])
  return issue ? githubIssueToTicket(issue, cfg) : null
}

async function listGithubTickets(repoRoot: string, cfg: GithubTicketConfig): Promise<Ticket[]> {
  const issues = await ghJson(repoRoot, [
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    'number,title,state,body,labels,url,createdAt,updatedAt,author',
  ])
  return Array.isArray(issues)
    ? issues.map((issue) => githubIssueToTicket(issue, cfg)).sort((a, b) => b.id - a.id)
    : []
}

function labelMapValues(map: Record<string, string>): string[] {
  return [...new Set(Object.values(map))]
}

async function updateGithubTicket(
  repoRoot: string,
  cfg: GithubTicketConfig,
  slug: string,
  patch: { status?: string; priority?: string; agent?: Partial<TicketAgent> },
): Promise<boolean> {
  const number = parseExternalNumber(slug)
  if (!number) return false
  const statusLabels = { ...DEFAULT_STATUS_LABELS, ...(cfg.statusLabels || {}) }
  const priorityLabels = { ...DEFAULT_PRIORITY_LABELS, ...(cfg.priorityLabels || {}) }
  const before = await getGithubTicket(repoRoot, cfg, number)
  const currentLabels = before
    ? normLabels(
        await ghJson(repoRoot, ['issue', 'view', number, '--json', 'labels']).then(
          (x) => x?.labels,
        ),
      )
    : []

  if (patch.status) {
    if (patch.status === 'closed') await ghRun(repoRoot, ['issue', 'close', number])
    else {
      if (before?.status === 'closed') await ghRun(repoRoot, ['issue', 'reopen', number])
      const next = statusLabels[patch.status]
      const remove = labelMapValues(statusLabels).filter(
        (label) => label !== next && currentLabels.includes(label),
      )
      for (const label of remove)
        await ghRun(repoRoot, ['issue', 'edit', number, '--remove-label', label])
      if (next) {
        await ensureGithubLabel(repoRoot, next)
        await ghRun(repoRoot, ['issue', 'edit', number, '--add-label', next])
      }
    }
  }

  if (patch.priority) {
    const next = priorityLabels[patch.priority]
    if (next) {
      const latestLabels = normLabels(
        await ghJson(repoRoot, ['issue', 'view', number, '--json', 'labels']).then(
          (x) => x?.labels,
        ),
      )
      const remove = labelMapValues(priorityLabels).filter(
        (label) => label !== next && latestLabels.includes(label),
      )
      for (const label of remove)
        await ghRun(repoRoot, ['issue', 'edit', number, '--remove-label', label])
      await ensureGithubLabel(repoRoot, next)
      await ghRun(repoRoot, ['issue', 'edit', number, '--add-label', next])
    }
  }

  return true
}

async function createGithubTicket(
  repoRoot: string,
  cfg: GithubTicketConfig,
  input: NewTicket,
): Promise<Ticket> {
  const statusLabels = { ...DEFAULT_STATUS_LABELS, ...(cfg.statusLabels || {}) }
  const priorityLabels = { ...DEFAULT_PRIORITY_LABELS, ...(cfg.priorityLabels || {}) }
  const typeLabels = { ...DEFAULT_TYPE_LABELS, ...(cfg.typeLabels || {}) }
  const labels = [
    statusLabels[input.status],
    priorityLabels[input.priority],
    typeLabels[input.type],
  ].filter(Boolean) as string[]
  for (const label of labels) await ensureGithubLabel(repoRoot, label)
  const args = ['issue', 'create', '--title', input.title || 'Untitled', '--body', input.body || '']
  if (labels.length) args.push('--label', labels.join(','))
  const stdout = await ghRun(repoRoot, args)
  const m = stdout.match(/\/issues\/(\d+)/)
  const ticket = m ? await getGithubTicket(repoRoot, cfg, m[1]) : null
  if (!ticket) throw new Error('created GitHub issue but could not read it back')
  return ticket
}

function parseExternalNumber(slugOrId: string): string {
  const m = String(slugOrId || '').match(/(\d+)$/)
  return m?.[1] || ''
}

function linearIssueKey(slugOrId: string): string {
  return String(slugOrId || '')
    .replace(/^linear-/, '')
    .replace(/_/g, '-')
}

// Linear priorities are 0-4 with fixed labels; the label wins when the API
// sends one, the number maps otherwise.
const LINEAR_PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

/** A string-or-{name}-or-nothing field, as MCP payload shapes vary by tool
 *  version. Forgiveness-first: any shape degrades to ''. */
function nameOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['name', 'title', 'displayName', 'key']) {
      if (typeof o[k] === 'string' && o[k]) return o[k] as string
    }
  }
  return ''
}

/** Linear's own schema, extracted defensively — an issue that matches none of
 *  TerMinal's conventions must still come through renderable. */
export function linearMetaFromIssue(issue: any, key: string): LinearMeta {
  const stateObj = issue.state && typeof issue.state === 'object' ? issue.state : null
  const priorityNum =
    typeof issue.priority === 'number'
      ? issue.priority
      : typeof issue.priority?.value === 'number'
        ? issue.priority.value
        : Number.isFinite(Number(issue.priorityValue))
          ? Number(issue.priorityValue)
          : 0
  const priorityLabel =
    (typeof issue.priorityLabel === 'string' && issue.priorityLabel) ||
    nameOf(typeof issue.priority === 'object' ? issue.priority : undefined) ||
    LINEAR_PRIORITY_LABELS[priorityNum] ||
    'No priority'
  const rawLabels = Array.isArray(issue.labels)
    ? issue.labels
    : Array.isArray(issue.labels?.nodes)
      ? issue.labels.nodes
      : []
  const labels = rawLabels
    .map((l: unknown) => ({
      name: nameOf(l),
      ...(typeof (l as any)?.color === 'string' ? { color: (l as any).color } : {}),
    }))
    .filter((l: { name: string }) => l.name)
  return {
    identifier: key,
    stateName: nameOf(issue.state) || nameOf(issue.status) || 'Unknown',
    stateType: String(stateObj?.type || issue.stateType || issue.statusType || ''),
    ...(typeof stateObj?.color === 'string' ? { stateColor: stateObj.color } : {}),
    priority: priorityNum,
    priorityLabel,
    ...(nameOf(issue.assignee) ? { assignee: nameOf(issue.assignee) } : {}),
    labels,
    ...(nameOf(issue.project) ? { project: nameOf(issue.project) } : {}),
    ...(nameOf(issue.cycle) ? { cycle: nameOf(issue.cycle) } : {}),
    ...(nameOf(issue.team) ? { team: nameOf(issue.team) } : {}),
    ...(typeof issue.estimate === 'number' ? { estimate: issue.estimate } : {}),
    ...(typeof issue.dueDate === 'string' && issue.dueDate
      ? { dueDate: issue.dueDate.slice(0, 10) }
      : {}),
  }
}

export function linearIssueToTicket(issue: any): Ticket {
  const key = String(issue.identifier || issue.key || issue.externalKey || issue.id || '')
  const numeric = Number((key.match(/(\d+)$/) || [])[1]) || Number(issue.number) || 0
  const state =
    typeof issue.state === 'string' ? issue.state : issue.state?.name || issue.status || 'open'
  const priority =
    typeof issue.priority === 'string'
      ? issue.priority
      : issue.priority?.name ||
        issue.priorityLabel ||
        (typeof issue.priority === 'number' ? LINEAR_PRIORITY_LABELS[issue.priority] : '') ||
        'medium'
  const meta = linearMetaFromIssue(issue, key)
  // Linear's state CATEGORY (stateType) beats name-sniffing when present — a
  // custom state named "Shipping it" still buckets correctly.
  const statusFromType: Record<string, string> = {
    completed: 'closed',
    canceled: 'closed',
    started: 'in-progress',
    backlog: 'icebox',
    triage: 'open',
    unstarted: 'open',
  }
  return {
    linear: meta,
    slug: `linear-${key.replace(/[^A-Za-z0-9-]/g, '-') || numeric || 'issue'}`,
    id: numeric,
    title: issue.title || issue.name || key || 'Linear issue',
    status: statusFromType[meta.stateType] || normalizeStatus(state),
    priority: normalizePriority(priority),
    horizon: 'now',
    hitl: false,
    type: 'feature',
    source: 'Linear',
    created: String(issue.createdAt || '').slice(0, 10),
    updated: String(issue.updatedAt || '').slice(0, 10),
    prs: [],
    refs: issue.url ? [issue.url] : [],
    depends_on: [],
    related: [],
    acceptance: [],
    modelTier: 'auto',
    workedBy: [],
    agent: defaultTicketAgent('feature'),
    body: issue.description || issue.body || '',
    comments: externalComments(issue.comments),
    provider: 'linear',
    providerLabel: 'Linear',
    externalId: String(issue.id || key),
    externalKey: key,
    url: issue.url || '',
  }
}

function normalizeStatus(raw: string): string {
  const v = raw.toLowerCase().replace(/\s+/g, '-')
  if (v.includes('done') || v.includes('complete') || v.includes('closed')) return 'closed'
  if (v.includes('progress') || v.includes('started')) return 'in-progress'
  if (v.includes('blocked') || v.includes('stuck')) return 'stuck'
  if (v.includes('backlog') || v.includes('icebox')) return 'icebox'
  return 'open'
}

function normalizePriority(raw: string): string {
  const v = raw.toLowerCase()
  if (v.includes('urgent') || v.includes('critical')) return 'critical'
  if (v.includes('high')) return 'high'
  if (v.includes('low')) return 'low'
  return 'medium'
}

async function callMcpTool(
  linear: LinearTicketConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const command = linear.mcp?.command
  if (!command)
    throw new Error('Linear MCP command missing in the ticket provider config (tickets.json)')
  const child = spawn(command, linear.mcp?.args || [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(linear.mcp?.env || {}) },
  })
  let nextId = 1
  const pending = new Map<number, (msg: any) => void>()
  const rejectors = new Map<number, (err: Error) => void>()
  const stderr: Buffer[] = []
  let stdoutBuffer = ''
  // A misconfigured MCP command (a path that doesn't exist) emits 'error', not
  // 'exit'. An unhandled 'error' on a ChildProcess is thrown, and in the main
  // process that means the whole app dies — a typo in the ticket provider
  // config could crash TerMinal. Handle it and fail the pending calls instead.
  let spawnError: Error | null = null
  const failAll = (err: Error) => {
    spawnError = err
    for (const [id, reject] of [...rejectors]) {
      pending.delete(id)
      rejectors.delete(id)
      reject(err)
    }
  }
  child.on('error', (err) => failAll(err as Error))
  // stdin dies with the child, so a write after that point raises EPIPE on a
  // stream with no error handler — same crash, different socket.
  child.stdin.on('error', (err) => failAll(err as Error))
  child.stderr.on('data', (d) => stderr.push(Buffer.from(d)))
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk)
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines.filter(Boolean)) {
      try {
        const msg = JSON.parse(line)
        if (typeof msg.id === 'number') pending.get(msg.id)?.(msg)
      } catch {
        /* ignore non-json server logging */
      }
    }
  })
  const send = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      if (spawnError) return reject(spawnError)
      const id = nextId++
      // Cleared on settle, so a resolved call doesn't hold a 15s timer open and
      // keep the event loop (and this child) alive after the work is done.
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          rejectors.delete(id)
          reject(new Error(`MCP timeout calling ${method}`))
        }
      }, 15_000)
      rejectors.set(id, (err) => {
        clearTimeout(timer)
        reject(err)
      })
      pending.set(id, (msg) => {
        clearTimeout(timer)
        pending.delete(id)
        rejectors.delete(id)
        msg.error ? reject(new Error(msg.error.message || 'MCP error')) : resolve(msg.result)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
        if (err) failAll(err)
      })
    })
  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'TerMinal', version: '1' },
    })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      () => {
        /* notification — a write failure surfaces on the next request */
      },
    )
    const result = await send('tools/call', { name: tool, arguments: args })
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .join('\n')
      .trim()
    if (result?.isError) throw new Error(text || 'Linear MCP tool failed')
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    return result
  } catch (e) {
    const err = Buffer.concat(stderr).toString().trim()
    throw new Error(err || (e as Error).message)
  } finally {
    child.kill()
  }
}

async function listLinearTickets(linear: LinearTicketConfig): Promise<Ticket[]> {
  const tool = linear.tools?.list || 'list_issues'
  const team = linear.team || linear.teamKey
  const raw = await callMcpTool(linear, tool, {
    ...(linear.listArgs || {}),
    ...(team ? { team } : {}),
  })
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.issues)
      ? (raw as any).issues
      : Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : []
  return arr.map(linearIssueToTicket).sort((a, b) => b.id - a.id)
}

async function getLinearTicket(linear: LinearTicketConfig, slug: string): Promise<Ticket | null> {
  const tool = linear.tools?.get || 'get_issue'
  const key = linearIssueKey(slug)
  const raw = await callMcpTool(linear, tool, { id: key })
  const issue = (raw as any)?.issue || raw
  if (!issue) return null
  const ticket = linearIssueToTicket(issue)
  // get_issue does not carry the thread, so pull it separately. A failure here
  // costs the comment log, not the ticket — degrade rather than throw.
  if (ticket.comments.length === 0) {
    try {
      const rawComments = await callMcpTool(linear, 'list_comments', { issueId: key })
      const arr = Array.isArray(rawComments)
        ? rawComments
        : (rawComments as any)?.comments || (rawComments as any)?.data
      ticket.comments = externalComments(arr)
    } catch {
      /* leave the log empty */
    }
  }
  return ticket
}

async function createLinearTicket(linear: LinearTicketConfig, input: NewTicket): Promise<Ticket> {
  const tool = linear.tools?.create || 'save_issue'
  const team = linear.team || linear.teamKey
  if (!team) throw new Error('Linear team missing in the ticket provider config (tickets.json)')
  const raw = await callMcpTool(linear, tool, {
    team,
    title: input.title,
    description: input.body,
    state: linearStatus(input.status),
    priority: linearPriority(input.priority),
  })
  const issue = (raw as any)?.issue || raw
  return linearIssueToTicket(issue)
}

async function updateLinearTicket(
  linear: LinearTicketConfig,
  slug: string,
  patch: { status?: string; priority?: string; agent?: Partial<TicketAgent> },
): Promise<boolean> {
  const tool = linear.tools?.update || 'save_issue'
  const key = linearIssueKey(slug)
  await callMcpTool(linear, tool, {
    id: key,
    ...(patch.status ? { state: linearStatus(patch.status) } : {}),
    ...(patch.priority ? { priority: linearPriority(patch.priority) } : {}),
  })
  return true
}

function linearStatus(status: string): string {
  switch (status) {
    case 'in-progress':
      return 'In Progress'
    case 'closed':
      return 'Done'
    case 'stuck':
      return 'Blocked'
    case 'icebox':
      return 'Backlog'
    default:
      return 'Todo'
  }
}

function linearPriority(priority: string): number {
  switch (priority) {
    case 'critical':
      return 1
    case 'high':
      return 2
    case 'medium':
      return 3
    case 'low':
      return 4
    default:
      return 0
  }
}

/** One provider's full CRUD surface. The five entry points below used to each
 *  re-implement the same five-branch provider ladder (30 branches in all); the
 *  ladder now runs once, here, and every entry point is a one-line dispatch.
 *  Per-provider degradation contracts are unchanged and pinned by tests:
 *  webview has no queryable store (reads empty, writes refused, create loud —
 *  silently dropping a new ticket would lose data). */
type TicketBackend = {
  list(): Promise<Ticket[]>
  get(slug: string): Promise<Ticket | null>
  create(input: NewTicket): Promise<Ticket>
  update(slug: string, patch: TicketPatch): Promise<boolean>
  comment(slug: string, comment: NewTicketComment): Promise<boolean>
}

function backendFor(
  repoRoot: string,
  cfg: RepoTicketsConfig = readConfig(repoRoot),
): TicketBackend {
  const provider = normProvider(cfg.provider)
  if (provider === 'webview')
    return {
      list: async () => [],
      get: async () => null,
      create: async () => {
        throw new Error('This repo has no ticket store — its Tickets tab is a webview.')
      },
      update: async () => false,
      comment: async () => false,
    }
  if (provider === 'github') {
    const gh = cfg.github || {}
    return {
      list: () => listGithubTickets(repoRoot, gh),
      get: (slug) => getGithubTicket(repoRoot, gh, parseExternalNumber(slug)),
      create: (input) => createGithubTicket(repoRoot, gh, input),
      update: (slug, patch) => updateGithubTicket(repoRoot, gh, slug, patch),
      comment: async (slug, comment) => {
        const number = parseExternalNumber(slug)
        if (!/^\d+$/.test(number)) return false
        await ghRun(repoRoot, ['issue', 'comment', number, '--body', remoteCommentBody(comment)])
        return true
      },
    }
  }
  if (provider === 'linear') {
    const linear = cfg.linear || {}
    return {
      list: () => listLinearTickets(linear),
      get: (slug) => getLinearTicket(linear, slug),
      create: (input) => createLinearTicket(linear, input),
      update: (slug, patch) => updateLinearTicket(linear, slug, patch),
      comment: async (slug, comment) => {
        await callMcpTool(linear, linear.tools?.comment || 'save_comment', {
          issueId: linearIssueKey(slug),
          body: remoteCommentBody(comment),
        })
        return true
      },
    }
  }
  return {
    list: async () => listLocalTickets(repoRoot),
    get: async (slug) => getLocalTicket(repoRoot, slug),
    create: async (input) => createLocalTicket(repoRoot, input),
    update: async (slug, patch) => updateLocalTicket(repoRoot, slug, patch),
    comment: async (slug, comment) => appendLocalComment(repoRoot, slug, comment),
  }
}

export async function listRepoTickets(repoRoot: string): Promise<Ticket[]> {
  return backendFor(repoRoot).list()
}

export async function getRepoTicket(repoRoot: string, slug: string): Promise<Ticket | null> {
  return backendFor(repoRoot).get(slug)
}

export async function createRepoTicket(repoRoot: string, input: NewTicket): Promise<Ticket> {
  return backendFor(repoRoot).create(input)
}

export async function updateRepoTicket(
  repoRoot: string,
  slug: string,
  patch: TicketPatch,
): Promise<boolean> {
  return backendFor(repoRoot).update(slug, patch)
}

/** Who a comment typed in the UI is attributed to. Git identity first — it is
 *  what the rest of the ticket's history (commits, PRs) is already signed with
 *  — then the OS user, so the log never falls back to a generic placeholder. */
export async function resolveHumanAuthor(repoRoot: string): Promise<string> {
  try {
    const r = await runCli('git', ['config', 'user.name'], repoRoot, { timeout: 3_000 })
    const name = (r.stdout || '').trim()
    if (name) return name
  } catch {
    /* fall through to the OS user */
  }
  return (process.env.USER || process.env.LOGNAME || 'you').trim()
}

/**
 * Append a comment to a ticket's log, wherever that ticket actually lives.
 * Local tickets get a `## Log` entry in their markdown; GitHub and
 * Linear get a real platform comment, so the thread stays where that platform's
 * own UI shows it. An agent comment is prefixed on the remote providers, which
 * have no notion of a non-human author.
 */
export async function commentOnRepoTicket(
  repoRoot: string,
  slug: string,
  comment: NewTicketComment,
): Promise<boolean> {
  if (!comment.body.trim() || !comment.author.trim()) return false
  return backendFor(repoRoot).comment(slug, comment)
}

/** GitHub/Linear attribute every comment to the authenticated account, so an
 *  agent's identity has to ride along in the body or it is lost. */
function remoteCommentBody(comment: NewTicketComment): string {
  if (comment.kind !== 'agent') return comment.body.trim()
  return `${commentHeader({ ...comment, at: comment.at || new Date().toISOString() })}\n\n${comment.body.trim()}`
}

export function ticketProviderInstructions(provider: RepoTicketProvider): string {
  if (provider.kind === 'webview') {
    return 'Ticket provider: webview. This repo has no queryable ticket store — the Tickets tab embeds an external page directly. Do not create or edit local backlog markdown files for ticket state, and do not expect any ticket CLI/tool to return results here.'
  }
  if (provider.kind === 'github') {
    return 'Ticket provider: GitHub Issues. Use the gh CLI in this repository for ticket reads/writes. Do not create or edit local backlog markdown files for ticket state.'
  }
  if (provider.kind === 'linear') {
    const team =
      provider.linearTeam && provider.linearTeamKey
        ? `${provider.linearTeam} (${provider.linearTeamKey})`
        : provider.linearTeam || provider.linearTeamKey || 'the team selected in Settings → Tickets'
    const issueExample = provider.linearTeamKey ? `${provider.linearTeamKey}-11` : 'TEAM-123'
    return `Ticket provider: Linear. Use the configured Linear MCP/CLI for reads and writes, the bound team ${team}, and Linear issue identifiers such as ${issueExample}. Do not use TerMinal local ticket tools (file_ticket, comment_ticket, update_ticket) or create/edit local backlog markdown files for ticket state.`
  }
  return 'Ticket provider: local backlog. Tickets are NNNN-slug.md markdown files in the per-project sidecar at $TERMINAL_BACKLOG_DIR (resolve with `tm-state-dir backlog` when the env is unset) — NOT inside the repo working tree. Legacy tickets still committed in the repo remain readable, but never write new ones there.'
}

export async function listLinearTeams(
  repoRoot: string,
  cfg: RepoTicketsConfig = readConfig(repoRoot),
): Promise<{ id: string; name: string; key?: string }[]> {
  const linear = cfg.linear || {}
  const raw = await callMcpTool(linear, 'list_teams', { limit: 50 })
  const teams: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.teams)
      ? (raw as any).teams
      : []
  return teams
    .map((team: any) => ({
      id: String(team.id || ''),
      name: String(team.name || team.key || team.id || ''),
      ...(team.key ? { key: String(team.key) } : {}),
    }))
    .filter((team) => team.id || team.name)
}

export async function testRepoTicketProvider(
  repoRoot: string,
  cfg: RepoTicketsConfig = readConfig(repoRoot),
  opts: { smoke?: boolean } = {},
): Promise<TicketProviderTestResult> {
  const provider = normProvider(cfg.provider)
  try {
    if (provider === 'webview') {
      const webview = sanitizeWebview(cfg.webview)
      if (!webview)
        return { ok: false, provider, message: 'Enter a valid http(s) URL before saving.' }
      return { ok: true, provider, message: `Webview ready (${webview.url}).` }
    }
    if (provider === 'github') {
      const auth = await runCli('gh', ['auth', 'status'], repoRoot, { timeout: 10_000 })
      if (auth.err)
        return {
          ok: false,
          provider,
          message: (auth.stderr || auth.err.message || 'gh auth failed').trim(),
        }
      const repo = await ghJson(repoRoot, [
        'repo',
        'view',
        '--json',
        'hasIssuesEnabled,nameWithOwner,url',
      ])
      if (repo && repo.hasIssuesEnabled === false)
        return { ok: false, provider, message: 'GitHub issues are disabled for this repo.' }
      const count = (await listGithubTickets(repoRoot, cfg.github || {})).length
      if (!opts.smoke)
        return {
          ok: true,
          provider,
          message: `GitHub Issues ready${repo?.nameWithOwner ? ` for ${repo.nameWithOwner}` : ''}.`,
          count,
        }
      const smoke = await createGithubTicket(repoRoot, cfg.github || {}, {
        title: 'TerMinal smoke test - safe to close',
        type: 'testing',
        priority: 'low',
        status: 'open',
        body: `Created by TerMinal ticket-provider smoke test at ${new Date().toISOString()}.`,
      })
      await updateGithubTicket(repoRoot, cfg.github || {}, smoke.slug, { priority: 'high' })
      await updateGithubTicket(repoRoot, cfg.github || {}, smoke.slug, { status: 'closed' })
      const after = await getGithubTicket(repoRoot, cfg.github || {}, String(smoke.id))
      return {
        ok: true,
        provider,
        message: 'GitHub smoke issue created, updated, and closed.',
        smoke: {
          key: after?.externalKey,
          url: after?.url,
          status: after?.status,
          priority: after?.priority,
        },
      }
    }
    if (provider === 'linear') {
      const teams = await listLinearTeams(repoRoot, cfg)
      const team = cfg.linear?.team || cfg.linear?.teamKey
      if (!team) return { ok: false, provider, message: 'Pick a Linear team before saving.', teams }
      const count = (await listLinearTickets(cfg.linear || {})).length
      if (!opts.smoke)
        return { ok: true, provider, message: `Linear ready for team ${team}.`, count, teams }
      const smoke = await createLinearTicket(cfg.linear || {}, {
        title: 'TerMinal smoke test - safe to close',
        type: 'testing',
        priority: 'low',
        status: 'open',
        body: `Created by TerMinal ticket-provider smoke test at ${new Date().toISOString()}.`,
      })
      await updateLinearTicket(cfg.linear || {}, smoke.slug, { priority: 'high' })
      await updateLinearTicket(cfg.linear || {}, smoke.slug, { status: 'closed' })
      const after = await getLinearTicket(cfg.linear || {}, smoke.slug)
      return {
        ok: true,
        provider,
        message: 'Linear smoke issue created, updated, and closed.',
        count,
        teams,
        smoke: {
          key: after?.externalKey,
          url: after?.url,
          status: after?.status,
          priority: after?.priority,
        },
      }
    }
    const count = listLocalTickets(repoRoot).length
    return { ok: true, provider, message: 'Local backlog ready.', count }
  } catch (e) {
    return { ok: false, provider, message: (e as Error).message || 'Ticket provider test failed' }
  }
}
