import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

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
  aiTitle: string
  permissionMode: string
  lastPrompt: string
  toolCounts: Record<string, number>
  mtime: number
  ts: number
}

export type TaskItem = { id: string; subject: string; status: string; activeForm: string }

export type ActivityKind =
  | 'task-complete'
  | 'ticket-filed'
  | 'pr-verdict'
  | 'session-start'
  | 'agent-run'
  | 'error'
  | 'info'
export type ActivityEvent = {
  id: string
  ts: number
  kind: ActivityKind
  title: string
  detail?: string
  repo?: string
  repoRoot?: string
  sessionId?: string
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

export type ProjectSession = {
  slug: string
  id: number
  title: string
  status: string
  goal: string
  started: string
  ended: string
  anchor: string
  tickets: string[]
  branches: string[]
  prs: string[]
  body?: string
}

export type NewTicket = { title: string; type: string; priority: string; status: string; body: string }

export type Snippet = { id: string; title: string; body: string }

export type Settings = { telegram: boolean }

export type Engine = 'codex' | 'claude'
export type Agent = {
  id: string
  title: string
  description?: string
  icon?: string
  prompt: string
  opensPr?: boolean
  engine?: Engine
}
export type Persona = { id: string; title: string; description: string; icon?: string; prompt: string }
export type PipelineId = 'single' | 'review' | 'review-iterate'
export type PipelineInfo = { id: PipelineId; title: string; description: string }
export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  persona?: string
  pipeline?: string
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  worktree: string
  branch: string
  output: string
}

export type Cadence = 'hourly' | 'daily' | 'weekly'
export type Schedule = {
  id: string
  repoRoot: string
  repoLabel: string
  agentId: string
  agentTitle: string
  engine: Engine
  cadence: Cadence
  enabled: boolean
  lastRun?: number
}

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
}

export type Finding = {
  id?: string
  severity?: string
  title?: string
  text?: string
  body?: string
  file?: string
  line?: number
  status?: string
  agent_fix_prompt?: string
  category?: string
} & Record<string, unknown>

