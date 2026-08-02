import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendTicketComment as appendLocalComment,
  createTicket as createLocalTicket,
  defaultTicketAgent,
  getTicket as getLocalTicket,
  listTickets as listLocalTickets,
  updateTicket as updateLocalTicket,
  type NewTicket,
  type Ticket,
  type TicketAgent,
  type TicketPatch,
} from './backlog'
import { commentHeader, type TicketComment } from './ticket-comments'
import { run as runCli } from './forge'

/** A comment as callers hand it in — the timestamp is stamped at write time. */
export type NewTicketComment = Omit<TicketComment, 'at'> & { at?: string }

export type TicketProviderKind = 'local' | 'github' | 'linear' | 'obsidian' | 'webview'

const PROVIDER_KINDS: TicketProviderKind[] = ['local', 'github', 'linear', 'obsidian', 'webview']
// Normalize an unknown stored value to a known provider kind — anything
// unrecognized falls back to local (never silently misroute reads/writes).
function normProvider(p: unknown): TicketProviderKind {
  return PROVIDER_KINDS.includes(p as TicketProviderKind) ? (p as TicketProviderKind) : 'local'
}

export type RepoTicketProvider = {
  kind: TicketProviderKind
  label: string
  configPath?: string
}

type GithubConfig = {
  statusLabels?: Record<string, string>
  priorityLabels?: Record<string, string>
  typeLabels?: Record<string, string>
}

export type LinearTicketConfig = {
  mcp?: { command?: string; args?: string[]; env?: Record<string, string> }
  tools?: {
    list?: string
    get?: string
    create?: string
    update?: string
    /** Defaults to Linear's `save_comment`. */
    comment?: string
  }
  team?: string
  teamKey?: string
  listArgs?: Record<string, unknown>
}

// Obsidian: a per-repo dedicated vault (a filesystem folder). Tickets are the
// same NNNN-slug.md markdown as the local provider, stored in the vault's
// `ticketsSubdir` (default `tickets/`). `vaultName` is only for obsidian:// deep
// links (defaults to the vault folder's basename). The path is a local
// filesystem path — no secret, stored plainly in the gitignored tickets.json.
export type ObsidianTicketConfig = {
  vaultPath: string
  ticketsSubdir?: string
  vaultName?: string
}

// A repo whose tickets live ENTIRELY in some external platform's own web UI —
// no schema mapping, no CRUD, just an embedded <webview> as the Tickets tab
// itself. Unlike `TicketView` (below), this IS the provider: there's no local
// backlog running alongside it, so there's nothing to show but the page.
export type WebviewTicketConfig = {
  url: string
  label?: string
}

// A read-only web view of some ticket platform (Linear, Jira, GitHub Projects,
// a Notion board — anything with a URL), rendered in the Tickets tab as an
// embedded <webview>. Deliberately NOT a provider: a view never changes where
// tickets are read from or written to, so a team board whose tickets don't match
// our frontmatter spec can still be visible without corrupting the agent
// contract (owner agent, acceptance, refs) that the factory depends on. Writes
// to those platforms go through their own MCP, driven deliberately in-session.
export type TicketView = {
  label: string
  url: string
  // When true, the Tickets tab opens on this view instead of the local backlog.
  // First flagged view wins; the Backlog sub-tab stays one click away.
  default?: boolean
}

/** A named filter/group/sort lens over this repo's tickets. Distinct from
 *  `TicketView`, which embeds an external platform's own web UI. Mirrors
 *  SavedTicketView in src/renderer/src/lib/ticketViews.ts. */
export type SavedTicketView = {
  name: string
  type: string
  horizon: string
  priority: string
  status: string
  hitl: boolean
  q: string
  groupBy: string
  sortBy: string
}

export type RepoTicketsConfig = {
  provider?: TicketProviderKind
  github?: GithubConfig
  linear?: LinearTicketConfig
  obsidian?: ObsidianTicketConfig
  webview?: WebviewTicketConfig
  views?: TicketView[]
  savedViews?: SavedTicketView[]
}

export type TicketProviderTestResult = {
  ok: boolean
  provider: TicketProviderKind
  message: string
  count?: number
  teams?: { id: string; name: string; key?: string }[]
  smoke?: { key?: string; url?: string; status?: string; priority?: string }
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
  obsidian: 'Obsidian',
  webview: 'Webview',
}

