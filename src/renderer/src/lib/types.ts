import type { ReactNode } from 'react'

// Mirror of the preload `gt` bridge. Kept hand-written so plugins have a clean
// typed surface without reaching across tsconfig roots into the preload build.
export type TranscriptStats = {
  ok: boolean
  sessionId: string
  model: string
  cwd: string
  gitBranch: string
  contextTokens: number
  contextLimit: number
  contextPct: number
  totalInputTokens: number
  totalOutputTokens: number
  estCostUsd: number
  turns: number
  lastAction: { tool: string; detail: string } | null
  firstUserText: string
  mtime: number
  ts: number
}

export type UsageWindow = { pct: number; resetsAt: number | null } | null
export type Usage = {
  ok: boolean
  plan: string
  tier: string
  fiveHour: UsageWindow
  sevenDay: UsageWindow
  overagePct: number | null
  stale: boolean
  error?: string
  ts: number
}

export type CommandWidget = {
  id: string
  title: string
  icon?: string
  command: string
  intervalMs: number
  mode: 'text' | 'big' | 'kv'
  source: 'global' | 'repo'
}

export type CommandResult = { ok: boolean; stdout: string; code: number }

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

export type NewTicket = { title: string; type: string; priority: string; status: string; body: string }

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
}

export type Mr = {
  iid: number
  title: string
  state: string
  author: string
  webUrl: string
  sourceBranch: string
  draft: boolean
  review: Review | null
}

export type TabContext = {
  cwd: string
  sessionId: string
  repoRoot: string
  repoPath: string
  repoHost: string
  hasBacklog: boolean
}

export type SessionMeta = {
  id: string
  cwd: string
  gitBranch: string
  model: string
  turns: number
  firstUserText: string
  mtime: number
}

export type StartOpts = {
  mode: 'new' | 'resume'
  sessionId?: string
  cwd?: string
  name?: string
  cols: number
  rows: number
}

export type SessionInfo = {
  sessionId: string
  cwd: string
  mode: '' | 'new' | 'resume'
  name: string
  claude: string
}

export type TddInfo = {
  ok: boolean
  repo: string
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  ts: number
}

export type GtApi = {
  listSessions: () => Promise<SessionMeta[]>
  startSession: (opts: StartOpts) => Promise<{ sessionId: string; cwd: string }>
  pickDir: () => Promise<string | null>
  pty: {
    input: (data: string) => void
    resize: (size: { cols: number; rows: number }) => void
    onData: (cb: (data: string) => void) => () => void
    onExit: (cb: (code: number) => void) => () => void
  }
  transcript: () => Promise<TranscriptStats>
  harnessTdd: () => Promise<TddInfo>
  usage: () => Promise<Usage>
  meta: () => Promise<SessionInfo>
  listCommandWidgets: () => Promise<CommandWidget[]>
  runCommand: (command: string) => Promise<CommandResult>
  onTick: (cb: () => void) => () => void
  tabContext: () => Promise<TabContext>
  tickets: {
    list: () => Promise<Ticket[]>
    get: (slug: string) => Promise<Ticket | null>
    create: (input: NewTicket) => Promise<Ticket>
  }
  listMrs: () => Promise<Mr[]>
  openExternal: (url: string) => Promise<void>
}

/** A full-screen tab. Auto-discovered from src/renderer/src/tabs/<id>/index.tsx. */
export type Tab = {
  id: string
  title: string
  icon: string
  order?: number
  /** Whether this tab applies to the attached session's repo. */
  appliesTo: (ctx: TabContext) => boolean
  Component: (props: { ctx: TabContext }) => ReactNode
}

declare global {
  interface Window {
    gt: GtApi
  }
}

/**
 * A plugin is just a folder under src/renderer/src/plugins/<id>/index.tsx that
 * default-exports one of these. Drop a folder in, it auto-registers. To add your
 * own: fork the repo, copy a plugin folder, change `poll` + `render`.
 */
export type Plugin<T = unknown> = {
  id: string
  title: string
  icon: string
  blurb: string
  order?: number
  intervalMs: number
  defaultEnabled: boolean
  /** Re-poll immediately when the attached session's transcript changes (not just on interval). */
  realtime?: boolean
  /** Called on an interval. `prev` is the previous poll result (for rate/delta widgets). */
  poll: (gt: GtApi, prev: T | null) => Promise<T>
  render: (data: T | null) => ReactNode
}
