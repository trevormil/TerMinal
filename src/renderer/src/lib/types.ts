import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// The renderer's view of the `gt` bridge. The DOMAIN vocabulary is no longer
// declared here — it lives once in `src/shared/types` and is re-exported below,
// so main and renderer cannot drift. What is left in this file is the part that
// is genuinely renderer-only: `GtApi` (the bridge shape), the tab/plugin
// contracts, and the few payloads that never cross into main.
//
// The re-export is deliberate: hundreds of import sites say `from '@/lib/types'`
// (or `'../lib/types'`), and they keep working unchanged.
export type * from '../../../shared/types'

// --- wire types -------------------------------------------------------------
//
// A handful of channels do not return the STORED shape: main enriches the value
// on its way out (trust flags, computed next-run times, masked secrets), or
// accepts less than the stored shape on the way in. Those six are declared here
// as `Stored & { extras }` so the renderer keeps the exact names it always used
// while main keeps a stored type that does not lie about what is on disk.
// An explicit local export shadows the `export type *` above.
//
// Finding these is what the move to `src/shared/types` was for: each one was
// two independent hand-written declarations that had silently drifted.
import type {
  CommandWidget as StoredCommandWidget,
  CustomTab as StoredCustomTab,
  NewTicketComment as StoredNewTicketComment,
  Schedule as StoredSchedule,
  Settings as StoredSettings,
  Stack,
} from '../../../shared/types'

/** The renderer has always called main's `Stack` a `PrStack` — the DOM already
 *  owns the good name. Note this is NOT `shared/types/mrs.ts`'s `PrStack`,
 *  which is the raw GitHub `stack` field on a single PR. */
export type PrStack = Stack

/** `entryTrusted` is stamped on at read time (src/main/index.ts): global entries
 *  are always live, repo entries only once the repo's command set is approved. */
export type CommandWidget = StoredCommandWidget & { trusted: boolean }
/** See `CommandWidget.trusted`. */
export type CustomTab = StoredCustomTab & { trusted: boolean }

/** `gt.settings.get()` returns the masked copy, never the raw file — every
 *  secret is replaced and a `secretsSet` map says which ones are populated.
 *  See `maskSettingsSecrets` in src/main/settings-mask.ts. */
export type Settings = StoredSettings & { secretsSet?: Record<string, boolean> }

/** `schedules:list` computes the last three fields per call; they are never
 *  persisted. `loaded` is undefined for disabled or remote schedules; false
 *  means enabled but dark — launchd does not have the job. */
export type Schedule = StoredSchedule & {
  describe?: string
  nextRun?: number | null
  loaded?: boolean
}

/** What the UI sends: main stamps `at` and defaults `author`/`kind`, so a
 *  comment box only has to supply a body (src/main/index.ts `tickets:comment`). */
export type NewTicketComment = Partial<StoredNewTicketComment> & { body: string }

