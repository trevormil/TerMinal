import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { NotifyMatrix } from '../../../shared/notifications'

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

export type ObservabilitySession = {
  id: string
  engine: Engine
  title: string
  cwd: string
  repo: string
  gitBranch: string
  model: string
  turns: number
  mtime: number
  telemetry: 'ready' | 'metadata-only'
  contextTokens: number
  contextLimit: number
  contextPct: number
  totalInputTokens: number
  totalOutputTokens: number
  estCostUsd: number
  toolCounts: Record<string, number>
  toolTotal: number
  lastAction: { tool: string; detail: string } | null
  firstUserText: string
}

export type ObservabilityEventKind =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'token_snapshot'
  | 'agent_launch'
  | 'skill_invoke'
  | 'warning'
  | 'parse_error'

export type ObservabilityTokenSnapshot = {
  timestamp: number
  input: number
  output: number
  cachedInput: number
  total: number
  contextTokens: number
  cumulativeInput: number
  cumulativeOutput: number
  cumulativeTotal: number
}

export type ObservabilityTimelineEvent = {
  id: string
  sessionId: string
  timestamp: number
  line: number
  kind: ObservabilityEventKind
  severity: 'info' | 'warning' | 'error'
  turnId?: string
  callId?: string
  toolName?: string
  previewText: string
  argumentsPreview?: string
  argumentsBytes?: number
  commandPreview?: string
  outputPreview?: string
  outputBytes?: number
  durationMs?: number
  resultEventId?: string
  joinedOutputPreview?: string
  tokenSnapshot?: ObservabilityTokenSnapshot
  agentRole?: string
  agentTaskPreview?: string
  skillName?: string
}

export type ObservabilityToolCall = {
  callId: string
  toolName: string
  startedAt: number
  completedAt?: number
  line: number
  completedLine?: number
  turnId?: string
  status: 'open' | 'ok' | 'error'
  argumentsPreview?: string
  argumentsBytes?: number
  commandPreview?: string
  outputPreview?: string
  outputBytes?: number
  durationMs?: number
  resultEventId?: string
  agentRole?: string
  skillName?: string
}

export type ObservabilityToolCallPayload = {
  sessionId: string
  callId: string
  toolName: string
  status: 'open' | 'ok' | 'error'
  inputText: string
  outputText: string
  inputBytes: number
  outputBytes: number
  sourceFile: string
  startedLine: number
  completedLine?: number
  commandText?: string
  skillName?: string
  agentRole?: string
  error?: string
}

export type ObservabilityTranscriptLine = {
  line: number
  text: string
  timestamp?: number
  role?: string
  kind?: string
  callId?: string
  toolName?: string
}

export type ObservabilityTranscriptWindow = {
  sessionId: string
  sourceFile: string
  startLine: number
  endLine: number
  totalLines: number
  lines: ObservabilityTranscriptLine[]
  error?: string
}

export type ObservabilityTurn = {
  id: string
  startedAt: number
  completedAt: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  toolCalls: number
  lastMessage: string
}

export type ObservabilityAgentGraph = {
  nodes: {
    id: string
    label: string
    role: string
    depth: number
    tokens: number
    status: 'root' | 'open' | 'closed' | 'failed'
    taskPreview?: string
  }[]
  edges: {
    id: string
    from: string
    to: string
    status: 'open' | 'closed' | 'failed'
    toolCallId?: string
  }[]
}

export type ObservabilitySessionDetail = {
  session: ObservabilitySession
  events: ObservabilityTimelineEvent[]
  toolCalls: ObservabilityToolCall[]
  tokenSnapshots: ObservabilityTokenSnapshot[]
  turns: ObservabilityTurn[]
  graph: ObservabilityAgentGraph
  warnings: string[]
}

export type ObservabilitySnapshot = {
  ts: number
  sessions: ObservabilitySession[]
  totals: {
    sessions: number
    readySessions: number
    tokens: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    toolCalls: number
  }
  byEngine: Record<
    string,
    { sessions: number; readySessions: number; tokens: number; costUsd: number; toolCalls: number }
  >
  byRepo: Record<string, { sessions: number; tokens: number; costUsd: number; toolCalls: number }>
  topTools: { tool: string; count: number }[]
}

export type ObservabilityIndexStatus = {
  ok: boolean
  dbPath: string
  exists: boolean
  sqliteAvailable: boolean
  indexedAt: number | null
  sessions: number
  turns: number
  toolCalls: number
  tokenSnapshots: number
  events: number
  error?: string
}

export type ObservabilityIndexBuildResult = ObservabilityIndexStatus & {
  durationMs: number
  indexedSessions: number
}

export type ObservabilityIndexQueryId =
  | 'sessions_by_tokens'
  | 'low_yield_sessions'
  | 'tool_calls'
  | 'tool_payloads'
  | 'tool_errors'
  | 'tool_call_bloat'
  | 'turn_hotspots'
  | 'costliest_turns'
  | 'model_rollup'
  | 'repo_rollup'
  | 'session_events'
  | 'audit'

/** Mirror of ObservabilityQueryFilter in src/main/observability-index.ts. */
export type ObservabilityQueryFilter = {
  since?: number
  until?: number
  repo?: string
  engine?: string
  model?: string
}

/** Mirror of Stack in src/main/stacks.ts — one GitHub native PR stack, layers
 *  ordered bottom-to-top. Named PrStack here to avoid colliding with the DOM. */
export type PrStack = {
  id: number
  size: number
  baseRef: string
  layers: { iid: number; position: number }[]
}

/** Mirror of DeliveryRecord in src/main/notify-log.ts. */
export type DeliveryRecord = {
  ts: number
  channel: string
  ok: boolean
  title: string
  error?: string
}

export type ObservabilityIndexQueryResult = {
  query: ObservabilityIndexQueryId
  title: string
  description: string
  columns: string[]
  rows: Record<string, unknown>[]
  indexedAt: number | null
  dbPath: string
  needsArg?: 'session_id'
  error?: string
}

export type TaskItem = { id: string; subject: string; status: string; activeForm: string }

// Mirror of src/main/events.ts ActivityKind — keep in sync with the tab's
// ICON / KIND_LABEL / activityTone maps. Unknown kinds fall back gracefully.
export type ActivityKind =
  | 'session-start'
  | 'session-end'
  | 'deploy'
  | 'ticket-filed'
  | 'ticket-closed'
  | 'pr-opened'
  | 'pr-verdict'
  | 'pr-merged'
  | 'tests-pass'
  | 'tests-fail'
  | 'check'
  | 'doc'
  | 'agent-run'
  | 'task-complete'
  | 'blocked'
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
  ref?: { ticket?: number; pr?: number }
  runId?: string
  runSource?: 'cron' | 'agent' | 'bg' | 'session'
  suppressTelegram?: boolean
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
  /** Global entries are always live; repo entries only once the repo's command
   *  set has been approved (see src/main/repo-trust.ts). */
  trusted: boolean
}

export type CommandResult = { ok: boolean; stdout: string; code: number }

// A declarative full-screen tab, the tab analogue of CommandWidget. Either a
// `url` (embedded) or a `command` (stdout HTML, re-polled every intervalMs).
export type CustomTab = {
  id: string
  title: string
  icon?: string
  source: 'global' | 'repo'
  url?: string
  command?: string
  intervalMs?: number
  /** See CommandWidget.trusted. */
  trusted: boolean
}

export type TabRunResult = { ok: boolean; html: string; code: number }

// The approval prompt's payload: the literal commands a repo wants to run, so
// the user approves something they can actually read.
export type RepoTrustStatus = {
  repoRoot: string
  hash: string
  trusted: boolean
  commands: string[]
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
  depends_on: number[]
  /** Ticket ids this one is merely related to — no ordering implied. */
  related?: number[]
  /** The canonical ticket this one duplicates. */
  duplicateOf?: number
  /** Strict, checkable criteria for a correct/best implementation. Required
   *  when running >1 lane (lanes are gated + ranked against these). */
  acceptance: string[]
  /** Recommended model tier (downgrade gate): auto | top | cheap-agentic | cheap-raw. */
  modelTier: string
  /** Model(s) that authored the implementation, stamped when the MR opens. */
  workedBy: string[]
  agent: TicketAgent
  run?: TicketRunLink
  /** Prose only — the `## Log` section is split out into `comments`. */
  body: string
  /** Timestamped log, oldest first. Remote workspaces may omit it. */
  comments?: TicketComment[]
  provider?: 'local' | 'github' | 'linear' | 'obsidian'
  providerLabel?: string
  externalId?: string
  externalKey?: string
  url?: string
}
export type TicketAgent = { id: string; scope: 'repo' | 'global'; kind: 'classic' | 'persistent' }
/** Mirrors TicketComment in src/main/ticket-comments.ts. */
export type TicketComment = {
  /** ISO-8601 UTC. */
  at: string
  /** Human username, or the agent id when `kind` is 'agent'. */
  author: string
  kind: 'human' | 'agent'
  /** engine/model behind an agent comment, e.g. `codex/gpt-5`. */
  via?: string
  body: string
}
/** A comment as the renderer submits it. `at` is stamped in main, and `author`
 *  defaults to the repo's git identity, so the UI only has to send a body. */