// Resolve the on-disk ticket folder for an Obsidian vault: <vaultPath>/<subdir>.
// Returns null when no vault is configured (callers degrade gracefully).
function obsidianBaseDir(cfg: ObsidianTicketConfig | undefined): string | null {
  const vault = cfg?.vaultPath?.trim()
  if (!vault) return null
  const sub = (cfg?.ticketsSubdir?.trim() || 'tickets').replace(/^\/+|\/+$/g, '')
  return sub ? join(vault, sub) : vault
}
const stampObsidian = (t: Ticket): Ticket => ({
  ...t,
  provider: 'obsidian',
  providerLabel: PROVIDER_LABEL.obsidian,
})

const vaultNameFor = (cfg: ObsidianTicketConfig): string =>
  cfg.vaultName?.trim() || cfg.vaultPath.replace(/\/+$/, '').split('/').pop() || 'vault'

// An `obsidian://open` deep link to a ticket file, or null if the vault isn't
// configured. Used by the Tickets tab's "Open in Obsidian" action.
export function obsidianDeepLink(
  cfg: ObsidianTicketConfig | undefined,
  slug: string,
): string | null {
  if (!cfg) return null
  const dir = obsidianBaseDir(cfg)
  if (!dir) return null
  const sub = (cfg.ticketsSubdir?.trim() || 'tickets').replace(/^\/+|\/+$/g, '')
  const rel = `${sub}/${slug.replace(/[^\w-]/g, '')}.md`
  return `obsidian://open?vault=${encodeURIComponent(vaultNameFor(cfg))}&file=${encodeURIComponent(rel)}`
}

export function obsidianRepoDeepLink(repoRoot: string, slug: string): string | null {
  return obsidianDeepLink(readConfig(repoRoot).obsidian, slug)
}

// The vault + tickets folder for a repo IF it's on the obsidian provider — used
// to expose OBSIDIAN_VAULT_PATH / OBSIDIAN_TICKETS_DIR to spawned sessions so an
// agent's native file tools can browse the vault directly. null otherwise.
export function obsidianRepoVault(
  repoRoot: string,
): { vaultPath: string; ticketsDir: string } | null {
  const cfg = readConfig(repoRoot)
  if (normProvider(cfg.provider) !== 'obsidian') return null
  const dir = obsidianBaseDir(cfg.obsidian)
  if (!cfg.obsidian?.vaultPath || !dir) return null
  return { vaultPath: cfg.obsidian.vaultPath.trim(), ticketsDir: dir }
}

// Idempotently seed helper notes into an Obsidian vault: a guide, a Dataview
// board, and a Templater new-ticket template. Never overwrites existing files,
// so it's safe to run on every save and safe against a vault the user also uses
// for their own notes. Best-effort — a write failure never blocks saving.
export function scaffoldObsidianVault(cfg: ObsidianTicketConfig | undefined): void {
  const vault = cfg?.vaultPath?.trim()
  if (!vault || !existsSync(vault)) return
  const sub = (cfg!.ticketsSubdir?.trim() || 'tickets').replace(/^\/+|\/+$/g, '')
  const seed = (rel: string, content: string) => {
    try {
      const p = join(vault, rel)
      if (existsSync(p)) return
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, content)
    } catch {
      /* best effort */
    }
  }
  try {
    mkdirSync(join(vault, sub), { recursive: true })
  } catch {
    /* best effort */
  }
  seed(
    '_TerMinal.md',
    `# TerMinal tickets\n\nThis vault is TerMinal's private ticket store for a repo. Tickets are markdown\nfiles with YAML frontmatter in \`${sub}/\` — TerMinal reads and writes them; edit\nfreely in Obsidian, they stay in sync.\n\n- **Board:** [[_Boards/Tickets]] (needs the Dataview community plugin)\n- **New ticket:** \`_Templates/Ticket.md\` (needs the Templater community plugin)\n\nTerMinal allocates ticket ids (\`NNNN-slug.md\`). If you hand-create a ticket in\nObsidian, use the next free number.\n\nFrontmatter: \`id, title, status, priority, horizon, type, source, created,\nupdated, prs, refs, depends_on, acceptance, model_tier, worked_by, agent_id,\nagent_scope, agent_kind\`.\n`,
  )
  seed(
    join('_Boards', 'Tickets.md'),
    `# Tickets\n\n> Needs the **Dataview** plugin. Board over \`${sub}/\`.\n\n\`\`\`dataview\nTABLE WITHOUT ID file.link AS Ticket, status, priority, type, updated\nFROM "${sub}"\nWHERE id\nSORT priority ASC, updated DESC\n\`\`\`\n\n## Open by priority\n\n\`\`\`dataview\nTABLE WITHOUT ID file.link AS Ticket, type, updated\nFROM "${sub}"\nWHERE id AND status != "closed" AND status != "done"\nGROUP BY priority\n\`\`\`\n`,
  )
  seed(
    join('_Templates', 'Ticket.md'),
    `---\nid:\ntitle: "<% tp.file.title %>"\nstatus: open\npriority: medium\nhorizon: now\ntype: feature\nsource: obsidian\ncreated: <% tp.date.now("YYYY-MM-DD") %>\nupdated: <% tp.date.now("YYYY-MM-DD") %>\nprs: []\nrefs: []\ndepends_on: []\nacceptance: []\nmodel_tier: auto\nworked_by: []\nagent_id: 1000x-ai-engineer\nagent_scope: global\nagent_kind: classic\n---\n\n<!-- Templater template. TerMinal normally allocates the id + NNNN-slug filename;\n     if you create a ticket here manually, set id to the next free number. -->\n`,
  )
}