import type {
  ActivityEvent,
  Agent,
  AgentDefinition,
  AgentRun,
  AgentScorecard,
  BgTask,
  BootstrapStatus,
  BridgeStatus,
  CiInfo,
  CiJobsResult,
  CiListResult,
  CheapMessage,
  CiLogResult,
  CommandResult,
  CronRun,
  DaemonCfg,
  DeliveryRecord,
  DigestArtifact,
  DigestRunState,
  DisabledEntry,
  DocsTree,
  Engine,
  EnvDetect,
  GitBranchesResult,
  GitCommitDetail,
  GitLogResult,
  GitOpResult,
  GitPatchResult,
  GitStashesResult,
  GitStatus,
  GitTagsResult,
  HitlItem,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgePreview,
  KnowledgeRagSearchResult,
  KnowledgeRagStatus,
  KnowledgeScope,
  ListenerStatus,
  LoopEngine,
  LoopRecord,
  LoopState,
  ModelTier,
  Monitor,
  MonitorState,
  MrDetail,
  MrListResult,
  NewTicket,
  ObservabilityIndexBuildResult,
  ObservabilityIndexQueryId,
  ObservabilityIndexQueryResult,
  ObservabilityIndexStatus,
  ObservabilityQueryFilter,
  ObservabilitySessionDetail,
  ObservabilitySnapshot,
  ObservabilityToolCallPayload,
  ObservabilityTranscriptWindow,
  ObsidianTicketConfig,
  PersistentAgent,
  PersistentAgentDetail,
  PersistentAgentFiles,
  PersistentArtifact,
  PersistentArtifactRead,
  Persona,
  PipelineId,
  PresetKind,
  PresetPrefs,
  ProjectSession,
  ProjectsDirValidation,
  PromptSnippet,
  RemoteDirList,
  RemotePlatform,
  RemoteSession,
  RunArtifact,
  ScheduleSpec,
  ScratchClearReport,
  SessionEngine,
  SessionMeta,
  SessionSearchResult,
  SettingsPatch,
  SkillInfo,
  StartOpts,
  StructuralDiffResult,
  TabRunResult,
  TaskItem,
  TddInfo,
  TerminalStateSweepReport,
  Ticket,
  TicketAgent,
  TicketAgentRecommendation,
  TicketProviderKind,
  TicketProviderTestResult,
  TicketRunLink,
  TicketView,
  TranscriptStats,
  UnifiedRun,
  UpdateCheckResult,
  Usage,
  WebviewTicketConfig,
  WorkingDiff,
  WorkspaceSearchKind,
  WorkspaceSearchResponse,
} from '../../../shared/types'

// The approval prompt's payload: the literal commands a repo wants to run, so
// the user approves something they can actually read.
export type RepoTrustStatus = {
  repoRoot: string
  hash: string
  trusted: boolean
  commands: string[]
}

import type { SavedTicketView } from './ticketViews'

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
    /** linear.app workspace URL for the auto-synthesized embedded view. */
    workspace?: string
  }
  obsidian?: ObsidianTicketConfig
  webview?: WebviewTicketConfig
  views?: TicketView[]
  /** Named filter/group/sort lenses. See SavedTicketView in ticketViews.ts. */
  savedViews?: SavedTicketView[]
}
export type AlertChannelId = 'telegram' | 'desktop' | 'webhook'

export type RemoteSettingsProbe = {
  ok: boolean
  error?: string
  cwd?: string
  repoRoot?: string
  /**
   * Partial: the failure paths (unknown host, unreachable host) answer with no
   * detections at all, and even a successful probe only reports the engines it
   * found. `Record<Engine, string>` claimed all eight keys were always present.
   */
  engines: Partial<Record<Engine, string>>
  tools: Record<string, string>
}
export type ProjectsDirSuggestion = { dir: string; repoCount: number } | null
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
export type PipelineInfo = { id: PipelineId; title: string; description: string }
export type ScheduleRetry = { maxRetries: number; backoffSec: number }
export type ScheduleEnv = Record<string, string>
// Result of a schedule mutation that may cross a network. `refused` = the other
// side answered no (unknown id); `unreachable` = we never got there. Mirrors
// src/main/schedule-honesty.ts.
export type ScheduleMutationResult =
  { ok: true; warning?: string } | { ok: false; reason: 'refused' | 'unreachable'; error: string }