export type NewTicketComment = {
  body: string
  author?: string
  kind?: 'human' | 'agent'
  via?: string
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

export type NewTicket = {
  title: string
  type: string
  priority: string
  status: string
  body: string
  agent?: Partial<TicketAgent>
  /** Routing tier. Omitted → 'auto'. */
  modelTier?: ModelTier
}
/** Mirrors ModelTier in src/main/resolve-model.ts — the renderer cannot import
 *  from main, so the union is restated here and must stay in step. */
export type ModelTier = 'auto' | 'top' | 'cheap-agentic' | 'cheap-raw'
import type { SavedTicketView } from './ticketViews'

export type TicketProviderKind = 'local' | 'github' | 'linear' | 'obsidian' | 'webview'
export type ObsidianTicketConfig = { vaultPath: string; ticketsSubdir?: string; vaultName?: string }
/** A repo whose Tickets tab IS an embedded page — no local backlog, no CRUD.
 *  See WebviewTicketConfig in src/main/ticket-provider.ts for the full contract. */
export type WebviewTicketConfig = { url: string; label?: string }
export type TicketProviderConfig = {
  provider?: TicketProviderKind
  github?: {
    statusLabels?: Record<string, string>
    priorityLabels?: Record<string, string>
    typeLabels?: Record<string, string>
  }
  linear?: {
    mcp?: { command?: string; args?: string[]; env?: Record<string, string> }
    tools?: { list?: string; get?: string; create?: string; update?: string }
    team?: string
    teamKey?: string
    listArgs?: Record<string, unknown>
  }
  obsidian?: ObsidianTicketConfig
  webview?: WebviewTicketConfig
  views?: TicketView[]
  /** Named filter/group/sort lenses. See SavedTicketView in ticketViews.ts. */
  savedViews?: SavedTicketView[]
}
// A read-only embedded web view of an external ticket platform, rendered as a
// source sub-tab in the Tickets tab. Independent of `provider` — see
// `TicketView` in src/main/ticket-provider.ts for the full contract.
export type TicketView = { label: string; url: string; default?: boolean }
export type TicketProviderTestResult = {
  ok: boolean
  provider: TicketProviderKind
  message: string
  count?: number
  teams?: { id: string; name: string; key?: string }[]
  smoke?: { key?: string; url?: string; status?: string; priority?: string }
}

export type DocCategory =
  'changelog' | 'decisions' | 'maintainer' | 'developer' | 'personal' | 'reports' | 'other'
export type DocEntry = {
  path: string
  title: string
  category: DocCategory
  managedBy?: string
  subgroup?: string // for 'reports': the agent name (second path segment)
}
export type DocsTree = {
  categories: { id: DocCategory; label: string; items: DocEntry[] }[]
}

// From the shared registry — was a third copy of the same union.
export type Engine = import('../../../shared/engines').EngineId
export type SessionEngine = import('../../../shared/engines').SessionEngineId
export type EngineCfg = { path: string; defaultModel: string; baseUrl: string }
export type ForgePref = 'auto' | 'github' | 'gitlab'
export type TelegramCfg = { notify: boolean; control: boolean; botToken: string; chatId: string }
export type AlertsCfg = {
  desktop: { enabled: boolean }
  webhook: { enabled: boolean; url: string }
}
export type AlertChannelId = 'telegram' | 'desktop' | 'webhook'
export type InboxCfg = {
  completionHook: boolean
  agentContextPreamble: boolean
  /** Minimum severity that fires a notification; below it, items are inbox-only. */
  notifyThreshold: 'urgent' | 'normal' | 'low'
}
// Mobile bridge (TerMinal Remote for iOS). Token + TLS cert live outside
// settings.json — see src/main/bridge/identity.ts.
export type BridgeCfg = { enabled: boolean; port: number }
export type DaemonCfg = {
  projectsDir: string
  worktreesDir: string
  harnessDir: string
  templateRepo: string
  engines: Record<Engine, EngineCfg>
  defaultEngine: Engine
  forge: ForgePref
}
export type AppearanceMode = 'dark' | 'light' | 'system'
export type AppearanceTabLayout = 'horizontal' | 'sidebar'
export type AppearanceCfg = {
  mode: AppearanceMode
  theme: string
  accent: string
  uiScale: number
  tabLayout: AppearanceTabLayout
}
export type AppsCfg = { editor: string; browser: string; formatOnSave: boolean }
export type SuggestionsCfg = {
  aiEngine: Engine
  aiModel: string
  autoEngine: Engine
  autoModel: string
}
export type NoteFolder = { id: string; title: string; path: string }
export type KnowledgeScope = 'repo' | 'global'
export type KnowledgeItemKind = 'markdown' | 'link' | 'image' | 'video' | 'file' | 'rag'
export type KnowledgeCategory = {
  id: string
  title: string
  description?: string
  order: number
  createdAt: number
  updatedAt: number
}
export type KnowledgeItem = {
  id: string
  categoryId: string
  kind: KnowledgeItemKind
  title: string
  description?: string
  content?: string
  url?: string
  path?: string
  thumbnailUrl?: string
  faviconUrl?: string
  siteName?: string
  rag?: KnowledgeRagConfig
  tags: string[]
  createdAt: number
  updatedAt: number
}
export type KnowledgeRagConfig = {
  rootDir?: string
  command?: string
  args?: string[]
  category?: string
  hybridAlpha?: number
  maxResults?: number
}
export type KnowledgeRagStatus = {
  ok: boolean
  rootDir: string
  documentsDir: string
  dataDir: string
  command: string
  args: string[]
  stats?: unknown
  error?: string
}
export type KnowledgeRagSearchResult = {
  ok: boolean
  query: string
  rootDir: string
  results: unknown[]
  raw?: unknown
  error?: string
}
export type KnowledgeBase = {
  version: 1
  categories: KnowledgeCategory[]
  items: KnowledgeItem[]
}
export type KnowledgePreview = {
  ok: boolean
  url: string
  title?: string
  description?: string
  thumbnailUrl?: string
  faviconUrl?: string
  siteName?: string
  error?: string
}
export type RemotePlatform = 'auto' | 'linux' | 'macos'
export type RemoteHost = {
  id: string
  label: string
  sshTarget: string
  defaultCwd: string
  platform: RemotePlatform
  daemon: DaemonCfg
}
export type PinnedPanel = { label: string; url: string }
export type WorkingDiff = {
  ok: boolean
  diff: string
  base: string
  branch: string
  error?: string
}
export type Settings = {
  onboarded: boolean
  projectsDir: string
  worktreesDir: string
  engines: Record<Engine, EngineCfg>
  defaultEngine: Engine
  forge: ForgePref
  telegram: TelegramCfg
  alerts: AlertsCfg
  inbox: InboxCfg
  notifications: { matrix: NotifyMatrix }
  bridge: BridgeCfg
  appearance: AppearanceCfg
  apps: AppsCfg
  suggestions: SuggestionsCfg
  noteFolders: NoteFolder[]
  remoteHosts: RemoteHost[]
  harnessDir: string
  templateRepo: string
  pinnedPanels: PinnedPanel[]
  openrouterApiKey: string
  openaiCompatApiKey: string
  /**
   * Which sealed secrets are set. `settings:get` masks the VALUES (see
   * src/main/settings-mask.ts), so this is the only way the UI can tell
   * "configured" from "not configured". Keyed by the dotted path
   * (`telegram.botToken`, `alerts.webhook.url`, `openrouterApiKey`, …).
   * Absent on any Settings object that didn't come from `settings:get`.
   */
  secretsSet?: Record<string, boolean>
}
export type SettingsPatch = Partial<
  Omit<
    Settings,
    'telegram' | 'alerts' | 'inbox' | 'bridge' | 'appearance' | 'engines' | 'apps' | 'suggestions'
  >
> & {
  telegram?: Partial<TelegramCfg>
  alerts?: {
    desktop?: Partial<AlertsCfg['desktop']>
    webhook?: Partial<AlertsCfg['webhook']>
  }
  inbox?: Partial<InboxCfg>
  bridge?: Partial<BridgeCfg>
  appearance?: Partial<AppearanceCfg>
  engines?: Partial<Record<Engine, Partial<EngineCfg>>>
  apps?: Partial<AppsCfg>
  suggestions?: Partial<SuggestionsCfg>
  noteFolders?: NoteFolder[]
}

export type StorageEntry = {
  path: string
  bytes: number
}

export type WorktreeStoreReport = {
  bytes: number
  thresholdBytes: number
  planned: StorageEntry[]
  deleted: StorageEntry[]
  protectedRunning: StorageEntry[]
  protectedDirty: StorageEntry[]
}

export type TerminalStateSweepReport = {
  root: string
  dryRun: boolean
  totalBytes: number
  reclaimableBytes: number
  reclaimedBytes: number
  worktrees: WorktreeStoreReport
  agentWorktrees: WorktreeStoreReport & { dir: string }
  leftovers: {
    bytes: number
    planned: StorageEntry[]
    deleted: StorageEntry[]
  }
  logs: {
    bytes: number
    maxBytes: number
    planned: StorageEntry[]
    rotated: StorageEntry[]
  }
  checkpoints: {
    bytes: number
    thresholdBytes: number
    stores: {
      maxAgeMs: number
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
    gc: {
      planned: StorageEntry[]
      completed: (StorageEntry & { error?: string })[]
    }
    tmpObjects: {
      planned: StorageEntry[]
      deleted: StorageEntry[]
    }
  }
  scratch: {
    bytes: number
    clearable: boolean
  }
}

export type ScratchClearReport = {
  path: string
  bytes: number
  deleted: boolean
}

/** Tool/engine readiness probed by the main process (env:detect). */
export type EnvDetect = {
  codex: { found: boolean; path: string }
  claude: { found: boolean; path: string }
  cursor: { found: boolean; path: string }
  hermes: { found: boolean; path: string }
  gh: { found: boolean; path: string; authed: boolean; authHost: string }
  glab: { found: boolean; path: string; authed: boolean; authHost: string }
  tgScripts: boolean
  apps: { editors: string[]; browsers: string[] }
}
export type RemoteSettingsProbe = {
  ok: boolean
  error?: string
  cwd?: string
  repoRoot?: string
  engines: Record<Engine, string>
  tools: Record<string, string>
}
export type ProjectsDirValidation =
  | { ok: true; dir: string; repoCount?: number }
  | {
      ok: false
      reason: 'is-repo' | 'error'
      dir: string
      suggestedParent?: string
      message: string
    }
  | {
      ok: false
      reason: 'no-repos-found'
      dir: string
      suggestedChild?: string
      suggestedCount?: number
      message: string
    }
export type ProjectsDirSuggestion = { dir: string; repoCount: number } | null
export type RemoteDirEntry = { name: string; path: string; dir: true }
export type RemoteDirList = {
  cwd: string
  parent: string
  entries: RemoteDirEntry[]
  error?: string
}
export type BootstrapStatus = {
  state: 'full' | 'partial' | 'none'
  bootstrapped: boolean
  missing: string[]
  message: string
}

export type Agent = {
  id: string
  title: string
  description?: string
  icon?: string
  prompt: string
  opensPr?: boolean
  engine?: Engine
  model?: string
  modelPolicy?: AgentModelPolicy
  quality?: AgentQuality
  outputContract?: string
  acceptanceCriteria?: string[]
  inPlace?: boolean
  /** FORCE MODE — bypasses the main-branch push gate. UI shows a red FORCE chip. */
  force?: boolean
  source?: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global'
  hasScript?: boolean
}
export type AgentModelPolicy = {
  default?: string
  cheap?: string
  deep?: string
  judge?: string
  allowOverride?: boolean
}
export type AgentCheck = {
  id: string
  title: string
  command: string
  cwd?: 'repo' | 'worktree'
  required?: boolean
  timeoutMs?: number
}
export type AgentJudge = {
  enabled?: boolean
  mode?: 'deterministic' | 'llm' | 'hybrid'
  model?: string
  rubric?: string[]
  passThreshold?: number
}
export type AgentQuality = {
  acceptanceCriteria?: string[]
  requiredArtifacts?: string[]
  deterministicChecks?: AgentCheck[]
  judge?: AgentJudge
}
export type AgentRunEvaluationCheck = {
  id: string
  title: string
  command?: string
  status: 'pass' | 'fail' | 'skipped'
  required?: boolean
  detail?: string
}
export type AgentRunEvaluation = {
  status: 'pass' | 'fail' | 'incomplete'
  evaluatedAt: number
  summary: string
  checks: AgentRunEvaluationCheck[]
  judge?: {
    enabled: boolean
    mode?: AgentJudge['mode']
    status: 'not-run'
    model?: string
    detail: string
  }
}
export type AgentRunTrace = {
  ticketSlug?: string
  ticketId?: number
  ticketRef?: string
  prIid?: number
  prKind?: 'review' | 'iterate'
  sourceBranch?: string
}
export type AgentDefinition = {
  id: string
  ref: { id: string; scope: 'repo' | 'global'; kind: 'classic' | 'persistent' }
  title: string
  description?: string
  icon?: string
  scope: 'repo' | 'global'
  kind: 'classic' | 'persistent'
  source: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global' | 'persistent'
  runtime: {
    engine?: Engine
    model?: string
    modelPolicy?: AgentModelPolicy
    mode: 'prompt' | 'script' | 'persistent'
    scriptPath?: string
    memoryDir?: string
    inPlace?: boolean
    opensPr?: boolean
    force?: boolean
  }
  instructions: {
    prompt?: string
    system?: string
    knowledgePolicy?: 'minimal' | 'standard' | 'deep'
    outputContract?: string
  }
  quality: AgentQuality
  metadata: {
    tags?: string[]
    createdAt?: number
    updatedAt?: number
    lastRunAt?: number
  }
}
export type PersistentAgentFiles = {
  instructions: string
  memory: string
  state: string
  journal: string
}
export type PersistentAgent = {
  id: string
  title: string
  description?: string
  engine: Engine
  model?: string
  modelPolicy?: AgentModelPolicy
  quality?: AgentQuality
  tags: string[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  dir: string
}
export type PersistentAgentDetail = PersistentAgent & {
  files: PersistentAgentFiles
}
export type PersistentArtifactFile = {
  name: string
  path: string
  size: number
  mtime: number
  kind: 'markdown' | 'json' | 'image' | 'html' | 'text' | 'other'
}
export type PersistentArtifact = {
  id: string
  title: string
  kind: string
  path: string
  createdAt: number
  summary?: string
  runId?: string
  primaryPath?: string
  files: PersistentArtifactFile[]
}
export type PersistentArtifactRead =
  | {
      ok: true
      kind: PersistentArtifactFile['kind']
      content: string
      dataUrl?: string
      path: string
    }
  | { ok: false; reason: string; path?: string }
// Per-(repo, agent) state sidecar — the runtime owns lastScannedSha /
// lastScannedRef / lastRunAt / lastRunId; scripts can pin arbitrary
// string keys beyond that via `terminal-cli state set <key> <value>`.
export type AgentStateRecord = {
  lastScannedSha?: string
  lastScannedRef?: string
  lastRunAt?: number
  lastRunId?: string
  [key: string]: unknown
}
export type Persona = {
  id: string
  title: string
  description: string
  icon?: string
  prompt: string
  agentId?: string
  agentScope?: 'repo' | 'global'
  agentKind?: 'classic' | 'persistent'
}
export type PipelineId = 'single' | 'review' | 'review-iterate'
export type PipelineInfo = { id: PipelineId; title: string; description: string }
export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
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
  /** Snapshot at run-time of the agent's force flag. */
  force?: boolean
  trace?: AgentRunTrace
  evaluation?: AgentRunEvaluation
}

export type ScheduleSpec =
  | { kind: 'calendar'; minute: number; hour: number; weekdays?: number[] }
  | { kind: 'cron'; expr: string }
export type ScheduleRetry = { maxRetries: number; backoffSec: number }
export type ScheduleStatus = 'never' | 'running' | 'done' | 'failed'
export type ScheduleEnv = Record<string, string>
export type Schedule = {
  id: string
  repoRoot: string
  repoLabel: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
  prompt: string
  spec: ScheduleSpec
  enabled: boolean
  env?: ScheduleEnv
  // Where/how this schedule fires (ADR-0002). host absent → local launchd; a
  // hostId → that always-on host via systemd. runtime absent/'bare' → engine in
  // a worktree; 'container' → Docker image (opt-in, #13).
  host?: string
  runtime?: 'bare' | 'container' | 'k8s'
  // Optional flaky-run controls (see main/schedules.ts). Absent → runner defaults.
  retry?: ScheduleRetry
  timeoutSec?: number
  createdAt: number
  lastRun?: number
  lastStatus?: ScheduleStatus
  lastRunId?: string
  // added by schedules:list
  describe?: string
  nextRun?: number | null
  // Whether launchd has the job loaded. undefined for disabled schedules /
  // remote lists; false = enabled but dark (won't fire until reconciled).
  loaded?: boolean
}
export type WindowStats = {
  events: number
  ticketsFiled: number
  ticketsClosed: number
  prsOpened: number
  prsMerged: number
  reviews: number
  testsPass: number
  testsFail: number
  agentRuns: number
  checks: number
  docs: number
  blocked: number
}
export type RunStats = {
  total: number
  done: number
  failed: number
  running: number
  successRate: number
}
export type CycleStats = {
  merged: number
  medianHours: number | null
  fileToOpenHours: number | null
  openToMergeHours: number | null
}
export type Funnel = { filed: number; opened: number; merged: number }
/** A kill-switched schedule, with why + when it went dark. */
export type DisabledEntry = {
  id: string
  reason?: string
  /** epoch ms; 0 for legacy records written before reasons existed. */
  disabledAt: number
}
/** Per-agent reliability rollup over the last N runs. Computed from the run
 *  stores already on disk — no new collection. */
export type AgentScorecard = {
  agentId: string
  agentTitle: string
  total: number
  done: number
  failed: number
  running: number
  /** null when nothing has settled — unknown, not 0% reliable. */
  successRate: number | null
  avgCostUsd?: number
  totalCostUsd?: number
  avgDurationMs?: number
  evaluated: number
  evalPass: number
  evalFail: number
  evalIncomplete: number
  failingChecks: { id: string; title: string; count: number }[]
  lastRunAt?: number
  lastStatus?: string
}
export type CompactionResult = {
  compacted: boolean
  reason?: string
  archivePath?: string
  bytesBefore?: number
  bytesAfter?: number
}
export type FactoryHealth = {
  generatedAt: number
  window24h: WindowStats
  window7d: WindowStats
  agents: RunStats
  cron: RunStats & { recentFailures: number }
  hitlOpen: number
  disabled: DisabledEntry[]
  disabledCount: number
  cycle: CycleStats
  funnel: Funnel
  recentFailures: { title: string; ts: number; repo: string; kind: string }[]
  daily: { day: string; count: number }[]
  byRepo: { repo: string; events: number }[]
}
export type HitlSource =
  | 'manual'
  | 'cron-fail'
  | 'agent'
  | 'factory'
  | 'skill'
  | 'listener'
  | 'completion-hook'
  | 'review-pattern'
  | 'monitor'
/** A session currently mirrored to the phone (registered + not ended). */
export type RemoteActiveSession = {
  id: string
  title: string
  agentSessionId?: string
  cwd: string
  status: string
}
/** Native CI — mirror of src/main/ci.ts. Forge-agnostic run/job/log views. */
export type CiRunStatus =
  'queued' | 'in_progress' | 'success' | 'failed' | 'canceled' | 'skipped' | 'pending'
export type CiRun = {
  id: string
  name: string
  status: CiRunStatus
  branch: string
  shortSha: string
  event: string
  webUrl: string
  createdAt: number
  updatedAt: number
  durationMs: number | null
}
export type CiTabStep = {
  name: string
  status: CiRunStatus
  number: number
}
export type CiTabJob = {
  id: string
  name: string
  stage: string
  status: CiRunStatus
  webUrl: string
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  steps?: CiTabStep[]
}
export type CiListResult = { runs: CiRun[]; error?: string }
export type CiJobsResult = { jobs: CiTabJob[]; error?: string }
export type CiLogResult = { log: string; truncated?: boolean; error?: string }

export type MonitorSaveResult = {
  ok: boolean
  saved: number
  rejected: number
  error?: string
}

/** Monitoring subsystem — mirror of src/main/monitors.ts. Deterministic infra
 *  observability, no inference. */
export type MonitorType = 'http' | 'tls-cert' | 'tcp' | 'dns' | 'command'
export type MonitorState = 'ok' | 'warn' | 'fail'
export type MonitorNotify = {
  onFailure: 'urgent' | 'normal' | 'low' | 'off'
  onRecovery: boolean
  renotifyAfterSec: number
  dailyDigest: boolean
  digestHour: number
}
export type Monitor = {
  id: string
  name: string
  type: MonitorType
  target: string
  intervalSec: number
  enabled: boolean
  group?: string
  notify: MonitorNotify
  config: Record<string, unknown>
}
export type MonitorStatusState = {
  id: string
  status: MonitorState
  summary: string
  metrics?: Record<string, unknown>
  detail?: {
    sections: {
      title: string
      items: { label: string; health: string; meta?: Record<string, unknown> }[]
    }[]
  }
  lastCheckedAt: number
  since: number
  lastTransition: { from: string; to: string; at: number } | null
  history: { at: number; status: string }[]
}
export type MonitorWithState = Monitor & { state: MonitorStatusState | null }
export type HitlItem = {
  id: string
  title: string
  detail?: string
  action?: string
  repo?: string
  repoRoot?: string
  source: HitlSource
  status: 'open' | 'resolved'
  /** urgent notifies; normal/low are inbox-only. Legacy 'push' reads as urgent. */
  severity?: 'urgent' | 'normal' | 'low' | 'push'
  /** Free-form Inbox grouping (ticket 120). Deliberately NOT a union — a caller
   *  names a category by passing one; absent ⇒ 'Uncategorized'. */
  category?: string
  /** When first seen; absent ⇒ unread. */
  readAt?: number
  createdAt: number
  resolvedAt?: number
  runId?: string
  runSource?: 'cron' | 'agent' | 'bg' | 'session'
  ticketPath?: string
  sessionId?: string
  terminalKey?: string
  terminalCwd?: string
  occurrenceCount?: number
  lastOccurredAt?: number
  // Stamped by the remote fan-out for a HITL filed by a host run (#14).
  hostId?: string
  hostLabel?: string
}
export type BgTask = {
  id: string
  repo: string
  repoRoot: string
  prompt: string
  engine: Engine
  model?: string
  worktree: string
  branch: string
  pid?: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  startedAt: number
  endedAt?: number
  exitCode?: number
  logFile: string
  mrUrl?: string
  label: string
}

export type LoopRecord = {
  id: string
  repo: string
  repoRoot: string
  goal: string
  mode: 'headless' | 'paired' | 'single'
  engine: Engine
  model?: string
  worktree: string
  branch: string
  status: 'idle' | 'running' | 'blocked' | 'done' | 'stopped'
  phase: 'negotiate' | 'generate' | 'evaluate' | 'decide' | 'done' | 'stopped'
  nextRole: 'planner' | 'generator' | 'evaluator'
  iteration: number
  activeRunId?: string
  activeRole?: 'planner' | 'generator' | 'evaluator'
  maxIterations: number
  createdAt: number
  updatedAt: number
}

export type LoopState = {
  phase: LoopRecord['phase']
  iteration: number
  bottleneck: string
  lastScore: string
  next: string
  assertions: { total: number; pass: number; fail: number; todo: number }
  tail: string[]
}

export type RunArtifact = {
  slug: string
  title: string
  agent?: string
  ok?: boolean
  createdAt?: string
  reportPath: string
  summary?: string
}
export type UnifiedRun = {
  id: string
  source: 'cron' | 'agent' | 'bg' | 'session'
  agentId: string
  agentTitle: string
  engine: string
  status: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  repoLabel: string
  branch: string
  worktree: string
  scheduleId?: string
  error?: string
  /** Snapshot at run-time of the agent's force flag. */
  force?: boolean
  /** USD cost when the harness reports it (OpenRouter/or-agent runs). */
  costUsd?: number
  trace?: AgentRunTrace
  evaluation?: AgentRunEvaluation
  /** Remote host this run came from. Undefined = local machine. */
  hostId?: string
  hostLabel?: string
  /** Best-effort two-line "what actually got done", written after the run
   *  settled. Absent when summarization was skipped or failed. */
  summary?: string
}

export type CronRun = {
  id: string
  scheduleId: string
  agentId: string
  agentTitle: string
  engine: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  exitCode?: number
  branch: string
  repoLabel: string
  worktree: string
  error?: string
}

export type ListenerDir = 'new' | 'processing' | 'done' | 'failed' | 'dead-letter'
// Mobile bridge (TerMinal Remote for iOS). The pairing payload carries the
// bearer token, so it is fetched on demand for the Settings pane only.
export type BridgeStatus = {
  enabled: boolean
  listening: boolean
  port: number
  error?: string
}
// Push readiness for the Settings pane. `configured` flips once an APNs key
// has been dropped next to the bridge identity.
// The Mac's own tailnet identity, shown in Settings so the phone knows the name
// to pair against.
export type BridgeTailscale =
  { available: true; dnsName: string; login: string } | { available: false }
export type BridgePushStatus = {
  configured: boolean
  devices: number
  config: string
  key: string
}
export type BridgePairing = {
  v: 1
  n: string // Mac display name
  p: number // port
  h: string[] // candidate hosts, tailnet first
  t: string // bearer token
  fp: string // base64 SHA-256 of the DER cert, pinned by the client
}

export type ListenerStatus = {
  enabled: boolean
  inboxDir: string
  dirs: Record<ListenerDir, string>
  counts: Record<ListenerDir, number>
  listeners: {
    id: string
    source: string
    type: string
    name?: string
    total: number
    new: number
    processing: number
    done: number
    failed: number
    deadLetter: number
    lastAt: number
    lastStatus: ListenerDir
    lastTitle?: string
    lastResult?: string
    lastRunId?: string
    lastRunSource?: 'agent' | 'bg'
    repoRoot?: string
  }[]
  recent: {
    file: string
    dir: ListenerDir
    id?: string
    listenerId?: string
    listenerName?: string
    source?: string
    type?: string
    title?: string
    repo?: string
    repoRoot?: string
    processedAt?: number
    error?: string
    action?: string
    result?: string
    runId?: string
    runSource?: 'agent' | 'bg'
  }[]
}

export type Review = {
  number: number
  overall: number | null
  verdict: string
  testStatus: string
  stale: boolean
  commitsBehind: number
  /** Canonical change blast-radius, 0-5 (null if unscored/tests-only). */
  riskScore: number | null
  /** Cross-PR triage: high/medium/low (or unscored if absent). Derived from
   *  riskScore when present, else the legacy risk_tier frontmatter field. */
  riskTier: 'high' | 'medium' | 'low' | 'unscored'
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
  screenshots: Screenshot[]
  artifactShortSha: string
  headShort: string
}

/** Reviewer-captured screenshot embedded in a code-review artifact. Present
 *  only when a visual/UX change made an image worth showing; image bytes ride
 *  along as a data URL so the renderer needs no filesystem access. */
export type Screenshot = {
  id: string
  caption: string
  kind?: 'before' | 'after' | 'diff' | 'state'
  findingId?: string
  dataUrl: string
}

export type DigestRunState = {
  iid: number
  short: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  error?: string
}

// /digest artifact (<short>.chunks.json) — the human-review digest.
export type DigestDecision = {
  id: string
  title: string
  category: string
  files: string[]
  what: string | null
  why: string | null
  alternatives: string | null
  reversibility: 'low' | 'medium' | 'high'
}
export type DigestChunk = {
  id: string
  file: string
  old_path: string | null
  kind: string
  risk: 'green' | 'yellow' | 'red'
  risk_reason: string
  status: string
  added: number
  deleted: number
  green_label: string | null
  summary: string | null
  note: string | null
  confidence: string | null
  decision_signals: string[]
  hunks: {
    header: string
    old_start: number
    new_start: number
    mechanical: boolean
    label: string
  }[]
}
// Result of a per-file structural (difft) diff. `output` is raw ANSI meant to
// be written straight into an xterm instance in the renderer.
export type StructuralDiffResult =
  | { ok: true; output: string }
  | { ok: false; reason: 'difft-missing' | 'binary' | 'fetch-failed' | 'error'; message?: string }

export type DigestArtifact = {
  pr: string | null
  short_sha: string | null
  generated: string
  generator: string
  joint: { member_mrs: string[] } | false
  brief: string | null
  blast_radius: string | null
  diagrams: { title: string; kind: string; mermaid: string }[]
  double_check: { file: string; why: string }[]
  decisions: DigestDecision[]
  stats: {
    files: number
    chunks: number
    green: number
    yellow: number
    red: number
    llm_chunks: number
    added: number
    deleted: number
    decisions?: number
  }
  chunks: DigestChunk[]
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
  labels: string[]
  /** Model(s) that wrote this MR, cross-referenced from the linked ticket's worked_by. */
  workedBy: string[]
}

export type SkillScope = 'project' | 'personal' | 'plugin'
export type SkillInfo = {
  name: string
  description: string
  scope: SkillScope
  namespace?: string
  platforms: Engine[]
}

export type CiJob = { id: number; name: string; stage: string; status: string; webUrl: string }
export type CiInfo = { status: string; webUrl: string; jobs: CiJob[] }
export type MrListResult = { mrs: Mr[]; error?: string }

export type TabContext = {
  cwd: string
  sessionId: string
  remote?: boolean
  remoteHostId?: string
  remoteLabel?: string
  remoteSshTarget?: string
  remotePlatform?: RemotePlatform
  remoteDaemon?: DaemonCfg
  remoteSession?: RemoteSession
  repoRoot: string
  repoPath: string
  repoHost: string
  forgeKind: 'github' | 'gitlab'
  forgeLabel: 'PR' | 'MR'
  forgeSym: '#' | '!'
  hasBacklog: boolean
  ticketProvider: 'local' | 'github' | 'linear'
  ticketProviderLabel: string
  hasSessions: boolean
  hasAgents: boolean
  capabilities?: Record<string, boolean>
}

export type SessionMeta = {
  id: string
  engine: Engine
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
  engine?: SessionEngine
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: RemoteSession
  cols: number
  rows: number
}

export type RemoteSession = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemotePlatform
  daemon?: DaemonCfg
}

export type SessionInfo = {
  sessionId: string
  cwd: string
  mode: '' | 'new' | 'resume'
  name: string
  engine: SessionEngine
  remote?: RemoteSession
  claude: string
}

export type PromptSnippet = {
  id: string
  title: string
  prompt: string
  description?: string
  group?: string
  source?: 'preset' | 'global' | 'repo'
}

export type WorkspaceSearchKind =
  'file' | 'ticket' | 'mr' | 'activity' | 'doc' | 'run' | 'snippet' | 'agent-artifact'
export type WorkspaceSearchResult = {
  id: string
  kind: WorkspaceSearchKind
  title: string
  subtitle?: string
  detail?: string
  path?: string
  line?: number
  ts?: number
  payload?: Record<string, unknown>
}
export type WorkspaceSearchResponse = {
  results: WorkspaceSearchResult[]
  error?: string
}

export type PresetKind = 'agents' | 'snippets'
export type PresetPrefs = {
  version: number
  hidden: Record<PresetKind, string[]>
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

// Installed-build update check (src/main/update-check.ts). status 'behind'
// means the installed app's baked commit is an ancestor of origin/main with
// commits on top; 'diverged' means it was built from unmerged/branch code.
export type UpdateCheckResult = {
  buildSha: string // short sha as baked, -dirty suffix stripped ('' → uncomparable)
  buildDirty: boolean // build came from an uncommitted working tree
  status: 'up-to-date' | 'behind' | 'diverged' | 'unknown'
  behindBy: number
  latestSha: string
  source: 'git' | 'github' | 'none'
  checkedAt: number
  repoPath?: string
  checkoutBranch?: string
  checkoutDirty?: boolean
  error?: string
}

export type GtApi = {
  listSessions: (engine?: Engine) => Promise<SessionMeta[]>
  startSession: (
    key: string,
    opts: StartOpts,
  ) => Promise<{ sessionId: string; cwd: string; remote?: boolean; seeded?: boolean }>
  setActiveSession: (key: string) => Promise<void>
  stopSession: (key: string) => Promise<void>
  fleet: () => Promise<FleetSession[]>
  pickDir: () => Promise<string | null>
  projectDirs: () => Promise<{ name: string; path: string }[]>
  detectEnv: () => Promise<EnvDetect>
  installGtNotify: () => Promise<{ ok: boolean; path?: string; error?: string }>
  scaffoldProject: (
    name: string,
    parentDir?: string,
    ticketProvider?: {
      kind: 'local' | 'obsidian'
      vaultLocation?: 'in-repo' | 'sibling' | 'existing'
      vaultPath?: string
      vaultName?: string
    },
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  remoteDirs: (hostId: string, path?: string) => Promise<RemoteDirList>
  remoteScaffoldProject: (
    hostId: string,
    name: string,
    parentDir?: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  // Provision a Linux host to run scheduled agents via systemd (ADR-0002 #12):
  // install Bun, enable linger, install the runner; returns a readiness report.
  provisionHost: (hostId: string) => Promise<{
    ok?: boolean
    error?: string
    bun?: string | null
    linger?: boolean
    runner?: boolean
    cli?: boolean
    engines?: Record<string, boolean>
    ready?: boolean
    missing?: string[]
    log?: string
  }>
  // Reachability probe for a host (#20): classified reason + actionable hint.
  healthCheckHost: (hostId: string) => Promise<{
    reachable: boolean
    latencyMs?: number
    reason?: 'timeout' | 'auth' | 'dns' | 'refused' | 'unknown'
    hint?: string
  }>
  isFullscreen: () => Promise<boolean>
  onFullscreen: (cb: (v: boolean) => void) => () => void
  settings: {
    get: () => Promise<Settings>
    patch: (patch: SettingsPatch) => Promise<Settings>
    remoteProbe: (hostId: string) => Promise<RemoteSettingsProbe>
    validateProjectsDir: (input: {
      dir?: string
      hostId?: string
    }) => Promise<ProjectsDirValidation>
    suggestProjectsDir: () => Promise<ProjectsDirSuggestion>
    storageReport: () => Promise<TerminalStateSweepReport>
    reclaimStorage: () => Promise<TerminalStateSweepReport>
    clearScratch: () => Promise<ScratchClearReport>
  }
  snippets: {
    list: (repoRoot?: string) => Promise<{
      snippets: PromptSnippet[]
      globalPath: string
      repoPath: string
    }>
    save: (input: {
      scope: 'global' | 'repo'
      repoRoot?: string
      snippet: Partial<PromptSnippet>
    }) => Promise<{ ok: true; path: string; snippet: PromptSnippet } | { error: string }>
  }
  presets: {
    get: () => Promise<{
      prefs: PresetPrefs
      catalog: Record<PresetKind, { id: string; title: string; group?: string }[]>
    }>
    hide: (kind: PresetKind, id: string) => Promise<PresetPrefs>
    restore: (kind: PresetKind, id?: string) => Promise<PresetPrefs>
  }
  telegram: {
    test: () => Promise<{ ok: boolean; error?: string }>
  }
  alerts: {
    // `note` = succeeded WITH a caveat. macOS delivers notifications only for
    // signed apps since Electron 42, and this build is unsigned (ticket 93), so
    // the desktop channel can report ok while showing nothing.
    test: (channel: AlertChannelId) => Promise<{ ok: boolean; error?: string; note?: string }>
  }
  cheapLlm: (opts: {
    messages: { role: string; content: string }[]
    model?: string
    engine?: Engine
    route?: 'auto' | 'claude-p'
    cwd?: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  }) => Promise<{ ok: boolean; text?: string; model?: string; route?: string; error?: string }>
  classify: {
    ci: (rawLog: string) => Promise<{
      class: string
      confidence: string
      evidence: string[]
      isCheapClass: boolean
      source: string
    }>
    risk: (input: { files: string[]; diffLines?: number; title?: string }) => Promise<{
      tier: 'low' | 'medium' | 'high'
      confidence: string
      evidence: string[]
      source: string
    }>
  }
  agents: {
    allRuns: () => Promise<UnifiedRun[]>
    /** Count of running non-session runs — badge polling without the 400-row payload. */
    runningCount: () => Promise<number>
    remoteAllRuns: () => Promise<{
      runs: UnifiedRun[]
      errors: { hostId: string; label: string; error: string }[]
    }>
    runLog: (
      source: 'cron' | 'agent' | 'bg' | 'session',
      runId: string,
      hostId?: string,
    ) => Promise<string>
    /** Last `maxBytes` of a run log — the live pane polls this instead of runLog. */
    runLogTail: (
      source: 'cron' | 'agent' | 'bg' | 'session',
      runId: string,
      hostId?: string,
      maxBytes?: number,
    ) => Promise<{ text: string; size: number; truncated: boolean }>
    runArtifacts: (repoRoot: string) => Promise<RunArtifact[]>
    cancelCron: (id: string, hostId?: string) => Promise<{ ok: boolean; error?: string }>
    list: () => Promise<Agent[]>
    definitions: () => Promise<AgentDefinition[]>
    save: (
      agent: Partial<Agent> & { id: string; title: string; prompt: string },
    ) => Promise<{ ok: true } | { error: string }>
    reset: (id: string) => Promise<{ ok: true } | { error: string }>
    script: (id: string) => Promise<{ path: string; body: string } | null>
    state: (id: string) => Promise<{ path: string; exists: boolean; state: AgentStateRecord }>
    stateReset: (id: string) => Promise<{ ok: true } | { error: string }>
    design: (
      text: string,
      engine: Engine,
      scope: 'repo' | 'global',
      model?: string,
    ) => Promise<AgentRun | { error: string }>
    personas: () => Promise<Persona[]>
    pipelines: () => Promise<PipelineInfo[]>
    run: (
      id: string,
      engine?: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: RemoteSession,
      openrouterHarness?: 'codex' | 'hermes',
      extraContext?: string,
    ) => Promise<AgentRun | { error: string }>
    runTicket: (
      slug: string,
      engine: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: RemoteSession,
      lanes?: number,
      extraContext?: string,
    ) => Promise<AgentRun | { error: string }>
    runPr: (
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
      kind: 'review' | 'iterate',
      engine: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: RemoteSession,
    ) => Promise<AgentRun | { error: string }>
    runs: () => Promise<AgentRun[]>
    rerun: (runId: string) => Promise<AgentRun | { error: string }>
    cancel: (runId: string) => Promise<boolean>
    removeWorktree: (runId: string) => Promise<boolean>
    onStatus: (cb: (run: AgentRun) => void) => () => void
    onOutput: (cb: (p: { runId: string; chunk: string }) => void) => () => void
  }
  persistentAgents: {
    list: () => Promise<PersistentAgent[]>
    get: (id: string) => Promise<PersistentAgentDetail | null>
    save: (input: {
      id?: string
      title: string
      description?: string
      engine?: Engine
      model?: string
      tags?: string[]
      instructions?: string
      memory?: string
      state?: string
    }) => Promise<PersistentAgentDetail | { error: string }>
    remove: (id: string) => Promise<boolean>
    updateFile: (
      id: string,
      file: keyof PersistentAgentFiles,
      body: string,
    ) => Promise<PersistentAgentDetail | { error: string }>
    launchPrompt: (
      id: string,
      task: string,
      repoRoot?: string,
      engine?: Engine,
      model?: string,
    ) => Promise<{ agent: PersistentAgent; prompt: string } | { error: string }>
    run: (
      id: string,
      task: string,
      engine?: Engine,
      model?: string,
    ) => Promise<AgentRun | { error: string }>
    design: (text: string, engine: Engine, model?: string) => Promise<AgentRun | { error: string }>
    files: {
      list: (id: string, rel: string) => Promise<FileEntry[]>
      read: (id: string, rel: string) => Promise<{ ok: boolean; content: string; reason?: string }>
      write: (id: string, rel: string, content: string) => Promise<boolean>
      create: (id: string, rel: string, dir: boolean) => Promise<boolean>
      del: (id: string, rel: string) => Promise<boolean>
    }
    artifacts: {
      list: (id: string) => Promise<PersistentArtifact[]>
      read: (id: string, rel: string) => Promise<PersistentArtifactRead>
    }
  }
  schedules: {
    list: () => Promise<Schedule[]>
    save: (input: {
      id?: string
      agentId: string
      engine: Engine
      model?: string
      spec: ScheduleSpec
      enabled?: boolean
      env?: ScheduleEnv
      retry?: ScheduleRetry
      timeoutSec?: number
      host?: string // hostId → fire on that host via systemd (ADR-0002); absent → local launchd
      runtime?: 'bare' | 'container' | 'k8s'
    }) => Promise<{ ok: true; id: string } | { error: string }>
    remove: (id: string) => Promise<boolean>
    toggle: (id: string, enabled: boolean) => Promise<boolean>
    runNow: (id: string, hostId?: string) => Promise<{ ok: true } | { error: string }>
    runs: (id?: string) => Promise<CronRun[]>
    runLog: (runId: string) => Promise<string>
    reconcile: () => Promise<
      | { loaded: number; removed: number; failed: { id: string; error: string }[] }
      | { ok: false; error: string }
    >
    removeAll: () => Promise<{ removed: number }>
    disabledList: () => Promise<string[]>
    disabledToggle: (id: string, disabled: boolean) => Promise<string[]>
    disabledAll: (disabled: boolean) => Promise<string[]>
    design: (text: string, engine: Engine) => Promise<AgentRun | { error: string }>
  }
  onRemoteOpenSession: (cb: (payload: Record<string, unknown>) => void) => () => void
  bridge: {
    status: () => Promise<BridgeStatus>
    pairing: () => Promise<BridgePairing>
    pushStatus: () => Promise<BridgePushStatus>
    tailscale: () => Promise<BridgeTailscale>
    rotateToken: () => Promise<BridgePairing>
  }
  listeners: {
    status: () => Promise<ListenerStatus>
    process: () => Promise<{
      processed: number
      failed: number
      skipped: number
      status: ListenerStatus
    }>
    toggle: (enabled: boolean) => Promise<ListenerStatus>
    openDir: () => Promise<string>
  }
  remote: {
    active: () => Promise<RemoteActiveSession[]>
  }
  monitors: {
    list: () => Promise<MonitorWithState[]>
    /** Reports what was actually written — it used to return `true` even when
     *  nothing was saved. Callers may ignore it; a UI that surfaces failures
     *  should not. */
    save: (list: Monitor[]) => Promise<MonitorSaveResult>
    run: (id: string) => Promise<MonitorWithState[]>
  }
  ci: {
    list: (repoRoot: string, limit?: number) => Promise<CiListResult>
    jobs: (repoRoot: string, runId: string) => Promise<CiJobsResult>
    log: (repoRoot: string, jobId: string) => Promise<CiLogResult>
  }
  hitl: {
    list: () => Promise<HitlItem[]>
    remoteAll: () => Promise<{
      items: HitlItem[]
      errors: { hostId: string; label: string; error: string }[]
    }>
    file: (item: Omit<HitlItem, 'id' | 'status' | 'createdAt'>) => Promise<HitlItem>
    resolve: (id: string, resolved?: boolean, hostId?: string) => Promise<boolean>
    remove: (id: string, hostId?: string) => Promise<boolean>
    markRead: (ids: string[], hostId?: string, read?: boolean) => Promise<number>
    markAllRead: () => Promise<number>
  }
  factory: {
    health: () => Promise<FactoryHealth>
    start: (engine: Engine) => Promise<AgentRun | { error: string }>
  }
  agentInsights: {
    scorecard: (agentId: string) => Promise<AgentScorecard | null>
    scorecards: () => Promise<AgentScorecard[]>
    disabledDetail: () => Promise<DisabledEntry[]>
    setDisabled: (id: string, disabled: boolean, reason?: string) => Promise<DisabledEntry[]>
    compactMemory: (id: string) => Promise<CompactionResult>
  }
  activity: {
    list: () => Promise<ActivityEvent[]>
    /** Count of events newer than `since` with kind in `kinds` — badge polling. */
    unseenCount: (since: number, kinds: string[]) => Promise<number>
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
  firstPrompt: (sessionId: string) => Promise<string>
  harnessTdd: () => Promise<TddInfo>
  usage: () => Promise<Usage>
  gitStatus: () => Promise<GitStatus>
  sessionTasks: () => Promise<TaskItem[]>
  meta: () => Promise<SessionInfo>
  listCommandWidgets: () => Promise<CommandWidget[]>
  runCommand: (id: string) => Promise<CommandResult>
  listCustomTabs: (cwd?: string) => Promise<CustomTab[]>
  runTabView: (id: string, cwd?: string) => Promise<TabRunResult>
  /** Always scoped to the ACTIVE session's cwd in main — no cwd argument, so a
   *  compromised renderer cannot approve a repo of its choosing. */
  repoTrust: {
    status: () => Promise<RepoTrustStatus>
    approve: () => Promise<boolean>
    revoke: () => Promise<boolean>
    /** Persisted refusal, so a repo the user said no to stops re-prompting.
     *  Keyed on the command set, like approval — a repo that rewrites its
     *  commands is a new decision and asks again. Takes a repo root because
     *  denying only ever withholds capability; approve deliberately does not. */
    denied: (repoRoot: string, hash: string) => Promise<boolean>
    deny: (repoRoot: string, hash: string) => Promise<boolean>
    undeny: (repoRoot: string) => Promise<boolean>
  }
  scratchDir: () => Promise<string>
  onTick: (cb: () => void) => () => void
  tabContext: () => Promise<TabContext>
  tickets: {
    list: () => Promise<Ticket[]>
    get: (slug: string) => Promise<Ticket | null>
    providerGet: () => Promise<TicketProviderConfig | { error: string }>
    providerSave: (cfg: TicketProviderConfig) => Promise<TicketProviderConfig | { error: string }>
    providerTest: (cfg: TicketProviderConfig, smoke?: boolean) => Promise<TicketProviderTestResult>
    linearTeams: (
      cfg?: TicketProviderConfig,
    ) => Promise<{ id: string; name: string; key?: string }[]>
    openInObsidian: (slug: string) => Promise<boolean>
    create: (input: NewTicket) => Promise<Ticket>
    recommendAgent: (input: {
      title?: string
      type?: string
      body?: string
    }) => Promise<TicketAgentRecommendation>
    update: (
      slug: string,
      patch: {
        status?: string
        priority?: string
        acceptance?: string[]
        related?: number[]
        duplicateOf?: number
        agent?: Partial<TicketAgent>
        run?: Partial<TicketRunLink>
        modelTier?: ModelTier
      },
    ) => Promise<boolean>
    comment: (slug: string, comment: NewTicketComment) => Promise<boolean>
    spawn: (
      text: string,
      engine: Engine,
      model?: string,
      remote?: RemoteSession,
    ) => Promise<AgentRun | { error: string }>
  }
  docs: {
    list: () => Promise<DocsTree>
    get: (relPath: string) => Promise<string>
  }
  projectSessions: () => Promise<ProjectSession[]>
  getProjectSession: (slug: string) => Promise<ProjectSession | null>
  listSkills: () => Promise<SkillInfo[]>
  listMrs: () => Promise<MrListResult>
  getMr: (iid: number) => Promise<MrDetail | null>
  getMrDiff: (iid: number) => Promise<string>
  getWorkingDiff: () => Promise<WorkingDiff>
  /** A file's content at HEAD — the base for a per-file working diff. */
  getFileAtHead: (rel: string) => Promise<{ ok: boolean; content: string; reason?: string }>
  /** Raw bytes at HEAD as base64 — the image-diff original. */
  getFileAtHeadBinary: (rel: string) => Promise<{ ok: boolean; base64: string; reason?: string }>
  /** Raw `git status --porcelain`, for per-file tree decorations. */
  getStatusPorcelain: () => Promise<string>
  /** Per-turn workspace snapshots, in a shadow git repo (never the user's). */
  checkpoints: {
    list: () => Promise<{ sha: string; at: number; label: string }[]>
    create: (label: string) => Promise<{ ok: boolean; sha: string }>
    restore: (sha: string) => Promise<{ ok: boolean; error?: string; backup?: string }>
    /** A file's content at a checkpoint ('' where it didn't exist). */
    file: (sha: string, rel: string) => Promise<{ ok: boolean; content: string }>
    /** Line ranges a checkpoint touched per file — the AI-attribution source. */
    ranges: (sha: string) => Promise<Record<string, { from: number; to: number }[]>>
    /** The checkpoint baseline Review mode should diff `buffer` against. */
    reviewBase: (
      rel: string,
      buffer: string,
    ) => Promise<{ ok: true; sha: string; content: string } | { ok: false }>
  }
  getWorkingStructuralDiff: (path: string, width?: number) => Promise<StructuralDiffResult>
  getStructuralDiff: (iid: number, path: string, width?: number) => Promise<StructuralDiffResult>
  difftAvailable: () => Promise<boolean>
  cursorModels: () => Promise<{ id: string; label: string }[]>
  getDigest: (iid: number, short?: string) => Promise<DigestArtifact | null>
  runDigest: (iid: number) => Promise<{ ok: boolean; error?: string }>
  digestStatus: (iid: number) => Promise<DigestRunState | null>
  onDigestStatus: (cb: (s: DigestRunState) => void) => () => void
  getMrCi: (iid: number) => Promise<CiInfo | null>
  mergeMr: (iid: number) => Promise<{ ok: boolean; error?: string }>
  openExternal: (url: string) => Promise<void>
  openInBrowser: (url: string) => Promise<void>
  openInEditor: (path?: string) => Promise<void>
  openConfigDir: () => Promise<string>
  mcpInstall: () => Promise<{ ok: true; installed: string[] } | { error: string }>
  workspace: {
    isBootstrapped: (repoRoot: string) => Promise<BootstrapStatus>
    bootstrap: (repoRoot: string) => Promise<{ ok: true; templateSha?: string } | { error: string }>
    search: (q: string, kinds?: WorkspaceSearchKind[]) => Promise<WorkspaceSearchResponse>
  }
  release: {
    start: () => Promise<
      { ok: true; pid: number | null; log: string; repoRoot: string } | { error: string }
    >
    tail: () => Promise<string>
    status: () => Promise<{ running: boolean; pid?: number | null }>
  }
  update: {
    check: () => Promise<UpdateCheckResult>
    onStatus: (cb: (r: UpdateCheckResult) => void) => () => void
  }
  observability: {
    summary: (range?: 'today' | 'week' | 'month' | 'all') => Promise<{
      totalUsd: number
      totalRuns: number
      byModel: Record<
        string,
        { runs: number; usd: number; inputTokens: number; outputTokens: number }
      >
      bySource: Record<string, { runs: number; usd: number }>
      byAgent: Record<string, { runs: number; usd: number }>
      byRepo: Record<string, { runs: number; usd: number }>
    }>
    byAgent: (range?: 'today' | 'week' | 'month' | 'all') => Promise<
      {
        agentId: string
        runs: number
        usd: number
        outcomes: { prOpened: number; ticketFiled: number; merged: number; none: number }
      }[]
    >
    daily: (
      days?: number,
    ) => Promise<{ date: string; usd: number; runs: number; byModel: Record<string, number> }[]>
    runs: (limit?: number) => Promise<
      {
        id: string
        source: string
        startedAt: number
        endedAt?: number
        model: string
        inputTokens: number
        outputTokens: number
        cacheReadTokens?: number
        costUsd: number
        repoRoot: string
        sessionId?: string
        runId?: string
        agentId?: string
        durationMs?: number
        exitCode?: number
      }[]
    >
    models: () => Promise<string[]>
    indexStatus: () => Promise<ObservabilityIndexStatus>
    rebuildIndex: (limit?: number) => Promise<ObservabilityIndexBuildResult>
    indexQuery: (
      query: ObservabilityIndexQueryId,
      arg?: string,
      filter?: ObservabilityQueryFilter,
    ) => Promise<ObservabilityIndexQueryResult>
    filterOptions: () => Promise<{ repos: string[]; engines: string[]; models: string[] }>
  }
  stacks: {
    list: (repoRoot: string, repoPath: string) => Promise<{ stacks: PrStack[]; error?: string }>
    extension: (repoRoot: string) => Promise<boolean>
    merge: (repoRoot: string, iid: number) => Promise<{ ok: boolean; error?: string }>
  }
  inbox: {
    snoozes: () => Promise<Record<string, number>>
    snoozePresets: () => Promise<{ id: string; label: string; until: number }[]>
    snooze: (id: string, until: number) => Promise<Record<string, number>>
    unsnooze: (id: string) => Promise<Record<string, number>>
    deliveryLog: (channel?: string, limit?: number) => Promise<DeliveryRecord[]>
  }
  agentview: {
    snapshot: (limit?: number) => Promise<ObservabilitySnapshot>
    session: (sessionId: string) => Promise<ObservabilitySessionDetail | null>
    toolCall: (sessionId: string, callId: string) => Promise<ObservabilityToolCallPayload | null>
    transcriptWindow: (
      sessionId: string,
      centerLine?: number,
      radius?: number,
    ) => Promise<ObservabilityTranscriptWindow | null>
  }
  budgets: {
    get: () => Promise<{
      dailyTotalUsd: number
      perAgent: Record<string, number>
      warnAt: number[]
      overrideUntil: number | null
    }>
    setDaily: (usd: number) => Promise<unknown>
    setAgent: (agentId: string, usd: number) => Promise<unknown>
    override: (durationMs: number) => Promise<unknown>
    gate: (agentId?: string) => Promise<{
      decision: 'allow' | 'warn' | 'refuse'
      reason?: string
      spentTodayUsd: number
      capRemainingUsd: number
      capUsd: number
    }>
  }
  bg: {
    list: () => Promise<BgTask[]>
    get: (id: string) => Promise<BgTask | null>
    log: (id: string) => Promise<string>
    spawn: (input: {
      repoRoot: string
      prompt: string
      engine?: Engine
      model?: string
    }) => Promise<BgTask | { error: string }>
    cancel: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
  loops: {
    list: () => Promise<LoopRecord[]>
    get: (id: string) => Promise<LoopRecord | null>
    state: (id: string) => Promise<LoopState | { error: string }>
    create: (input: {
      repoRoot?: string
      goal: string
      mode?: 'headless' | 'paired' | 'single'
      engine?: Engine
      model?: string
      maxIterations?: number
    }) => Promise<LoopRecord | { error: string }>
    step: (id: string) => Promise<LoopRecord | { error: string }>
    restart: (id: string) => Promise<LoopRecord | { error: string }>
    stop: (id: string) => Promise<LoopRecord | { error: string }>
  }
  harnessStatus: () => Promise<{
    cronRunFiles: number
    cronWorktrees: number
    cronRunsRunning: number
    cronFailed24h: number
    inProcessRunning: number
    schedulesPaused: number
    configDir: string
  }>
  clipboardWrite: (text: string) => Promise<void>
  clipboardRead: () => Promise<string>
  pathForFile: (file: File) => string
  clipboardImageToFile: () => Promise<string | null>
  notes: {
    read: (scope: 'repo' | 'global') => Promise<string>
    write: (scope: 'repo' | 'global', content: string) => Promise<boolean>
    folderList: (id: string, rel: string) => Promise<FileEntry[]>
    folderRead: (
      id: string,
      rel: string,
    ) => Promise<{ ok: boolean; content: string; reason?: string }>
    folderWrite: (id: string, rel: string, content: string) => Promise<boolean>
  }
  knowledge: {
    read: (scope: KnowledgeScope) => Promise<KnowledgeBase>
    write: (scope: KnowledgeScope, kb: KnowledgeBase) => Promise<boolean>
    preview: (url: string) => Promise<KnowledgePreview>
    ragStatus: (scope: KnowledgeScope, item: KnowledgeItem) => Promise<KnowledgeRagStatus>
    ragReindex: (
      scope: KnowledgeScope,
      item: KnowledgeItem,
      fullRebuild?: boolean,
    ) => Promise<KnowledgeRagStatus>
    ragAddDocument: (
      scope: KnowledgeScope,
      item: KnowledgeItem,
      content: string,
      filepath?: string,
    ) => Promise<KnowledgeRagStatus>
    ragAddUrl: (
      scope: KnowledgeScope,
      item: KnowledgeItem,
      url: string,
      title?: string,
    ) => Promise<KnowledgeRagStatus>
    ragSearch: (
      scope: KnowledgeScope,
      item: KnowledgeItem,
      query: string,
    ) => Promise<KnowledgeRagSearchResult>
  }
  files: {
    list: (rel: string) => Promise<FileEntry[]>
    read: (rel: string) => Promise<{ ok: boolean; content: string; reason?: string }>
    /** Raw bytes as base64 — images, PDFs, and the hex dump (read() refuses
     *  anything containing a NUL byte). */
    readBinary: (
      rel: string,
    ) => Promise<{ ok: boolean; base64: string; size: number; reason?: string }>
    /** Reveal in Finder. Fenced to the workspace root in main. */
    reveal: (rel: string) => Promise<boolean>
    write: (rel: string, content: string) => Promise<boolean>
    search: (
      q: string,
      opts?: FilesSearchOptions,
    ) => Promise<{ file: string; line: number; text: string }[]>
    /** Format through the project's own prettier; ok:false when it has none
     *  or doesn't own the file. */
    format: (
      rel: string,
      content: string,
    ) => Promise<{ ok: boolean; content?: string; reason?: string }>
    /** Apply search & replace to specific (file, line) targets, using the
     *  same options the search ran with. */
    replace: (
      q: string,
      replacement: string,
      targets: { file: string; line: number }[],
      opts?: FilesSearchOptions,
    ) => Promise<{ files: number; replaced: number; skipped: number }>
    create: (rel: string, dir: boolean) => Promise<boolean>
    rename: (from: string, to: string) => Promise<boolean>
    del: (rel: string) => Promise<boolean>
  }
  workflow: {
    list: (rel: string) => Promise<FileEntry[]>
    read: (rel: string) => Promise<{ ok: boolean; content: string; reason?: string }>
    write: (rel: string, content: string) => Promise<boolean>
  }
  searchSessions: (
    query: string,
    opts?: { thisRepoOnly?: boolean; engine?: Engine; maxSessions?: number; maxHits?: number },
  ) => Promise<TranscriptSearchResponse>
}

// ---- transcript search (src/main/session-search.ts) -------------------------

export type TranscriptHit = {
  line: number
  role: 'user' | 'assistant' | 'tool' | 'other'
  timestamp?: number
  preview: string
}

export type SessionSearchResult = {
  sessionId: string
  engine: string
  cwd: string
  mtime: number
  firstUserText?: string
  hits: TranscriptHit[]
}

export type TranscriptSearchResponse = {
  results: SessionSearchResult[]
  totalHits: number
  scanned: number
  truncated: boolean
}

export type FileEntry = { name: string; path: string; dir: boolean; ignored?: boolean }
export type SearchHit = { file: string; line: number; text: string }
export type FilesSearchOptions = {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma-separated glob patterns to include, e.g. "src/**\/*.ts, *.md" */
  include?: string
  /** Comma-separated glob patterns to exclude, e.g. "**\/*.test.ts, dist/**" */
  exclude?: string
}
export type GitStatus = {
  ok: boolean
  branch: string
  ahead: number
  behind: number
  dirty: number
  upstream: boolean
}

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
  /** Restrict a plugin to engines whose data source actually exists. Omitted means all engines. */
  engines?: Engine[]
  /** Re-poll immediately when the attached session's transcript changes (not just on interval). */
  realtime?: boolean
  /** Called on an interval. `prev` is the previous poll result (for rate/delta widgets). */
  poll: (gt: GtApi, prev: T | null) => Promise<T>
  render: (data: T | null) => ReactNode
  /**
   * Headline number for hosts that draw the plugin's title in their own chrome
   * (the work column's accordion renders "Tickets · 12"). Return null when
   * there is nothing to count yet — a loading or errored poll stays quiet
   * rather than flashing a zero. Omit for plugins with no single count.
   */
  count?: (data: T | null) => number | null
}