// Views are loaded into a real <webview>, so the url is a capability, not a
// label: anything but http(s) (javascript:, file:, data:) is dropped here at the
// config boundary rather than trusted downstream.
const GROUP_BYS = ['status', 'priority', 'type', 'horizon', 'agent', 'none']
const SORT_BYS = ['id-desc', 'id-asc', 'updated-desc', 'priority']

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
    const oneOf = (k: string, allowed: string[], fallback: string) => {
      const value = String(r[k] ?? '').trim()
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

function configPath(repoRoot: string): string {
  return join(repoRoot, '.TerMinal', 'tickets.json')
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
  return {
    provider: normProvider(cfg.provider),
    ...(cfg.github ? { github: cfg.github } : {}),
    ...(cfg.linear ? { linear: cfg.linear } : {}),
    ...(cfg.obsidian ? { obsidian: cfg.obsidian } : {}),
    ...(cfg.webview ? { webview: cfg.webview } : {}),
    ...(cfg.views?.length ? { views: sanitizeViews(cfg.views) } : {}),
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
    ...(provider === 'obsidian' && cfg.obsidian?.vaultPath
      ? {
          obsidian: {
            vaultPath: cfg.obsidian.vaultPath.trim(),
            ...(cfg.obsidian.ticketsSubdir?.trim()
              ? { ticketsSubdir: cfg.obsidian.ticketsSubdir.trim() }
              : {}),
            ...(cfg.obsidian.vaultName?.trim() ? { vaultName: cfg.obsidian.vaultName.trim() } : {}),
          },
        }
      : {}),
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
  mkdirSync(join(repoRoot, '.TerMinal'), { recursive: true })
  writeFileSync(configPath(repoRoot), JSON.stringify(next, null, 2) + '\n')
  return next
}

export function repoTicketProvider(repoRoot: string): RepoTicketProvider {
  const cfg = readConfig(repoRoot)
  const kind = normProvider(cfg.provider)
  return {
    kind,
    label: PROVIDER_LABEL[kind],
    ...(existsSync(configPath(repoRoot)) ? { configPath: configPath(repoRoot) } : {}),
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

export function githubIssueToTicket(issue: any, cfg: GithubConfig = {}): Ticket {
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
  cfg: GithubConfig,
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

async function listGithubTickets(repoRoot: string, cfg: GithubConfig): Promise<Ticket[]> {
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
  cfg: GithubConfig,
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
  cfg: GithubConfig,
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

export function linearIssueToTicket(issue: any): Ticket {
  const key = String(issue.identifier || issue.key || issue.externalKey || issue.id || '')
  const numeric = Number((key.match(/(\d+)$/) || [])[1]) || Number(issue.number) || 0
  const state =
    typeof issue.state === 'string' ? issue.state : issue.state?.name || issue.status || 'open'
  const priority =
    typeof issue.priority === 'string'
      ? issue.priority
      : issue.priority?.name || issue.priorityLabel || 'medium'
  return {
    slug: `linear-${key.replace(/[^A-Za-z0-9-]/g, '-') || numeric || 'issue'}`,
    id: numeric,
    title: issue.title || issue.name || key || 'Linear issue',
    status: normalizeStatus(state),
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
  if (!command) throw new Error('Linear MCP command missing in .TerMinal/tickets.json')
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
  // process that means the whole app dies — a typo in .TerMinal/tickets.json
  // could crash TerMinal. Handle it and fail the pending calls instead.
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
  if (!team) throw new Error('Linear team missing in .TerMinal/tickets.json')
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
 *  silently dropping a new ticket would lose data); obsidian without a vault
 *  fails closed rather than falling back to the repo backlog. */
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
  if (provider === 'obsidian') {
    const dir = obsidianBaseDir(cfg.obsidian)
    return {
      list: async () => (dir ? listLocalTickets(repoRoot, dir).map(stampObsidian) : []),
      get: async (slug) => {
        if (!dir) return null
        const t = getLocalTicket(repoRoot, slug, dir)
        return t ? stampObsidian(t) : null
      },
      create: async (input) => {
        if (!dir) throw new Error('Obsidian vault path is not configured for this repo.')
        return stampObsidian(createLocalTicket(repoRoot, input, dir))
      },
      update: async (slug, patch) => (dir ? updateLocalTicket(repoRoot, slug, patch, dir) : false),
      comment: async (slug, comment) =>
        dir ? appendLocalComment(repoRoot, slug, comment, dir) : false,
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
 * Local/Obsidian tickets get a `## Log` entry in their markdown; GitHub and
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
    return 'Ticket provider: Linear. Use the configured Linear MCP/CLI for ticket reads/writes. Do not create or edit local backlog markdown files for ticket state.'
  }
  if (provider.kind === 'obsidian') {
    return "Ticket provider: Obsidian. Tickets are NNNN-slug.md markdown files in this repo's configured Obsidian vault (NOT in the repo). Prefer the TerMinal ticket tools / terminal-cli ticket commands, which read/write the vault automatically. For raw browsing, the vault is at $OBSIDIAN_VAULT_PATH and its tickets at $OBSIDIAN_TICKETS_DIR — use your native file tools there, never inside the repo working tree."
  }
  return "Ticket provider: local backlog. Use this repo's .TerMinal/backlog markdown tickets (legacy repos may use backlog/)."
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
    if (provider === 'obsidian') {
      const dir = obsidianBaseDir(cfg.obsidian)
      if (!dir)
        return { ok: false, provider, message: 'Pick an Obsidian vault folder before saving.' }
      const vault = cfg.obsidian!.vaultPath.trim()
      if (!existsSync(vault))
        return { ok: false, provider, message: `Vault folder not found: ${vault}` }
      try {
        mkdirSync(dir, { recursive: true }) // ensure tickets/ exists + is writable
      } catch (e) {
        return {
          ok: false,
          provider,
          message: `Vault tickets folder not writable: ${(e as Error).message}`,
        }
      }
      const count = listLocalTickets(repoRoot, dir).length
      if (!opts.smoke)
        return { ok: true, provider, message: `Obsidian vault ready (${dir}).`, count }
      const smoke = createLocalTicket(
        repoRoot,
        {
          title: 'TerMinal smoke test - safe to delete',
          type: 'testing',
          priority: 'low',
          status: 'open',
          body: `Created by TerMinal ticket-provider smoke test at ${new Date().toISOString()}.`,
        },
        dir,
      )
      updateLocalTicket(repoRoot, smoke.slug, { priority: 'high' }, dir)
      updateLocalTicket(repoRoot, smoke.slug, { status: 'closed' }, dir)
      const after = getLocalTicket(repoRoot, smoke.slug, dir)
      return {
        ok: true,
        provider,
        message: `Obsidian smoke ticket ${smoke.slug}.md created, updated, and closed in ${dir}.`,
        count,
        smoke: { key: after?.slug, status: after?.status, priority: after?.priority },
      }
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