// Circuit-breaker state per schedule. `host` set → the entry came from THAT
// host's disabled.json (its runner tripped the breaker, not ours).
export type ScheduleDisabledEntry = {
  id: string
  reason?: string
  disabledAt: number
  host?: string
  hostLabel?: string
}
export type ScheduleDisabledDetail = {
  entries: ScheduleDisabledEntry[]
  /** Hosts whose breaker file we could not read — never reported as "clean". */
  errors: { host: string; hostLabel: string; error: string }[]
}
export type MonitorSaveResult = {
  ok: boolean
  saved: number
  rejected: number
  error?: string
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
  ticketProvider: TicketProviderKind
  ticketProviderLabel: string
  hasSessions: boolean
  hasAgents: boolean
  capabilities?: Record<string, boolean>
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

export type SessionInfo = {
  sessionId: string
  cwd: string
  mode: '' | 'new' | 'resume'
  name: string
  engine: SessionEngine
  remote?: RemoteSession
  claude: string
}

// Global tm plugin install state (src/main/plugin-install.ts): the canonical
// copy at ~/.config/TerMinal/plugin, the ~/.claude/skills/tm link, and the
// count of synced ~/.codex/skills/tm-* dirs.
// Per-project sidecar (src/main/repo-state.ts): workflow state lives outside
// the repo so a shared checkout never receives personal tickets/reviews.
// `pending` counts files still in the repo awaiting the one-time move.
export type RepoStateStatus = {
  isRepo: boolean
  commits: number
  path: string
  pending: number
  /** Per-repo skill/bin/hook copies the global tm plugin now serves. */
  legacyCopies: number
}

export type TmPluginStatus = {
  installed: boolean
  linked: boolean
  version?: string
  path?: string
  codexSkills?: number
  /** A marketplace-installed plugin also named tm, which Claude loads instead. */
  shadowedBy?: string
}

export type GtApi = {
  listSessions: (engine?: Engine) => Promise<SessionMeta[]>
  startSession: (
    key: string,
    opts: StartOpts,
  ) => Promise<{ sessionId: string; cwd: string; remote?: RemoteSession; seeded?: boolean }>
  setActiveSession: (key: string) => Promise<void>
  stopSession: (key: string) => Promise<void>
  fleet: () => Promise<FleetSession[]>
  pickDir: () => Promise<string | null>
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
  slack: {
    test: () => Promise<{ ok: boolean; error?: string }>
  }
  alerts: {
    // `note` = succeeded WITH a caveat. macOS delivers notifications only for
    // signed apps since Electron 42, and this build is unsigned (ticket 93), so
    // the desktop channel can report ok while showing nothing.
    /** `webhookId` names which destination to ping — required for 'webhook',
     *  since the renderer only holds a mask of the URL. */
    test: (
      channel: AlertChannelId,
      webhookId?: string,
    ) => Promise<{ ok: boolean; error?: string; note?: string }>
  }
  cheapLlm: (opts: {
    messages: CheapMessage[]
    model?: string
    engine?: Engine
    route?: 'auto' | 'claude-p'
    cwd?: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  }) => Promise<{ ok: boolean; text?: string; model?: string; route?: string; error?: string }>
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
      effort?: string,
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
      effort?: string,
    ) => Promise<AgentRun | { error: string }>
    runPr: (
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
      kind: 'review' | 'iterate',
      engine: Engine,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: RemoteSession,
      effort?: string,
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
      effort?: string
      spec: ScheduleSpec
      enabled?: boolean
      env?: ScheduleEnv
      retry?: ScheduleRetry
      timeoutSec?: number
      host?: string // hostId → fire on that host via systemd (ADR-0002); absent → local launchd
      runtime?: 'bare' | 'container' | 'k8s'
      // A remote-attached save installs no recurring timer, so `enabled: true` is
      // rejected on that path (src/main/schedule-honesty.ts).
    }) => Promise<{ ok: true; id: string; warning?: string } | { error: string }>
    // `warning` = it changed here, but a trigger elsewhere was NOT torn down or
    // updated (usually a host we could not reach).
    remove: (id: string) => Promise<ScheduleMutationResult>
    toggle: (id: string, enabled: boolean) => Promise<ScheduleMutationResult>
    runNow: (id: string, hostId?: string) => Promise<{ ok: true } | { error: string }>
    runs: (id?: string) => Promise<CronRun[]>
    runLog: (runId: string) => Promise<string>
    reconcile: () => Promise<
      | { loaded: number; removed: number; failed: { id: string; error: string }[] }
      | { ok: false; error: string }
    >
    /** Breaker state with WHY/WHEN, including each assigned host's own
     *  disabled.json — the host's runner trips the breaker there, not here. */
    disabledDetail: () => Promise<ScheduleDisabledDetail>
    disabledToggle: (id: string, disabled: boolean) => Promise<ScheduleMutationResult>
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
    toggle: (enabled: boolean) => Promise<ListenerStatus>
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
    resolve: (id: string, resolved?: boolean, hostId?: string) => Promise<boolean>
    remove: (id: string, hostId?: string) => Promise<boolean>
    markRead: (ids: string[], hostId?: string, read?: boolean) => Promise<number>
    markAllRead: () => Promise<number>
  }
  agentInsights: {
    scorecard: (agentId: string) => Promise<AgentScorecard | null>
    disabledDetail: () => Promise<DisabledEntry[]>
    setDisabled: (id: string, disabled: boolean, reason?: string) => Promise<DisabledEntry[]>
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
  /** Git views for the Files tab — history / branches / stashes / tags.
   *  Shapes mirror src/main/git-views.ts. */
  gitLog: (opts?: { limit?: number; skip?: number; ref?: string }) => Promise<GitLogResult>
  gitShow: (ref: string) => Promise<GitCommitDetail>
  gitBranches: () => Promise<GitBranchesResult>
  gitCheckout: (branch: string) => Promise<GitOpResult>
  gitCreateBranch: (name: string, from?: string) => Promise<GitOpResult>
  gitStashes: () => Promise<GitStashesResult>
  gitTags: () => Promise<GitTagsResult>
  gitWorkingFilePatch: (rel: string) => Promise<GitPatchResult>
  gitCompareFilesPatch: (a: string, b: string) => Promise<GitPatchResult>
  /** Per-turn workspace snapshots, in a shadow git repo (never the user's). */
  checkpoints: {
    list: () => Promise<{ sha: string; at: number; label: string }[]>
    create: (label: string) => Promise<{ ok: boolean; sha: string }>
    restore: (sha: string) => Promise<{ ok: boolean; error?: string; backup?: string }>
    /** A file's content at a checkpoint ('' where it didn't exist). */
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
  plugin: {
    status: () => Promise<TmPluginStatus>
    sync: () => Promise<{ ok: true; version: string } | { ok: false; error: string }>
  }
  repoState: {
    status: (repoRoot?: string) => Promise<RepoStateStatus>
    migrate: (
      repoRoot?: string,
    ) => Promise<{ moved: number; skipped: string[]; sweptCopies: number; error?: string }>
  }
  observability: {
    byAgent: (range?: 'today' | 'week' | 'month' | 'all') => Promise<
      {
        agentId: string
        runs: number
        usd: number
        outcomes: { prOpened: number; ticketFiled: number; merged: number; none: number }
      }[]
    >
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
  bg: {
    list: () => Promise<BgTask[]>
    get: (id: string) => Promise<BgTask | null>
    log: (id: string) => Promise<string>
    spawn: (input: {
      repoRoot: string
      prompt: string
      engine?: Engine
      model?: string
      // A remote workspace runs the task through the remote-runs transport,
      // which answers an AgentRun — the local path answers a BgTask.
    }) => Promise<BgTask | AgentRun | { error: string }>
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
      engine?: LoopEngine
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

export type TranscriptSearchResponse = {
  results: SessionSearchResult[]
  totalHits: number
  scanned: number
  truncated: boolean
}

export type FileEntry = { name: string; path: string; dir: boolean; ignored?: boolean }
export type FilesSearchOptions = {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma-separated glob patterns to include, e.g. "src/**\/*.ts, *.md" */
  include?: string
  /** Comma-separated glob patterns to exclude, e.g. "**\/*.test.ts, dist/**" */
  exclude?: string
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
