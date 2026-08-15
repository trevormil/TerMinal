import type { ModelTier } from './agents'

/** Linear's OWN schema, carried verbatim on Linear-provider tickets. The
 *  coerced Ticket fields (status/priority buckets, horizon, type) exist so
 *  provider-agnostic machinery keeps working; anything user-visible should
 *  prefer these native fields when present. Every field is optional-by-forgiveness:
 *  issues that don't match TerMinal's conventions must still render. */
export type LinearMeta = {
  /** e.g. "ENG-123". */
  identifier: string
  /** Exact workflow-state name, e.g. "In Review". */
  stateName: string
  /** Linear state category: triage | backlog | unstarted | started | completed | canceled. */
  stateType: string
  /** Linear's hex color for the state, when the API provides it. */
  stateColor?: string
  /** 0 none · 1 urgent · 2 high · 3 medium · 4 low. */
  priority: number
  /** "Urgent" | "High" | "Medium" | "Low" | "No priority". */
  priorityLabel: string
  assignee?: string
  labels: { name: string; color?: string }[]
  project?: string
  cycle?: string
  team?: string
  estimate?: number
  dueDate?: string
}

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
  /** Ticket ids this one is merely related to — no ordering implied. */
  related: number[]
  /** The canonical ticket this one duplicates, when it is a duplicate. */
  duplicateOf?: number
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
  /** Prose only — the `## Log` section is split out into `comments`. */
  body: string
  /** Timestamped log, oldest first. Written by humans and by agent runs. */
  comments: TicketComment[]
  provider?: 'local' | 'github' | 'linear'
  providerLabel?: string
  /** Linear-native fields — set only when provider === 'linear'. */
  linear?: LinearMeta
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

export type NewTicket = {
  title: string
  type: string
  priority: string
  status: string
  body: string
  acceptance?: string[]
  agent?: Partial<TicketAgent>
  /** Routing tier: auto | top | cheap-agentic | cheap-raw. Omitted → 'auto',
   *  which is exactly the value every ticket got before this was settable. */
  modelTier?: ModelTier
}

/** A comment as callers hand it in — the timestamp is stamped at write time. */
export type NewTicketComment = Omit<TicketComment, 'at'> & { at?: string }

export type TicketProviderKind = 'local' | 'github' | 'linear' | 'webview'

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

export type TicketGroupBy = 'status' | 'priority' | 'type' | 'horizon' | 'agent' | 'none'
export type TicketSortBy = 'id-desc' | 'id-asc' | 'updated-desc' | 'priority'

// Filtering, grouping, and sorting for the Tickets tab. Pure data, so the same
// spec drives the live toolbar and anything persisted in `.TerMinal/tickets.json`.
export type TicketViewSpec = {
  /** 'all' means no constraint on that axis. */
  type: string
  horizon: string
  priority: string
  status: string
  hitl: boolean
  /** Free text over title, id, and body. */
  q: string
  groupBy: TicketGroupBy
  sortBy: TicketSortBy
}

/** A named TicketViewSpec, persisted per repo. Distinct from `TicketView`,
 *  which is an embedded webview of an external platform. */
export type SavedTicketView = TicketViewSpec & { name: string }

export type GithubTicketConfig = {
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
    /** The Linear MCP tool that appends a comment. Defaults to `save_comment`. */
    comment?: string
  }
  team?: string
  teamKey?: string
  listArgs?: Record<string, unknown>
  /** linear.app workspace URL (e.g. https://linear.app/acme) — used for the
   *  auto-synthesized embedded Linear view. Falls back to https://linear.app,
   *  which redirects to the logged-in workspace. */
  workspace?: string
}

/** The whole per-repo tickets config, as stored in `.TerMinal/tickets.json`:
 *  the provider and its settings, plus the lenses (`views`, `savedViews`) that
 *  are independent of it. Travels verbatim over `tickets:provider-get`/`-save`,
 *  so it is declared once here rather than once per side of that wire. */
export type RepoTicketsConfig = {
  provider?: TicketProviderKind
  github?: GithubTicketConfig
  linear?: LinearTicketConfig
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

export type TicketComment = {
  /** ISO-8601 UTC, e.g. 2026-07-27T14:02:11.000Z */
  at: string
  /** Human username, or the agent id for `kind: 'agent'`. */
  author: string
  kind: 'human' | 'agent'
  /** engine/model behind an agent comment, e.g. `codex/gpt-5`. */
  via?: string
  body: string
}