export type MrDetail = {
  iid: number
  title: string
  description: string
  state: string
  author: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  draft: boolean
  reviewMd: string
  reviewMeta: Review | null
  findings: Finding[]
  suggestions: Finding[]
  artifactShortSha: string
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
  hasSessions: boolean
  hasAgents: boolean
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

export type FleetSession = {
  key: string
  sessionId: string
  name: string
  cwd: string
  repo: string
  branch: string
  model: string
  status: 'working' | 'idle'
  contextPct: number
  contextTokens: number
  contextLimit: number
  turns: number
  aiTitle: string
  lastAction: { tool: string; detail: string } | null
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
  startSession: (key: string, opts: StartOpts) => Promise<{ sessionId: string; cwd: string }>
  setActiveSession: (key: string) => Promise<void>
  stopSession: (key: string) => Promise<void>
  fleet: () => Promise<FleetSession[]>
  pickDir: () => Promise<string | null>
  gauntletDirs: () => Promise<{ name: string; path: string }[]>
  scaffoldProject: (
    name: string,
    parentDir?: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  isFullscreen: () => Promise<boolean>
  onFullscreen: (cb: (v: boolean) => void) => () => void
  snippets: {
    list: () => Promise<Snippet[]>
    save: (list: Snippet[]) => Promise<boolean>
  }
  settings: {
    get: () => Promise<Settings>
    set: (key: keyof Settings, value: boolean) => Promise<Settings>
  }
  typeIntoActive: (text: string) => void
  agents: {
    list: () => Promise<Agent[]>
    personas: () => Promise<Persona[]>
    pipelines: () => Promise<PipelineInfo[]>
    run: (
      id: string,
      engine?: Engine,
      persona?: string,
      pipeline?: string,
    ) => Promise<AgentRun | { error: string }>
    runTicket: (
      slug: string,
      engine: Engine,
      persona?: string,
      pipeline?: string,
    ) => Promise<AgentRun | { error: string }>
    runPr: (
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
      kind: 'review' | 'iterate',
      engine: Engine,
      persona?: string,
      pipeline?: string,
    ) => Promise<AgentRun | { error: string }>
    runs: () => Promise<AgentRun[]>
    cancel: (runId: string) => Promise<boolean>
    removeWorktree: (runId: string) => Promise<boolean>
    onStatus: (cb: (run: AgentRun) => void) => () => void
    onOutput: (cb: (p: { runId: string; chunk: string }) => void) => () => void
  }
  schedules: {
    list: () => Promise<Schedule[]>
    add: (input: {
      agentId: string
      agentTitle: string
      engine: Engine
      cadence: Cadence
    }) => Promise<Schedule>
    remove: (id: string) => Promise<boolean>
    toggle: (id: string, enabled: boolean) => Promise<boolean>
  }
  activity: {
    list: () => Promise<ActivityEvent[]>
    clear: () => Promise<void>
    onEvent: (cb: (ev: ActivityEvent) => void) => () => void
  }
  pty: {
    input: (key: string, data: string) => void
    resize: (key: string, size: { cols: number; rows: number }) => void
    onData: (cb: (key: string, data: string) => void) => () => void
    onExit: (cb: (key: string, code: number) => void) => () => void
  }
  transcript: () => Promise<TranscriptStats>
  harnessTdd: () => Promise<TddInfo>
  usage: () => Promise<Usage>
  gitStatus: () => Promise<GitStatus>
  mrSummary: () => Promise<MrSummary>
  sessionTasks: () => Promise<TaskItem[]>
  meta: () => Promise<SessionInfo>
  listCommandWidgets: () => Promise<CommandWidget[]>
  runCommand: (command: string) => Promise<CommandResult>
  onTick: (cb: () => void) => () => void
  tabContext: () => Promise<TabContext>
  tickets: {
    list: () => Promise<Ticket[]>
    get: (slug: string) => Promise<Ticket | null>
    create: (input: NewTicket) => Promise<Ticket>
    update: (slug: string, patch: { status?: string; priority?: string }) => Promise<boolean>
  }
  projectSessions: () => Promise<ProjectSession[]>
  getProjectSession: (slug: string) => Promise<ProjectSession | null>
  listMrs: () => Promise<Mr[]>
  getMr: (iid: number) => Promise<MrDetail | null>
  getMrDiff: (iid: number) => Promise<string>
  openExternal: (url: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  clipboardRead: () => Promise<string>
  notes: {
    read: (scope: 'repo' | 'global') => Promise<string>
    write: (scope: 'repo' | 'global', content: string) => Promise<boolean>
  }
  files: {
    list: (rel: string) => Promise<FileEntry[]>
    read: (rel: string) => Promise<{ ok: boolean; content: string; reason?: string }>
    write: (rel: string, content: string) => Promise<boolean>
    search: (q: string) => Promise<{ file: string; line: number; text: string }[]>
    create: (rel: string, dir: boolean) => Promise<boolean>
    rename: (from: string, to: string) => Promise<boolean>
    del: (rel: string) => Promise<boolean>
  }
}

export type FileEntry = { name: string; path: string; dir: boolean; ignored?: boolean }
export type SearchHit = { file: string; line: number; text: string }
export type GitStatus = { ok: boolean; branch: string; ahead: number; behind: number; dirty: number }
export type MrSummary = { open: number; approve: number; changes: number; needsReview: number }

/** A full-screen tab. Auto-discovered from src/renderer/src/tabs/<id>/index.tsx. */
export type Tab = {
  id: string
  title: string
  icon: LucideIcon
  order?: number
  /** Whether this tab applies to the attached session's repo. */
  appliesTo: (ctx: TabContext) => boolean
  /** Optional live count shown as a pill on the tab (e.g. HITL items waiting). */
  badge?: (gt: GtApi) => Promise<number>
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
  icon: LucideIcon
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
