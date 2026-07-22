import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  session,
} from 'electron'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  statSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  mkdirSync,
} from 'node:fs'
import { spawn as cpSpawn, execFileSync } from 'node:child_process'
import * as pty from 'node-pty'

// The main bundle is ESM (package.json "type": "module"), so __dirname doesn't
// exist — derive the module dir the ESM-canonical way or the window never opens.
const moduleDir = dirname(fileURLToPath(import.meta.url))

// The bundled headless runner's source path — packaged (Resources) vs dev (repo
// bin/). Used to install it locally and to push it to remote hosts on provision.
const runnerSrcPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'terminal-cron')
    : join(moduleDir, '../../bin/terminal-cron')
const cliSrcPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'terminal-cli')
    : join(moduleDir, '../../bin/terminal-cli')

function sourceCheckoutRoot(marker: string): string {
  const candidates = [
    process.env.GT_TERMINAL_REPO || '',
    process.cwd(),
    app.getAppPath(),
    join(moduleDir, '..', '..'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(join(c, marker))) return c
  }
  return ''
}

function projectTemplateSource(marker: string): TemplateSource | { error: string } {
  const configured = resolvedTemplateRepo()
  return pickTemplateSource({
    candidates: templateCandidates({
      configured,
      appPath: app.getAppPath(),
      sourceRoots: [process.env.GT_TERMINAL_REPO || '', process.cwd(), join(moduleDir, '..', '..')],
    }),
    marker,
    templateRepo: configured,
    cloneToTmp: cloneTemplateToTmp,
  })
}

import {
  readTranscriptStats,
  readHarnessTdd,
  listSessions,
  type SessionMeta,
  findSessionFile,
  readSessionTasks,
  lastAssistantTurn,
  lastAssistantText,
  readObservabilitySnapshot,
  readObservabilitySessionDetail,
  readObservabilityToolCallPayload,
  readObservabilityTranscriptWindow,
} from './data'
import {
  observabilityIndexStatus,
  queryObservabilityIndex,
  rebuildObservabilityIndex,
  type ObservabilityIndexQueryId,
} from './observability-index'
import { fixPath, detectEnv, installGtNotify } from './env'
import {
  emitActivity,
  readActivity,
  clearActivity,
  onActivity,
  startActivityTail,
  testDesktopAlert,
} from './events'
import { testWebhook } from './notify-channels'
import { readUsage } from './usage'
import { installStatuslineShim, statuslineSettingsArg } from './statusline'
import { listCommandWidgets, runCommand } from './widgets'
import { listCustomTabs, runTabCommand } from './tabs'
import { repoRootOf, repoForCwd } from './repo'
import { checkForUpdate } from './update-check'
import { getTicket, recommendTicketAgent, updateTicket } from './backlog'
import type { NewTicket, TicketAgentRecommendationInput, TicketPatch } from './backlog'
import {
  getRepoTicket,
  listLinearTeams,
  obsidianRepoVault,
  readRepoTicketConfig,
  saveRepoTicketConfig,
  scaffoldObsidianVault,
  obsidianRepoDeepLink,
  testRepoTicketProvider,
  type RepoTicketsConfig,
} from './ticket-provider'
import { difftOnPath } from './forge'
import { onDigestEvent } from './digest-run'
import { listNoteFolder, readNoteFolderFile, writeNoteFolderFile, type NotesScope } from './notes'
import {
  fetchKnowledgePreview,
  readKnowledge,
  writeKnowledge,
  type KnowledgeScope,
  type KnowledgeBase,
} from './knowledge'
import {
  knowledgeRagAddDocument,
  knowledgeRagAddUrl,
  knowledgeRagReindex,
  knowledgeRagSearch,
  knowledgeRagStatus,
} from './knowledge-rag'
import { BUILT_IN_SNIPPETS, listPromptSnippets, savePromptSnippet } from './snippets'
import {
  hiddenPresetIds,
  hidePreset,
  readPresetPrefs,
  restorePreset,
  type PresetKind,
} from './presets'
import { listWorkflowFiles, readWorkflowFile, writeWorkflowFile } from './workflow-files'
import {
  listDisabled,
  setDisabled as setAgentDisabled,
  setAllDisabled as setAllSchedulesDisabled,
} from './agents-disabled'
import { scaffoldProject, type ScaffoldTicketProvider } from './scaffold'
import {
  readSettings,
  patchSettings,
  setSettingsSecretStorage,
  syncTelegramSidecar,
  telegramControlEnabled,
  resolvedProjectsDir,
  resolvedEditorApp,
  resolvedBrowserApp,
  resolvedTemplateRepo,
  enginePath,
  engineDefaultModel,
  resolveEngineModel,
  resolvedOpenRouterKey,
  resolvedOpenAICompatKey,
  openAICompatBaseUrl,
  classifyProjectsDir,
  countGitReposOneLevel,
  pickDensestRoot,
  CANDIDATE_ROOT_NAMES,
  type SettingsPatch,
  type RemotePlatform,
  type DaemonCfg,
} from './settings'
import { classifyBootstrapStatus } from './bootstrap'
import { bakedTemplateSha, resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'
import {
  cloneTemplateToTmp,
  pickTemplateSource,
  templateCandidates,
  type TemplateSource,
} from './template'
import {
  configureTelegramControl,
  markTelegramControlEnabled,
  pollTelegramOnce,
  testTelegram,
} from './telegram'
import {
  readAgents,
  listAgentDefinitions,
  DEFAULT_AGENTS,
  readAgentRunContexts,
  saveAgent,
  resetAgent,
  runAgent,
  runTicketAgent,
  runTicketLanes,
  runTicketSpawn,
  runFactorySpawn,
  runDesignerSpawn,
  runPersistentAgent,
  runPersistentAgentDesignerSpawn,
  runScheduleDesignerSpawn,
  locateScript,
  readAgentState,
  resetAgentState,
  runPrAgent,
  listPipelines,
  listRuns,
  readAgentRunLog,
  rerunAgentRun,
  cancelRun,
  removeWorktree,
  onAgentEvent,
  loadPersistedRuns,
  type Agent,
  type Engine,
  type PrAgentKind,
} from './agents'
import {
  getPersistentAgent,
  createPersistentAgentFile,
  listPersistentAgentArtifacts,
  listPersistentAgents,
  listPersistentAgentFiles,
  persistentAgentLaunchPrompt,
  readPersistentAgentArtifact,
  readPersistentAgentFile,
  removePersistentAgent,
  removePersistentAgentFile,
  savePersistentAgent,
  updatePersistentAgentFile,
  writePersistentAgentFile,
} from './persistent-agents'
import {
  readSchedules,
  addSchedule,
  updateSchedule,
  removeSchedule,
  toggleSchedule,
  getSchedule,
  type NewSchedule,
} from './schedules'
import {
  installRunner,
  installCli,
  installMcpServer,
  installOrTier,
  // mcp-register pulled separately below; not part of launchd helpers.
  reconcileSchedules,
  unscheduleJob,
  removeAllJobs,
  runScheduleNow,
  scheduleLoadedState,
} from './launchd'
import {
  routeSyncSchedule,
  routeRemoveSchedule,
  routeReconcile,
  routeRunNow,
  reconcileHosts,
} from './schedule-router'
import { provisionHost } from './host-provision'
import { checkHostHealth } from './host-health'
import { ensureHostRepo } from './host-repo'
import { registerMcpEverywhere } from './mcp-register'
import {
  appendSessionRunLog,
  beginSessionRun,
  finalizeSessionRun,
  readCronRuns,
  readCronRunLog,
  readSessionRunLog,
  readSessionRuns,
  listAllRuns,
  runTrends,
  sweepStaleCronRuns,
  sweepStaleSessionRuns,
} from './cron-runs'
import { bridgeStatus, startBridge, stopBridge, type BridgeDeps } from './bridge/server'
import { bridgeHosts, ensureIdentity, pairingPayload, rotateToken } from './bridge/identity'
import { tailscalePeerAllowed, tailscaleSelf } from './bridge/tailscale'
import { apnsPaths, pushStatus, registerDevice } from './bridge/push'
import {
  deleteRemoteSession,
  endRemoteSession,
  imagePath,
  listRemoteSessions,
  messageCount,
  postMessage,
  readMessages,
  registerRemoteSession,
  saveImage,
} from './remote-sessions'
import { collectRemoteRuns, collectRemoteHitl } from './remote-runs'
import { listRepoArtifacts } from './run-artifacts'
import { isExternallyOpenableUrl } from './url-safety'

// Only forward web/mail URLs to the OS. Non-http(s) schemes (file://, custom
// protocols) reaching shell.openExternal from rendered content is a known
// Electron footgun — see url-safety.ts.
const openExternalSafe = (url: unknown): void => {
  if (isExternallyOpenableUrl(url)) void shell.openExternal(url)
  else console.error('[gt] refused openExternal for non-web URL:', String(url).slice(0, 80))
}
import { summaryFor, agentROI, dailySpend, listAIRuns, type Range } from './ai-runs'
import { startAICollectionLoop } from './ai-collectors'
import {
  processListenerInbox,
  readListenerStatus,
  setListenerEnabled,
  startListenerInboxWatcher,
} from './listeners'
import { knownModels } from './ai-pricing'
import {
  readBudgets,
  setDailyCap,
  setAgentCap,
  setOverride,
  gateSpawn,
  startBudgetWatcher,
} from './budgets'
import {
  spawnBgTask,
  listBgTasks,
  getBgTask,
  cancelBgTask,
  readBgTaskLog,
  startBgWatcher,
  type BgTask,
} from './bg-tasks'
import {
  listLoops,
  getLoop,
  readLoopState,
  createLoop,
  stepLoop,
  restartLoop,
  stopLoop,
  startLoopWatcher,
  type CreateLoopInput,
} from './loops'
import {
  startLoopListener,
  registerLoopSession,
  unregisterLoopSession,
  noteLoopTurnComplete,
  noteSingleLoopTurn,
} from './loop-listener'
import { readHitl, fileHitl, resolveHitl, removeHitl, type HitlItem } from './hitl'
import { factoryHealth } from './factory-health'
import { describeSpec, nextRun, type ScheduleSpec } from './cron'
import { composeSteps, pipelineLabel } from './pipelines'
import { type WorkspaceSearchKind } from './workspace-search'
import {
  remoteAgents,
  remoteCommandForEngine,
  isSafeSshTarget,
  remoteDirs,
  remoteMrs,
  remoteProbe,
  remoteProject,
  remoteRuns,
  remoteHitl,
  remoteSettings,
  remoteSchedules,
  remoteTickets,
} from './remote'
import { createLocalWorkspaceDaemon, createSshWorkspaceDaemon } from './workspace-daemon'
import { processSpawnCwd } from './spawn-cwd'

const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'

setSettingsSecretStorage({
  canEncrypt: () => safeStorage.isEncryptionAvailable(),
  seal: (value) => safeStorage.encryptString(value).toString('base64'),
  open: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
})

// Mirror decrypted telegram creds to the 0600 sidecar on startup so out-of-process
// filers (cron/CLI/MCP) can deliver HITL pings even for already-configured users
// who won't re-save settings. Subsequent saves refresh it via patchSettings.
syncTelegramSidecar()

let win: BrowserWindow | null = null

// Safe send: the PTY + watcher keep firing during window reload/close, and
// win.webContents may already be destroyed — sending then throws an uncaught
// "Object has been destroyed" that crashes the main process.
function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}
// One window now hosts MANY sessions, each its own PTY, keyed by a renderer-
// generated tab key. Data IPC reads the *active* session; PTY IPC is routed by
// key so every (even backgrounded) terminal keeps streaming.
type SessionEngine = Engine | 'local'
type RemoteSession = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemotePlatform
  daemon?: DaemonCfg
}
type Pinned = {
  sessionId: string
  cwd: string
  mode: '' | 'new' | 'resume'
  name: string
  engine: SessionEngine
  remote?: RemoteSession
}
const sessions = new Map<string, { pty: pty.IPty; pinned: Pinned }>()
let activeKey = ''

// Deps for the paired-loop listener (always-on channel between a loop's two live
// sessions). Kept here where the pty registry + transcript lookup live.
const loopListenerDeps = {
  writeToSession: (k: string, d: string): boolean => {
    const s = sessions.get(k)
    if (!s) return false
    s.pty.write(d)
    return true
  },
  sessionIdOf: (k: string): string | undefined => sessions.get(k)?.pinned.sessionId,
  lastAssistantText: (sid: string): string => {
    const f = findSessionFile(sid)
    return f ? lastAssistantText(f) : ''
  },
}
const cur = (): Pinned =>
  sessions.get(activeKey)?.pinned ?? {
    sessionId: '',
    cwd: '',
    mode: '',
    name: '',
    engine: 'claude',
  }
const curRemote = () => cur().remote
function requestedRemote(input: unknown): RemoteSession | undefined {
  if (
    !input ||
    typeof input !== 'object' ||
    !('sshTarget' in input) ||
    typeof input.sshTarget !== 'string'
  )
    return undefined
  return input as RemoteSession
}
function sshPathBasename(cwdOrRoot: string): string {
  const rest = cwdOrRoot.replace(/^ssh:\/\//, '')
  const slash = rest.indexOf('/')
  const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
  return (
    remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() ||
    (slash >= 0 ? rest.slice(0, slash) : rest)
  )
}
const repoLabelFor = (cwdOrRoot: string) =>
  cwdOrRoot.startsWith('ssh://')
    ? sshPathBasename(cwdOrRoot)
    : repoForCwd(cwdOrRoot)?.path || basename(repoRootOf(cwdOrRoot) || cwdOrRoot || '')

type StartOpts = {
  mode: 'new' | 'resume'
  engine?: SessionEngine
  /** Per-session model override → passed as --model. Falls back to the engine's default. */
  model?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: RemoteSession
  /** Live-paired loop linkage — set on the two sessions of a paired loop. */
  loopId?: string
  loopRole?: 'driver' | 'worker'
  /** Which harness runs an `openrouter` session (default 'codex'). */
  openrouterHarness?: 'codex' | 'hermes'
  cols: number
  rows: number
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)
const CLAUDE_AUTO_FLAGS = ['--permission-mode', 'auto']

function displayRemoteCwd(remote: RemoteSession, cwd: string): string {
  const target = remote.label || remote.sshTarget
  const path = cwd || '~'
  return `ssh://${target}${path.startsWith('/') ? path : `/${path}`}`
}

function daemonForRemote(remote: RemoteSession, displayCwd?: string) {
  return createSshWorkspaceDaemon(remote, displayCwd || displayRemoteCwd(remote, remote.cwd || '~'))
}

function activeDaemon() {
  const pinned = cur()
  return pinned.remote
    ? daemonForRemote(pinned.remote, pinned.cwd)
    : createLocalWorkspaceDaemon(pinned.cwd)
}

function daemonForRequest(input: unknown) {
  const remote = requestedRemote(input)
  return remote ? daemonForRemote(remote) : activeDaemon()
}

function displaySessionName(cwd: string, fallback = 'session') {
  return repoLabelFor(cwd) || basename(cwd) || fallback
}

function remoteFromHostId(hostId: string, cwd?: string): RemoteSession | null {
  const host = readSettings().remoteHosts.find((h) => h.id === hostId)
  if (!host) return null
  return {
    hostId: host.id,
    label: host.label,
    sshTarget: host.sshTarget,
    cwd: cwd || host.defaultCwd || host.daemon.projectsDir || '~',
    platform: host.platform,
    daemon: host.daemon,
  }
}

function startSession(key: string, opts: StartOpts) {
  sessions.get(key)?.pty.kill()

  const remote = opts.remote?.sshTarget ? opts.remote : undefined
  const cwd = remote ? remote.cwd || opts.cwd || '' : processSpawnCwd(opts.cwd || homedir())
  const displayCwd = remote ? displayRemoteCwd(remote, cwd) : cwd
  const engine = opts.engine || 'claude'
  const args: string[] = []
  let sessionId: string
  // Per-session pick (opts.model) wins; else the engine's configured default.
  const defaultModel =
    engine !== 'local'
      ? opts.model ||
        remote?.daemon?.engines?.[engine]?.defaultModel ||
        (!remote ? engineDefaultModel(engine) : '')
      : ''

  if (engine === 'local') {
    sessionId = opts.sessionId || randomUUID()
  } else if (engine === 'codex') {
    args.push('-s', 'danger-full-access', '-a', 'never')
    if (opts.mode === 'resume' && opts.sessionId) {
      sessionId = opts.sessionId
      args.push('resume', sessionId)
    } else {
      sessionId = randomUUID()
    }
  } else if (engine === 'cursor') {
    if (opts.mode === 'resume' && opts.sessionId) {
      sessionId = opts.sessionId
      args.push('--resume', sessionId)
    } else {
      sessionId = opts.sessionId || randomUUID()
    }
  } else if (engine === 'hermes') {
    // Interactive Hermes TUI. Resume attaches to an existing ~/.hermes session
    // (`hermes --resume <id> --tui`); -m applies to --tui per hermes(1).
    args.push('--tui')
    if (opts.mode === 'resume' && opts.sessionId) {
      sessionId = opts.sessionId
      args.push('--resume', sessionId)
    } else {
      sessionId = opts.sessionId || randomUUID()
    }
    if (defaultModel) args.push('-m', defaultModel)
  } else if (engine === 'openrouter') {
    // Interactive OpenRouter via the chosen harness (default codex). enginePath
    // ('openrouter') is the one-shot or-agent — NOT usable interactively — so the
    // spawn binary is resolved from the harness below (openrouterLaunchBin).
    sessionId = opts.sessionId || randomUUID()
    if ((opts.openrouterHarness || 'codex') === 'hermes') {
      args.push('--tui', '--provider', 'openrouter')
      if (defaultModel) args.push('-m', defaultModel)
    } else {
      args.push('-c', 'model_provider=openrouter', '-s', 'danger-full-access', '-a', 'never')
      if (defaultModel) args.push('-m', defaultModel)
    }
  } else if (engine === 'openai-compat') {
    // Interactive self-hosted endpoint: the Codex TUI with an inline
    // OpenAI-compatible provider (mirrors or-agent's one-shot definition; the
    // one-shot or-agent binary itself is not usable interactively).
    const baseUrl = openAICompatBaseUrl()
    if (!baseUrl)
      throw new Error('openai-compat: no base URL configured (Settings → Engines → Self-hosted)')
    sessionId = opts.sessionId || randomUUID()
    args.push(
      '-c',
      'model_provider=openai-compat',
      '-c',
      'model_providers.openai-compat.name=OpenAI-compatible',
      '-c',
      `model_providers.openai-compat.base_url=${baseUrl}`,
      '-c',
      'model_providers.openai-compat.env_key=OPENAI_API_KEY',
      '-c',
      'model_providers.openai-compat.wire_api=chat',
      '-s',
      'danger-full-access',
      '-a',
      'never',
    )
    if (defaultModel) args.push('-m', defaultModel)
  } else if (opts.mode === 'resume' && opts.sessionId) {
    sessionId = opts.sessionId
    args.push('--resume', sessionId)
  } else {
    sessionId = randomUUID()
    args.push('--session-id', sessionId)
    if (opts.name) args.push('--name', opts.name)
  }
  if (engine === 'claude') args.push(...CLAUDE_AUTO_FLAGS)
  // hermes/openrouter/openai-compat push their own `-m` above; everyone else takes --model.
  if (
    defaultModel &&
    engine !== 'local' &&
    engine !== 'hermes' &&
    engine !== 'openrouter' &&
    engine !== 'openai-compat'
  )
    args.push('--model', defaultModel)
  // For interactive OpenRouter/openai-compat the binary is the harness (codex/
  // hermes), not the one-shot or-agent.
  const openrouterLaunchBin =
    engine === 'openrouter'
      ? enginePath((opts.openrouterHarness || 'codex') === 'hermes' ? 'hermes' : 'codex')
      : engine === 'openai-compat'
        ? enginePath('codex')
        : undefined
  const remoteEnginePath =
    remote && engine !== 'local' ? remote.daemon?.engines?.[engine]?.path : undefined
  const repoRoot = remote ? '' : repoRootOf(cwd)
  const repoLabel = repoLabelFor(displayCwd)
  const startedAt = Date.now()

  // Wire Claude sessions to the status-line shim (zero-API usage + context).
  if (engine === 'claude' && !remote) args.push('--settings', statuslineSettingsArg())

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: process.env.TERM_PROGRAM || 'TerMinal',
    CLICOLOR: '1',
    GT_TERMINAL_SESSION_KEY: key,
    GT_TERMINAL_SESSION_ID: sessionId,
    GT_TERMINAL_CWD: displayCwd,
  } as Record<string, string>
  delete env.NO_COLOR
  // Obsidian-provider repos: expose the vault so a session's native file tools
  // can browse tickets directly (no MCP needed). Local only.
  if (repoRoot) {
    const ov = obsidianRepoVault(repoRoot)
    if (ov) {
      env.OBSIDIAN_VAULT_PATH = ov.vaultPath
      env.OBSIDIAN_TICKETS_DIR = ov.ticketsDir
    }
  }
  // OpenRouter (either harness) and Hermes bill through OpenRouter — inject the
  // sealed key so the interactive session authenticates (mirrors the agent runner).
  if (engine === 'openrouter' || engine === 'hermes') {
    const orKey = resolvedOpenRouterKey()
    if (orKey) env.OPENROUTER_API_KEY = orKey
  }
  // Self-hosted endpoint: codex reads the key via the inline provider's
  // env_key=OPENAI_API_KEY. 'none' placeholder for keyless local servers.
  if (engine === 'openai-compat') env.OPENAI_API_KEY = resolvedOpenAICompatKey() || 'none'
  // Strip inherited Claude Code session-context markers. If TerMinal itself was
  // launched from inside a Claude Code session (e.g. `claude` in the terminal
  // that ran it), its env carries CLAUDE_CODE_CHILD_SESSION=1 + the parent's
  // CLAUDE_CODE_SESSION_ID. Leaking those into a session we spawn makes the new
  // `claude` believe it's a nested child — the native binary then does NOT
  // persist a top-level transcript to ~/.claude/projects or append to
  // history.jsonl, so the session never shows up in the Resume picker (and
  // can't be --resumed). Each spawned session must be a fresh top-level session.
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_CODE_')) delete env[k]
  }
  delete env.CLAUDECODE

  if (remote && !isSafeSshTarget(remote.sshTarget)) {
    throw new Error(`refusing to ssh to unsafe target: ${JSON.stringify(remote.sshTarget)}`)
  }
  const proc = remote
    ? pty.spawn(
        'ssh',
        ['-tt', remote.sshTarget, remoteCommandForEngine(engine, args, cwd, remoteEnginePath)],
        {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd: homedir(),
          env,
        },
      )
    : engine === 'local'
      ? pty.spawn(LOGIN_SHELL, ['-l'], {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd,
          env,
        })
      : pty.spawn(
          LOGIN_SHELL,
          ['-l', '-c', [openrouterLaunchBin || enginePath(engine), ...args].map(shq).join(' ')],
          {
            name: 'xterm-256color',
            cols: opts.cols || 80,
            rows: opts.rows || 30,
            cwd,
            env,
          },
        )
  try {
    beginSessionRun({
      id: sessionId,
      source: 'session',
      agentId: opts.ticketSlug ? 'ticket-terminal' : 'terminal-session',
      agentTitle: opts.ticketSlug
        ? `Ticket terminal · ${opts.ticketSlug}`
        : opts.name || displaySessionName(displayCwd),
      engine,
      status: 'running',
      startedAt,
      repoRoot,
      repoLabel,
      branch: '',
      worktree: displayCwd,
      sessionId,
      remote: !!remote,
      ticketSlug: opts.ticketSlug,
    })
  } catch {
    /* session logs are best-effort */
  }
  if (opts.ticketSlug && repoRoot) {
    updateTicket(repoRoot, opts.ticketSlug, {
      run: {
        id: sessionId,
        source: 'session',
        sessionId,
        startedAt: new Date(startedAt).toISOString(),
        status: 'running',
      },
    })
  }

  proc.onData((d) => {
    send('pty:data', key, d)
    appendSessionRunLog(sessionId, d)
  })
  proc.onExit(({ exitCode }) => {
    send('pty:exit', key, exitCode)
    unregisterLoopSession(key)
    const status = exitCode === 0 ? 'done' : 'failed'
    const endedAt = Date.now()
    finalizeSessionRun(sessionId, {
      status,
      endedAt,
      exitCode: exitCode ?? 0,
      error: exitCode === 0 ? undefined : `exit ${exitCode ?? 0}`,
    })
    if (opts.ticketSlug && repoRoot) {
      const t = getTicket(repoRoot, opts.ticketSlug)
      if (t?.run?.id === sessionId) {
        updateTicket(repoRoot, opts.ticketSlug, {
          run: { id: sessionId, source: 'session', sessionId, startedAt: t.run.startedAt, status },
        })
      }
    }
    emitActivity(
      {
        kind: exitCode === 0 ? 'session-end' : 'error',
        title: `${opts.name || displaySessionName(displayCwd)} · ${engine} · exited`,
        detail: `exit ${exitCode ?? 0} · ${displayCwd.replace(homedir(), '~')}`,
        repo: repoLabel,
        repoRoot,
        sessionId,
        runId: sessionId,
        runSource: 'session',
      },
      { notify: exitCode !== 0 },
    )
  })

  sessions.set(key, {
    pty: proc,
    pinned: { sessionId, cwd: displayCwd, mode: opts.mode, name: opts.name || '', engine, remote },
  })
  if (opts.loopId && (opts.loopRole === 'driver' || opts.loopRole === 'worker'))
    registerLoopSession(key, opts.loopId, opts.loopRole)
  activeKey = key
  watchSession()
  emitActivity({
    kind: 'session-start',
    title: `${opts.name || displaySessionName(displayCwd)} · ${remote ? 'remote · ' : ''}${engine} · ${opts.mode === 'resume' ? 'resumed' : 'started'}`,
    detail: displayCwd.replace(homedir(), '~'),
    repo: repoLabel,
    repoRoot,
    sessionId,
    runId: sessionId,
    runSource: 'session',
  })
  return { sessionId, cwd: displayCwd, remote }
}

function setActiveSession(key: string) {
  if (sessions.has(key)) {
    activeKey = key
    watchSession()
  }
}

function stopSession(key: string) {
  const s = sessions.get(key)
  if (s) {
    try {
      s.pty.kill()
    } catch {
      /* already gone */
    }
    sessions.delete(key)
  }
  if (activeKey === key) {
    activeKey = sessions.keys().next().value ?? ''
    watchSession()
  }
}

// Watch the ACTIVE session's transcript and push a tick the instant it grows
// (i.e. as the agent writes each turn / tool call) so realtime widgets refresh
// without waiting for their poll interval. A cheap stat — no Claude hook needed.
let watchTimer: ReturnType<typeof setInterval> | null = null
let watchedFile = ''
let lastMtime = 0
function watchSession() {
  if (watchTimer) clearInterval(watchTimer)
  watchedFile = ''
  lastMtime = 0
  watchTimer = setInterval(() => {
    if (cur().remote) return
    const sid = cur().sessionId
    if (!sid) return
    if (!watchedFile) {
      const f = findSessionFile(sid)
      if (!f) return
      watchedFile = f
    }
    try {
      const m = statSync(watchedFile).mtimeMs
      if (m !== lastMtime) {
        lastMtime = m
        send('gt:tick')
      }
    } catch {
      watchedFile = ''
    }
  }, 400)
}

// Per-session turn watcher → activity feed + notifications. Watches EVERY
// running session's transcript (backgrounded ones too — that's the point) and
// fires a "ready" event the moment a turn completes (stop_reason 'end_turn'),
// deduped by the assistant message id so it fires once per turn.
type TurnWatch = { file: string; mtime: number; lastTurnId: string }
const turnWatch = new Map<string, TurnWatch>()
let activityTimer: ReturnType<typeof setInterval> | null = null
let telegramTimer: ReturnType<typeof setInterval> | null = null
function pollActivity() {
  for (const [key, s] of sessions) {
    if (s.pinned.remote) continue
    const sid = s.pinned.sessionId
    if (!sid) continue
    let w = turnWatch.get(key)
    if (!w) {
      const file = findSessionFile(sid)
      if (!file) continue
      // seed without firing: record the current turn so we only notify on NEW ones
      const seed = lastAssistantTurn(file)
      w = { file, mtime: 0, lastTurnId: seed?.endTurn ? seed.id : '' }
      try {
        w.mtime = statSync(file).mtimeMs
      } catch {
        /* ignore */
      }
      turnWatch.set(key, w)
      continue
    }
    let m = 0
    try {
      m = statSync(w.file).mtimeMs
    } catch {
      continue
    }
    if (m === w.mtime) continue
    w.mtime = m
    const t = lastAssistantTurn(w.file)
    if (!t || !t.endTurn || t.id === w.lastTurnId) continue
    w.lastTurnId = t.id
    // Paired-loop Claude fallback: forward this turn to the peer if the agent
    // didn't already hand off via events.jsonl. No-ops for non-paired sessions.
    noteLoopTurnComplete(key, loopListenerDeps)
    // Single-loop Claude fallback: kick the auto-grader if the live generator
    // finished without appending an event. No-ops for non-single sessions.
    noteSingleLoopTurn(key)
    const focusedHere = key === activeKey && (win?.isFocused() ?? false)
    const label = s.pinned.name || basename(s.pinned.cwd) || 'session'
    const st = readTranscriptStats(sid)
    emitActivity(
      {
        kind: 'task-complete',
        title: `${label} · ready`,
        detail: st.aiTitle || (st.lastAction ? `done — ${st.lastAction.tool}` : 'Turn complete'),
        repo: repoForCwd(s.pinned.cwd)?.path || basename(repoRootOf(s.pinned.cwd) || ''),
        repoRoot: repoRootOf(s.pinned.cwd),
        sessionId: sid,
      },
      // don't ping for the session you're actively looking at
      { notify: !focusedHere },
    )
  }
  for (const k of turnWatch.keys()) if (!sessions.has(k)) turnWatch.delete(k)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 820,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    // explicit position so the ●●● controls sit visible + vertically centered in
    // the 36px (h-9) tab bar, instead of being clipped/mis-aligned by the default
    trafficLightPosition: { x: 14, y: 11 },
    title: 'TerMinal',
    icon: join(moduleDir, '../../build/icon.png'),
    webPreferences: {
      preload: join(moduleDir, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  })

  // Deny web permission requests by default (camera, mic, geolocation, MIDI,
  // notifications, …). TerMinal's own renderer needs none of them; the only
  // exception is `fullscreen`, so the Browser-tab <webview> can full-screen
  // video. Defense-in-depth: even if untrusted content (agent output, PR bodies)
  // ever reached a sink, it still couldn't reach into these device APIs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'fullscreen')
  })

  // The macOS traffic lights are hidden in fullscreen, so the renderer should
  // drop its left reserve for them. Broadcast the fullscreen state.
  const sendFullscreen = () => send('window:fullscreen', win?.isFullScreen() ?? false)
  win.on('enter-full-screen', sendFullscreen)
  win.on('leave-full-screen', sendFullscreen)
  win.on('ready-to-show', () => {
    win?.show()
    sendFullscreen()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  // Contain popups from the <webview> browser tab: deny a new OS window and
  // load the target in-frame instead (only for web URLs). The renderer's
  // 'new-window' listener never fired — that event doesn't exist on Electron's
  // <webview> — so without this, popups escaped uncontained.
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isExternallyOpenableUrl(url)) void guest.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })
  })
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[gt] renderer gone:', d.reason),
  )
  // Installed-build update check — async, delayed past first paint, and silent
  // unless the installed app is confirmed behind origin/main (never blocks
  // startup; offline/API failures resolve to status 'unknown' and stay quiet).
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void runUpdateCheck().then((r) => {
        if (r.status === 'behind') send('update:status', r)
      })
    }, 2500)
  })

  // push activity events to the renderer; poll all sessions for turn completion
  onActivity((ev) => send('activity:event', ev))
  startActivityTail() // surface externally-appended events (skills) live
  onAgentEvent((channel, payload) => send(channel, payload))
  onDigestEvent((channel, payload) => send(channel, payload))
  loadPersistedRuns() // restore past agent runs
  if (!activityTimer) activityTimer = setInterval(pollActivity, 1500)
  // Real cron: install the headless runner at its stable path, then reconcile
  // launchd ↔ schedules.json (loads enabled jobs, removes any orphans). Jobs
  // fire via launchd even when the app is closed — no in-app ticker.
  const runnerSrc = runnerSrcPath()
  installRunner(runnerSrc)
  const cliSrc = app.isPackaged
    ? join(process.resourcesPath, 'terminal-cli')
    : join(moduleDir, '../../bin/terminal-cli')
  installCli(cliSrc)
  const mcpSrc = app.isPackaged
    ? join(process.resourcesPath, 'terminal-mcp-server')
    : join(moduleDir, '../../bin/terminal-mcp-server')
  installMcpServer(mcpSrc)
  // Bundle the OpenRouter (or-agent) tier so a fresh install runs OpenRouter
  // agents without any global ~/.claude dotfiles.
  const orBinDir = app.isPackaged ? process.resourcesPath : join(moduleDir, '../../bin')
  const orMrDir = app.isPackaged
    ? join(process.resourcesPath, 'model-routing')
    : join(moduleDir, '../../bin/model-routing')
  installOrTier(orBinDir, orMrDir)
  // Status-line shim: lets the Plan Usage + Context widgets read rate_limits /
  // context_window_size from a per-session cache instead of the throttled API.
  installStatuslineShim()
  // Once the MCP binary is on disk, register it with Claude Code (~/.claude.json)
  // and Codex CLI (~/.codex/config.toml) so every spawned agent — TerMinal's own
  // or ad-hoc — discovers the harness tools natively without per-repo config.
  // Idempotent: stale registrations are updated to the current bun path; no-op
  // when already correct.
  try {
    const r = registerMcpEverywhere()
    if (!r.claude.ok)
      console.warn(`mcp register claude: ${r.claude.action} (${r.claude.error || ''})`)
    if (!r.codex.ok) console.warn(`mcp register codex: ${r.codex.action} (${r.codex.error || ''})`)
  } catch (e) {
    console.warn(`mcp register failed: ${(e as Error).message}`)
  }
  try {
    const rec = reconcileSchedules()
    // Host (systemd) schedules reconcile over SSH — fire-and-forget so an
    // unreachable host never delays startup (ADR-0002). Local launchd above is sync.
    void reconcileHosts(readSchedules()).catch(() => {})
    if (rec.failed.length) {
      // A schedule that didn't load into launchd never fires. Don't swallow it:
      // log every failure and surface one Activity event so it's visible.
      for (const f of rec.failed)
        console.warn(`schedule ${f.id} failed to load into launchd: ${f.error}`)
      emitActivity({
        kind: 'check',
        title: `${rec.failed.length} schedule${rec.failed.length > 1 ? 's' : ''} failed to load into launchd`,
        detail: `Won't fire until reconciled · ${rec.failed.map((f) => f.id).join(', ')}`,
      })
    }
  } catch {
    /* launchd unavailable — schedules still listable */
  }

  // Telegram AFK control: enumerate run targets from open sessions, prime the
  // cursor if control was left on, and poll for inbound commands.
  configureTelegramControl({
    repos: () => {
      const seen = new Set<string>()
      const out: { label: string; repoRoot: string }[] = []
      for (const s of sessions.values()) {
        if (s.pinned.remote) continue
        const root = repoRootOf(s.pinned.cwd)
        if (!root || seen.has(root)) continue
        seen.add(root)
        out.push({ label: repoForCwd(s.pinned.cwd)?.path || basename(root), repoRoot: root })
      }
      return out
    },
    active: () => {
      if (cur().remote) return null
      const root = repoRootOf(cur().cwd)
      return root ? { label: repoForCwd(cur().cwd)?.path || basename(root), repoRoot: root } : null
    },
  })
  if (telegramControlEnabled()) markTelegramControlEnabled(true, false) // restore cursor quietly
  if (!telegramTimer) telegramTimer = setInterval(pollTelegramOnce, 5000)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(moduleDir, '../renderer/index.html'))
  }
}

// ---- session IPC ----
ipcMain.handle('sessions:list', (_e, engine?: Engine) => listSessions(engine))
ipcMain.handle('session:start', (_e, key: string, opts: StartOpts) => startSession(key, opts))
ipcMain.handle('session:setActive', (_e, key: string) => setActiveSession(key))
ipcMain.handle('session:stop', (_e, key: string) => stopSession(key))
// Fleet snapshot: a summary of every live session (for the cross-session
// overview + the live status dots on the session tabs).
function fleetSnapshot() {
  const out = []
  for (const [key, s] of sessions) {
    const sid = s.pinned.sessionId
    const st = readTranscriptStats(sid)
    let status: 'working' | 'idle' = 'idle'
    const f = sid ? findSessionFile(sid) : null
    if (f) {
      const t = lastAssistantTurn(f)
      if (t && !t.endTurn) status = 'working'
    }
    out.push({
      key,
      sessionId: sid,
      name:
        s.pinned.name ||
        (s.pinned.remote
          ? s.pinned.remote.label || s.pinned.remote.sshTarget
          : basename(s.pinned.cwd)) ||
        'session',
      cwd: s.pinned.cwd,
      repo: s.pinned.remote
        ? s.pinned.remote.label || s.pinned.remote.sshTarget
        : repoForCwd(s.pinned.cwd)?.path || basename(repoRootOf(s.pinned.cwd) || s.pinned.cwd),
      branch: st.gitBranch,
      model: st.model,
      status,
      contextPct: st.contextPct,
      contextTokens: st.contextTokens,
      contextLimit: st.contextLimit,
      turns: st.turns,
      aiTitle: st.aiTitle,
      lastAction: st.lastAction,
    })
  }
  return out
}
ipcMain.handle('fleet:list', () => fleetSnapshot())

// ---- mobile bridge (TerMinal Remote for iOS) --------------------------------
// A second transport over the SAME live ptys the desktop drives — never a
// parallel session store. Terminals only: a phone attached to a live agent can
// ask it about tickets/PRs/CI itself, so the bridge grows no bespoke endpoints.
const MAX_REPLAY_BYTES = 256 * 1024
/**
 * The first thing a phone-started session is told. It has to do three jobs:
 * adopt the thread that is already waiting for it, learn the reporting
 * contract, and get on with the work — with no human at the keyboard to
 * correct it.
 */
function spawnPrompt(remoteId: string, task?: string): string {
  // Absolute path to THIS app's terminal-cli, which always has the `remote`
  // subcommand. Bare `terminal-cli` isn't on an interactive session's PATH, and
  // the repo's own bin/ may be on a branch that predates `remote` — the agent
  // otherwise burns several turns guessing. Quote it in case the path has spaces.
  const cli = `"${cliSrcPath()}"`
  const lines = [
    `You were started from TerMinal Remote on a phone. There is no one at this Mac —`,
    `report through the phone, not the terminal.`,
    ``,
    `A remote thread is already registered for you. Adopt it, then use it`,
    `(use this exact path — bare terminal-cli is not on PATH):`,
    ``,
    `    ${cli} remote register --id ${remoteId} "<short title>"`,
    `    ${cli} remote post --id ${remoteId} "<update>"`,
    `    ${cli} remote ask  --id ${remoteId} "<question>"   # blocks for a reply`,
    ``,
    `Follow the remote-terminal skill for when to post vs ask. Post at real`,
    `checkpoints, not every command. Ask only at a genuine fork; otherwise pick`,
    `the safe default and say so in a post.`,
    ``,
    `This session stays live between turns — a Stop hook parks it waiting for the`,
    `next phone message. So when you finish a task, post the result and just stop;`,
    `you'll be handed the next instruction automatically. You do NOT need to keep`,
    `an ask open to stay reachable.`,
  ]
  if (task) lines.push(``, `Your task:`, ``, task)
  else
    lines.push(
      ``,
      `No task was given — post that you are ready and stop; wait for the first message.`,
    )
  return lines.join('\n')
}

const bridgeDeps: BridgeDeps = {
  // Only sessions that opted in via the remote-terminal skill. Nothing is
  // scraped from a pty, so this is identical for every engine.
  sessions: () =>
    listRemoteSessions().map((s) => ({
      id: s.id,
      title: s.title,
      repo: s.repo,
      branch: s.branch,
      engine: s.engine,
      status: s.status,
      question: s.question,
      lastSeenAt: s.lastSeenAt,
      messages: messageCount(s.id),
    })),
  messages: (id, opts) => readMessages(id, opts),
  // Queued, not delivered: the agent collects it at its next check, so a reply
  // sent while it is busy is never lost.
  reply: (id, text, images) => !!postMessage(id, 'user', text, images ?? []),
  endRemote: (id) => !!endRemoteSession(id),
  deleteRemote: (id) => deleteRemoteSession(id),
  saveImage: (id, data, ext) => saveImage(id, data, ext),
  imagePath: (id, name) => imagePath(id, name),

  // Local items plus every configured host's. An agent blocked on `tm` pages
  // nobody otherwise, which defeats the whole point of an AFK remote.
  hitl: async () => {
    const local = readHitl()
      .filter((h) => h.status === 'open')
      .map((h) => ({
        id: h.id,
        title: h.title,
        detail: h.detail,
        action: h.action,
        repo: h.repo,
        source: h.source,
        createdAt: h.createdAt,
      }))
    const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
    if (!hosts.length) return local
    // Best-effort: an unreachable host contributes nothing, never a failure.
    const remote = await collectRemoteHitl(hosts, async (h) => {
      const ref = remoteFromHostId(h.id)
      return ref ? remoteHitl.list(ref) : []
    }).catch(() => null)
    const mapped = (remote?.items ?? [])
      .filter((h) => h.status === 'open')
      .map((h) => ({
        id: h.id,
        title: h.title,
        detail: h.detail,
        action: h.action,
        // Label which machine is blocked, or the queue is ambiguous.
        repo: h.hostLabel ? `${h.hostLabel} · ${h.repo || ''}`.trim() : h.repo,
        source: h.source,
        createdAt: h.createdAt,
      }))
    return [...local, ...mapped].sort((a, b) => b.createdAt - a.createdAt)
  },
  resolveHitl: (id, resolved) => resolveHitl(id, resolved),
  repos: () => {
    const base = resolvedProjectsDir()
    try {
      return readdirSync(base)
        .filter((n) => !n.startsWith('.'))
        .map((n) => ({ name: n, path: join(base, n) }))
        .filter((d) => {
          try {
            return statSync(d.path).isDirectory()
          } catch {
            return false
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  },

  // Per-workspace read-only cockpit data. Each resolves a local daemon for the
  // requested repo path (the same machinery the desktop tabs use), then projects
  // to the compact shape the phone lists. Best-effort: a repo without tickets/a
  // gh auth issue returns an empty list rather than failing the request.
  workspaceTickets: async (repoPath) => {
    try {
      const tickets = await createLocalWorkspaceDaemon(repoPath).ticketsList()
      return tickets.map((t) => ({
        slug: t.slug,
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        hitl: t.hitl,
      }))
    } catch {
      return []
    }
  },
  workspacePrs: async (repoPath) => {
    try {
      const { mrs } = await createLocalWorkspaceDaemon(repoPath).mrsList()
      return mrs.map((m) => ({
        iid: m.iid,
        title: m.title,
        state: m.state,
        draft: m.draft,
        author: m.author,
        url: m.webUrl,
        labels: m.labels,
        verdict: m.review?.verdict,
        score: m.review?.overall ?? undefined,
      }))
    } catch {
      return []
    }
  },
  workspaceRuns: (repoPath) => {
    const root = repoRootOf(repoPath) || repoPath
    return listAllRuns()
      .filter((r) => r.repoRoot === root || r.repoLabel === basename(repoPath))
      .slice(0, 60)
      .map((r) => ({
        id: r.id,
        title: r.agentTitle,
        engine: r.engine,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        branch: r.branch,
      }))
  },
  workspaceSchedules: (repoPath) => {
    const root = repoRootOf(repoPath) || repoPath
    const now = Date.now()
    return readSchedules(now)
      .filter((s) => s.repoRoot === root || s.repoLabel === basename(repoPath))
      .map((s) => ({
        id: s.id,
        title: s.agentTitle,
        describe: describeSpec(s.spec),
        nextRun: nextRun(s.spec, now) ?? undefined,
        enabled: s.enabled,
      }))
  },

  // Start a session from the phone. The remote thread is registered up front so
  // the phone can open it immediately, then the RENDERER is asked to open the
  // terminal — spawning the pty from main directly would leave an orphan with
  // no tab on the desktop, and would skip initialInput delivery entirely.
  spawn: ({ cwd, engine, task }) => {
    if (!win) return { error: 'TerMinal is not running' }
    const repo = repoForCwd(cwd)?.path || basename(repoRootOf(cwd) || cwd)
    const session = registerRemoteSession({
      title: task ? task.slice(0, 60) : `${repo} · from phone`,
      repo,
      cwd,
      engine: engine || readSettings().defaultEngine,
    })
    postMessage(
      session.id,
      'agent',
      `Starting a ${engine || readSettings().defaultEngine} session in ${repo}…`,
    )
    win.webContents.send('remote:open-session', {
      cwd,
      engine: engine || readSettings().defaultEngine,
      remoteId: session.id,
      initialInput: spawnPrompt(session.id, task),
    })
    return { id: session.id }
  },

  registerDevice: (token, environment) => {
    registerDevice(token, environment)
    emitActivity({
      kind: 'info',
      title: 'Phone registered for notifications',
      detail: `${environment} · alerts will now reach TerMinal Remote`,
    })
  },

  // Hand the pairing payload to a verified same-user tailnet peer. The identity
  // check is in tailscale.ts; here we just turn a yes into the token.
  tailscalePair: (peerAddress) => {
    const { ok, peer } = tailscalePeerAllowed(peerAddress)
    if (!ok) return null
    const identity = ensureIdentity()
    const payload = pairingPayload({ port: readSettings().bridge.port, identity })
    emitActivity({
      kind: 'info',
      title: 'Phone paired over Tailscale',
      detail: peer?.node || peer?.login || 'tailnet peer',
    })
    return { token: payload.t, fp: payload.fp, name: payload.n }
  },
}

async function applyBridgeSetting(): Promise<void> {
  const cfg = readSettings().bridge
  if (!cfg.enabled) {
    await stopBridge()
    return
  }
  const status = await startBridge(bridgeDeps, { port: cfg.port })
  emitActivity({
    kind: status.listening ? 'info' : 'error',
    title: status.listening
      ? `Mobile bridge listening on :${status.port}`
      : `Mobile bridge failed to start`,
    detail: status.error || `${bridgeHosts().join(', ') || 'no network interface'}`,
  })
}

ipcMain.handle('bridge:status', () => {
  const cfg = readSettings().bridge
  const status = bridgeStatus()
  return { ...status, enabled: cfg.enabled, port: cfg.enabled ? status.port : cfg.port }
})
// The pairing payload carries the bearer token, so it is only ever produced on
// demand for the Settings pane — never returned from a bridge HTTP route.
ipcMain.handle('bridge:pairing', () => {
  const cfg = readSettings().bridge
  const identity = ensureIdentity()
  return pairingPayload({ port: cfg.port, identity })
})
ipcMain.handle('bridge:push-status', () => ({ ...pushStatus(), ...apnsPaths() }))
ipcMain.handle('bridge:tailscale', () => {
  const self = tailscaleSelf()
  return self ? { available: true, dnsName: self.dnsName, login: self.login } : { available: false }
})
ipcMain.handle('bridge:rotate-token', () => {
  const cfg = readSettings().bridge
  const identity = rotateToken()
  emitActivity({
    kind: 'info',
    title: 'Mobile bridge token rotated',
    detail: 'Every paired device must scan the new code',
  })
  return pairingPayload({ port: cfg.port, identity })
})
ipcMain.handle('dirs:projects', () => {
  const base = resolvedProjectsDir()
  try {
    return readdirSync(base)
      .filter((n) => !n.startsWith('.'))
      .map((n) => ({ name: n, path: join(base, n) }))
      .filter((d) => {
        try {
          return statSync(d.path).isDirectory()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
})
ipcMain.handle('dialog:pickDir', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: homedir(),
  })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle(
  'project:scaffold',
  (_e, name: string, parentDir?: string, ticketProvider?: ScaffoldTicketProvider) => {
    const r = scaffoldProject(name, parentDir, ticketProvider)
    emitActivity(
      {
        kind: r.ok ? 'task-complete' : 'error',
        title: r.ok
          ? `Project scaffolded · ${basename(r.path || name)}`
          : `Project scaffold failed · ${name}`,
        detail: r.ok ? r.path : r.error,
        repo: r.ok && r.path ? basename(r.path) : undefined,
        repoRoot: r.ok ? r.path : undefined,
      },
      { notify: !r.ok },
    )
    return r
  },
)
ipcMain.handle('remote:dirs', (_e, hostId: string, path?: string) => {
  const remote = remoteFromHostId(hostId, path)
  if (!remote) return { cwd: path || '', parent: '', entries: [], error: 'remote host not found' }
  return remoteDirs
    .list(remote, path)
    .catch((e) => ({ cwd: path || '', parent: '', entries: [], error: (e as Error).message }))
})
ipcMain.handle('remote:scaffold', async (_e, hostId: string, name: string, parentDir?: string) => {
  const remote = remoteFromHostId(hostId, parentDir)
  if (!remote) return { ok: false, error: 'remote host not found' }
  const templateRepo = remote.daemon?.templateRepo || resolvedTemplateRepo()
  const r = await remoteProject
    .scaffold(remote, name, parentDir || remote.cwd || '~', templateRepo)
    .catch((e) => ({
      ok: false,
      path: undefined,
      error: (e as Error).message,
    }))
  emitActivity(
    {
      kind: r.ok ? 'task-complete' : 'error',
      title: r.ok
        ? `Remote project scaffolded · ${basename(r.path || name)}`
        : `Remote project scaffold failed · ${name}`,
      detail: r.ok ? `${remote.sshTarget}:${r.path}` : r.error,
      repo: r.ok && r.path ? basename(r.path) : undefined,
      repoRoot: '',
    },
    { notify: !r.ok },
  )
  return r
})
ipcMain.handle('window:is-fullscreen', () => win?.isFullScreen() ?? false)
ipcMain.handle('activity:list', () => readActivity())
ipcMain.handle('activity:clear', () => clearActivity())
ipcMain.handle('env:detect', () => detectEnv())
ipcMain.handle('env:install-gt-notify', () => installGtNotify())
ipcMain.handle('telegram:test', () => testTelegram())
// One "send test alert" entry point per outbound channel (Settings → Alerts).
ipcMain.handle('alerts:test', (_e, channel: 'telegram' | 'desktop' | 'webhook') => {
  if (channel === 'telegram') return testTelegram()
  if (channel === 'desktop') return testDesktopAlert()
  if (channel === 'webhook') return testWebhook(readSettings().alerts.webhook.url)
  return { ok: false, error: `unknown alert channel: ${channel}` }
})
ipcMain.handle('settings:get', () => readSettings())
ipcMain.handle('settings:patch', (_e, patch: SettingsPatch) => {
  const before = readSettings()
  const next = patchSettings(patch)
  // react when the AFK-control toggle actually flips
  if (next.telegram.control !== before.telegram.control) {
    markTelegramControlEnabled(next.telegram.control)
    emitActivity({
      kind: 'info',
      title: `Telegram control ${next.telegram.control ? 'enabled' : 'disabled'}`,
      detail: 'Settings updated',
    })
  }
  if (next.telegram.notify !== before.telegram.notify) {
    emitActivity({
      kind: 'info',
      title: `Activity notifications ${next.telegram.notify ? 'enabled' : 'disabled'}`,
      detail: 'Settings updated',
    })
  }
  // Bind/unbind the mobile bridge the moment the toggle or port changes, so the
  // listening socket always matches what Settings claims.
  if (next.bridge.enabled !== before.bridge.enabled || next.bridge.port !== before.bridge.port) {
    void applyBridgeSetting()
  }
  return next
})
ipcMain.handle('settings:remote-probe', async (_e, hostId: string) => {
  const host = readSettings().remoteHosts.find((h) => h.id === hostId)
  if (!host) return { ok: false, error: 'remote host not found', engines: {}, tools: {} }
  try {
    const probe = await remoteProbe({
      hostId: host.id,
      label: host.label,
      sshTarget: host.sshTarget,
      cwd: host.defaultCwd || host.daemon.projectsDir || '~',
      platform: host.platform,
    })
    return {
      ok: true,
      cwd: probe.cwd,
      repoRoot: probe.repoRoot,
      engines: probe.engines,
      tools: probe.tools,
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message, engines: {}, tools: {} }
  }
})
// Real-fs bindings for the pure projects-dir discovery helpers in settings.ts.
function projectsDirFs() {
  return {
    hasGitDir: (d: string) => existsSync(join(d, '.git')),
    listChildren: (d: string) => readdirSync(d),
    resolveHome: () => homedir(),
    candidateRoots: () => CANDIDATE_ROOT_NAMES.map((n) => (n ? join(homedir(), n) : homedir())),
  }
}
ipcMain.handle(
  'settings:validate-projects-dir',
  async (_e, input: { dir?: string; hostId?: string }) => {
    const dir = input?.dir || ''
    if (input?.hostId) {
      const remote = remoteFromHostId(input.hostId, dir || undefined)
      if (!remote) return { ok: false, reason: 'error', dir, message: 'remote host not found' }
      return remoteSettings.validateProjectsDir(remote, dir).catch((e) => ({
        ok: false,
        reason: 'error',
        dir,
        message: (e as Error).message,
      }))
    }
    return classifyProjectsDir(dir, projectsDirFs())
  },
)
ipcMain.handle('settings:suggest-projects-dir', () => {
  const fs = projectsDirFs()
  const denser = pickDensestRoot(fs.candidateRoots(), (d) => countGitReposOneLevel(d, fs))
  return denser ? { dir: denser.root, repoCount: denser.count } : null
})
ipcMain.handle('snippets:list', (_e, root?: string) =>
  listPromptSnippets(repoRootOf(root || cur().cwd)),
)
ipcMain.handle('snippets:save', (_e, input: Parameters<typeof savePromptSnippet>[0]) => {
  const root = input.repoRoot ? repoRootOf(input.repoRoot) : repoRootOf(cur().cwd)
  const r = savePromptSnippet({ ...input, repoRoot: root })
  if ('ok' in r) {
    emitActivity({
      kind: 'info',
      title: `Snippet saved · ${r.snippet.title}`,
      detail: input.scope === 'global' ? 'Global' : repoLabelFor(root || cur().cwd),
      repo: input.scope === 'repo' ? repoLabelFor(root || cur().cwd) : undefined,
      repoRoot: input.scope === 'repo' ? root : undefined,
      sessionId: cur().sessionId,
    })
  }
  return r
})
ipcMain.handle('presets:get', () => ({
  prefs: readPresetPrefs(),
  catalog: {
    snippets: BUILT_IN_SNIPPETS.map((s) => ({ id: s.id, title: s.title, group: s.group })),
    agents: DEFAULT_AGENTS.map((a) => ({ id: a.id, title: a.title, group: 'Agents' })),
  },
}))
ipcMain.handle('presets:hide', (_e, kind: PresetKind, id: string) => hidePreset(kind, id))
ipcMain.handle('presets:restore', (_e, kind: PresetKind, id?: string) => restorePreset(kind, id))

async function remoteAgentCatalog(
  remote: NonNullable<ReturnType<typeof curRemote>>,
): Promise<Agent[]> {
  const hiddenDefaults = hiddenPresetIds('agents')
  const byId = new Map<string, Agent>()
  for (const a of DEFAULT_AGENTS.filter((a) => !hiddenDefaults.has(a.id))) {
    byId.set(a.id, { ...a, source: 'default', hasScript: false })
  }
  for (const a of await remoteAgents.list(remote).catch(() => [])) {
    byId.set(a.id, {
      ...byId.get(a.id),
      ...a,
      source: byId.has(a.id) ? ('repo-override' as const) : ('repo' as const),
    })
  }
  return [...byId.values()]
}

function remoteSteps(
  base: { label: string; prompt: string },
  personaId?: string,
  pipelineId?: string,
) {
  const persona = personaId ? readAgentRunContexts('').find((p) => p.id === personaId) : null
  return {
    steps: composeSteps(base, persona?.prompt ?? null, pipelineId),
    persona: persona?.title,
    pipeline: pipelineLabel(pipelineId),
  }
}

// OpenRouter (or-agent) and Hermes are local-only harnesses — a remote host has
// neither, so coerce them to a universally-present engine for remote dispatch.
function localOnlyToRemote(engine: Engine): Engine {
  // openrouter/openai-compat ride the local or-agent harness + local Settings
  // (base URL, sealed keys); hermes is a local install. None dispatch remotely.
  return engine === 'openrouter' || engine === 'hermes' || engine === 'openai-compat'
    ? 'claude'
    : engine
}

function remoteEngineModel(
  remote: NonNullable<ReturnType<typeof curRemote>>,
  engine: Engine,
  model?: string,
) {
  return resolveEngineModel(engine, model, remote.daemon) || undefined
}

ipcMain.handle('agents:list', async () => {
  const remote = curRemote()
  if (!remote) return readAgents(repoRootOf(cur().cwd))
  return remoteAgentCatalog(remote)
})
ipcMain.handle('agents:definitions', () => listAgentDefinitions(repoRootOf(cur().cwd)))
ipcMain.handle('agents:save', (_e, agent: { id: string; title: string; prompt: string }) => {
  if (curRemote()) return { error: 'remote agent editing needs the remote daemon writer' }
  const root = repoRootOf(cur().cwd)
  const r = saveAgent(root, agent)
  if ('ok' in r) {
    emitActivity({
      kind: 'info',
      title: `Agent saved · ${agent.title || agent.id}`,
      detail: agent.id,
      repo: repoLabelFor(root),
      repoRoot: root,
      sessionId: cur().sessionId,
    })
  }
  return r
})
ipcMain.handle('agents:reset', (_e, id: string) => {
  if (curRemote()) return { error: 'remote agent reset needs the remote daemon writer' }
  const root = repoRootOf(cur().cwd)
  const r = resetAgent(root, id)
  if ('ok' in r) {
    emitActivity({
      kind: 'info',
      title: `Agent reset · ${id}`,
      detail: 'Removed repo override',
      repo: repoLabelFor(root),
      repoRoot: root,
      sessionId: cur().sessionId,
    })
  }
  return r
})
// Read the script body for an agent if .agents/<id>.sh (or global) exists. Returns
// { path, body } when found, null otherwise — used by the Agents tab to render
// the bash inline alongside the prompt.
ipcMain.handle('agents:script', (_e, id: string) => {
  const remote = curRemote()
  if (remote) return remoteAgents.script(remote, id)
  const root = repoRootOf(cur().cwd) || ''
  const p = locateScript(root, id)
  if (!p) return null
  try {
    return { path: p, body: readFileSync(p, 'utf8') }
  } catch {
    return null
  }
})
ipcMain.handle('agents:state', (_e, id: string) => {
  if (curRemote()) return { path: `remote:${id}`, exists: false, state: {} }
  const root = repoRootOf(cur().cwd) || ''
  return readAgentState(root, id)
})
ipcMain.handle('agents:state-reset', (_e, id: string) => {
  if (curRemote()) return { ok: true }
  const root = repoRootOf(cur().cwd) || ''
  const r = resetAgentState(root, id)
  if ('ok' in r) {
    emitActivity({
      kind: 'info',
      title: `Agent state reset · ${id}`,
      detail: repoLabelFor(root),
      repo: repoLabelFor(root),
      repoRoot: root,
      sessionId: cur().sessionId,
    })
  }
  return r
})
ipcMain.handle(
  'agents:design',
  (_e, text: string, engine: Engine, scope: 'repo' | 'global', model?: string) =>
    curRemote()
      ? { error: 'remote agent design needs the remote daemon writer' }
      : runDesignerSpawn(repoRootOf(cur().cwd), text, engine, scope, model),
)
ipcMain.handle('schedules:design', (_e, text: string, engine: Engine) =>
  curRemote()
    ? { error: 'remote schedule design needs the remote daemon writer' }
    : runScheduleDesignerSpawn(repoRootOf(cur().cwd), text, engine),
)
ipcMain.handle('agents:pipelines', () => listPipelines())
ipcMain.handle('personas:list', () => readAgentRunContexts(repoRootOf(cur().cwd)))
ipcMain.handle(
  'agents:run',
  (
    _e,
    agentId: string,
    engine?: Engine,
    persona?: string,
    pipeline?: string,
    model?: string,
    requested?: unknown,
    openrouterHarness?: 'codex' | 'hermes',
    extraContext?: string,
  ) =>
    (async () => {
      const remote = requestedRemote(requested) || curRemote()
      if (!remote)
        return runAgent(
          repoRootOf(cur().cwd),
          agentId,
          engine,
          persona,
          pipeline,
          model,
          openrouterHarness,
          extraContext,
        )
      const agent = (await remoteAgentCatalog(remote)).find((a) => a.id === agentId)
      if (!agent) return { error: 'unknown agent' }
      // OpenRouter runs on the bundled local or-agent harness — never dispatch it
      // to a remote host (no or-agent there); fall back to the remote's engine.
      const resolvedEngine = localOnlyToRemote(
        engine || agent.engine || remote.daemon?.defaultEngine || 'codex',
      )
      const {
        steps,
        persona: personaLabel,
        pipeline: pipelineLabelText,
      } = remoteSteps({ label: agent.title, prompt: agent.prompt }, persona, pipeline)
      const run = await remoteRuns.start(remote, {
        agentId: agent.id,
        agentTitle: agent.title,
        engine: resolvedEngine,
        model: remoteEngineModel(remote, resolvedEngine, model ?? agent.model),
        steps,
        inPlace: agent.inPlace,
      })
      if (!('error' in run)) {
        emitActivity({
          kind: 'agent-run',
          title: `Remote agent started · ${agent.title}`,
          detail: `${remote.sshTarget} · ${resolvedEngine}${personaLabel ? ` · ${personaLabel}` : ''}${pipelineLabelText ? ` · ${pipelineLabelText}` : ''}`,
          repo: repoLabelFor(cur().cwd),
          sessionId: cur().sessionId,
          runId: run.id,
          runSource: 'agent',
        })
      }
      return run
    })(),
)
ipcMain.handle(
  'agents:run-ticket',
  async (
    _e,
    slug: string,
    engine: Engine,
    persona?: string,
    pipeline?: string,
    model?: string,
    requested?: unknown,
    lanes?: number,
    extraContext?: string,
  ) => {
    const remote = requestedRemote(requested) || curRemote()
    if (remote) {
      // v1: lanes are local-only. Remote runs a single attempt.
      return (async () => {
        const t = await remoteTickets.get(remote, slug)
        if (!t) return { error: 'ticket not found' }
        const base = `Implement backlog ticket #${t.id}: ${t.title}\n\n${t.body}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. Commit your work and open a PR that references ticket #${t.id}. If fully delivered set the ticket status to closed (else in-progress) and link the PR in its prs: field. End with a short summary of what changed and the PR URL.`
        const { steps } = remoteSteps(
          { label: `implement #${t.id}`, prompt: base },
          persona,
          pipeline,
        )
        const run = await remoteRuns.start(remote, {
          agentId: `ticket-${t.id}`,
          agentTitle: `Implement #${t.id}`,
          engine,
          model: remoteEngineModel(remote, engine, model),
          steps,
        })
        if ('error' in run) return run
        await remoteTickets
          .update(remote, slug, {
            run: {
              id: run.id,
              source: 'agent',
              sessionId: cur().sessionId,
              startedAt: new Date(run.startedAt).toISOString(),
              status: run.status,
            },
          })
          .catch(() => false)
        return run
      })()
    }
    const root = repoRootOf(cur().cwd)
    const t = await getRepoTicket(root, slug)
    if (!t) return { error: 'ticket not found' }
    const ticketInput = {
      slug: t.slug,
      id: t.id,
      title: t.title,
      body: t.body,
      externalKey: t.externalKey,
      url: t.url,
      agent: t.agent,
      modelTier: t.modelTier,
    }
    const res = runTicketLanes(
      root,
      ticketInput,
      engine,
      persona,
      pipeline,
      model,
      lanes,
      extraContext,
    )
    if ('error' in res) return res
    // Link the ticket's run pointer to the first lane (solo runs have exactly
    // one). Lanes deliberately don't each write the ticket — the judge links the
    // winner — so we record the lead run here for the at-a-glance run badge.
    const lead = res.runs[0]
    updateTicket(root, t.slug, {
      run: {
        id: lead.id,
        source: 'agent',
        sessionId: cur().sessionId,
        startedAt: new Date(lead.startedAt).toISOString(),
        status: lead.status,
      },
    })
    return lead
  },
)
ipcMain.handle(
  'agents:run-pr',
  (
    _e,
    pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
    kind: PrAgentKind,
    engine: Engine,
    persona?: string,
    pipeline?: string,
    model?: string,
    requested?: unknown,
  ) =>
    (async () => {
      const remote = requestedRemote(requested) || curRemote()
      if (!remote)
        return runPrAgent(repoRootOf(cur().cwd), pr, kind, engine, persona, pipeline, model)
      if (!pr?.sourceBranch) return { error: 'PR/MR has no source branch' }
      const probe = await remoteProbe(remote).catch(() => null)
      const forgeLabel = probe?.forgeLabel || 'MR'
      const forgeSym = probe?.forgeSym || '!'
      const tag = `${forgeLabel} ${forgeSym}${pr.iid}`
      const ref = pr.webUrl || `${forgeSym}${pr.iid}`
      const reviewCtx = `This worktree is checked out at the head of ${tag} (${ref}${pr.title ? ` — "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
      const iterateCtx = `${reviewCtx} After committing, push back to the ${forgeLabel} with \`git push origin HEAD:${pr.sourceBranch}\`.`
      const base =
        kind === 'review'
          ? `Review ${tag} using the repository's code-review agent contract. ${reviewCtx} Resolve the target branch and current head commit, inspect the diff and relevant history, run the project test gate, and write the review artifacts required by .agents/code-review.md when present. Do not implement fixes during review; file owner-scoped follow-up tickets for out-of-scope work. End with verdict, artifact path, test status, and key findings.`
          : `Iterate on ${tag} until it is merge-ready. ${iterateCtx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit and push your work. End with the final status and a short summary of what changed.`
      const { steps } = remoteSteps(
        { label: `${kind} ${forgeSym}${pr.iid}`, prompt: base },
        persona,
        pipeline,
      )
      return remoteRuns.start(remote, {
        agentId: `pr-${kind}-${pr.iid}`,
        agentTitle: `${kind === 'review' ? 'Review' : 'Iterate'} ${forgeSym}${pr.iid}`,
        engine,
        model: remoteEngineModel(remote, engine, model),
        steps,
        prRef: { iid: pr.iid, sourceBranch: pr.sourceBranch },
      })
    })(),
)
ipcMain.handle('agents:runs', async () => {
  const remote = curRemote()
  if (!remote) return listRuns()
  return (await remoteRuns.all(remote).catch(() => []))
    .filter((r) => r.source === 'agent' || r.source === 'cron')
    .map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentTitle: r.agentTitle,
      engine: r.engine,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      exitCode: r.exitCode,
      repoRoot: r.repoRoot,
      worktree: r.worktree,
      branch: r.branch,
      output: '',
    }))
})
ipcMain.handle('agents:rerun', (_e, runId: string) =>
  curRemote() ? { error: 'remote rerun needs the remote daemon runner' } : rerunAgentRun(runId),
)
ipcMain.handle('agents:cancel', (_e, runId: string) => (curRemote() ? false : cancelRun(runId)))
ipcMain.handle('agents:remove-worktree', (_e, runId: string) =>
  curRemote() ? false : removeWorktree(runId),
)
ipcMain.handle('persistent-agents:list', () => listPersistentAgents())
ipcMain.handle('persistent-agents:get', (_e, id: string) => getPersistentAgent(id))
ipcMain.handle('persistent-agents:save', (_e, input: unknown) => savePersistentAgent(input as any))
ipcMain.handle('persistent-agents:remove', (_e, id: string) => removePersistentAgent(id))
ipcMain.handle('persistent-agents:update-file', (_e, id: string, file: string, body: string) =>
  updatePersistentAgentFile(id, file as any, body),
)
ipcMain.handle(
  'persistent-agents:launch-prompt',
  (_e, id: string, task: string, repoRoot?: string, engine?: Engine, model?: string) =>
    persistentAgentLaunchPrompt(id, task, {
      repoRoot: repoRoot || repoRootOf(cur().cwd),
      engine,
      model,
    }),
)
ipcMain.handle(
  'persistent-agents:run',
  (_e, id: string, task: string, engine?: Engine, model?: string) =>
    runPersistentAgent(repoRootOf(cur().cwd), id, task, engine, model),
)
ipcMain.handle('persistent-agents:design', (_e, text: string, engine: Engine, model?: string) =>
  runPersistentAgentDesignerSpawn(repoRootOf(cur().cwd), text, engine, model),
)
ipcMain.handle('persistent-agents:files-list', (_e, id: string, rel: string) =>
  listPersistentAgentFiles(id, rel || ''),
)
ipcMain.handle('persistent-agents:files-read', (_e, id: string, rel: string) =>
  readPersistentAgentFile(id, rel),
)
ipcMain.handle('persistent-agents:files-write', (_e, id: string, rel: string, content: string) =>
  writePersistentAgentFile(id, rel, content),
)
ipcMain.handle('persistent-agents:files-create', (_e, id: string, rel: string, dir: boolean) =>
  createPersistentAgentFile(id, rel, dir),
)
ipcMain.handle('persistent-agents:files-delete', (_e, id: string, rel: string) =>
  removePersistentAgentFile(id, rel),
)
ipcMain.handle('persistent-agents:artifacts-list', (_e, id: string) =>
  listPersistentAgentArtifacts(id),
)
ipcMain.handle('persistent-agents:artifacts-read', (_e, id: string, rel: string) =>
  readPersistentAgentArtifact(id, rel),
)
// Schedules are backed by real launchd jobs; every mutation syncs launchd in
// lockstep, and `enriched` annotates each with its human cadence + next fire.
ipcMain.handle('schedules:list', () => {
  const now = Date.now()
  const remote = curRemote()
  if (remote) {
    return remoteSchedules
      .list(remote)
      .then((rows) =>
        rows.map((s) => ({ ...s, describe: describeSpec(s.spec), nextRun: nextRun(s.spec, now) })),
      )
      .catch(() => [])
  }
  return readSchedules(now).map((s) => ({
    ...s,
    describe: describeSpec(s.spec),
    // Calendar/cron jobs fire at fixed wall-clock times, so the next fire is a
    // pure function of the spec — no load-time anchor needed.
    nextRun: nextRun(s.spec, now),
    // Real "will it fire?" signal — probes launchd for LOCAL schedules only; a
    // host schedule (systemd/k8s) has no launchd job by design (see helper).
    loaded: scheduleLoadedState(s),
  }))
})
ipcMain.handle(
  'schedules:save',
  async (
    _e,
    input: {
      id?: string
      agentId: string
      engine: Engine
      model?: string
      spec: ScheduleSpec
      enabled?: boolean
      env?: Record<string, string>
      retry?: { maxRetries: number; backoffSec: number }
      timeoutSec?: number
      host?: string // hostId → fire on that host via systemd (ADR-0002); absent → local launchd
      runtime?: 'bare' | 'container' | 'k8s'
    },
  ) => {
    // Normalize the optional flaky-run knobs; drop anything non-numeric so a
    // half-filled editor field never writes garbage into schedules.json.
    const retry =
      input.retry && Number.isFinite(input.retry.maxRetries)
        ? {
            maxRetries: Math.max(0, Math.floor(input.retry.maxRetries)),
            backoffSec: Math.max(1, Math.floor(Number(input.retry.backoffSec) || 30)),
          }
        : undefined
    const timeoutSec =
      Number.isFinite(input.timeoutSec) && (input.timeoutSec as number) > 0
        ? Math.floor(input.timeoutSec as number)
        : undefined
    const remote = curRemote()
    if (remote) {
      return (async () => {
        const probe = await remoteProbe(remote).catch(() => null)
        const agents = await remoteAgentCatalog(remote)
        const agent = agents.find((a) => a.id === input.agentId)
        if (!agent) return { error: 'unknown agent' }
        const sched = {
          id: input.id || randomUUID(),
          repoRoot: probe?.repoRoot || '',
          repoLabel: repoLabelFor(cur().cwd),
          agentId: agent.id,
          agentTitle: agent.title,
          engine: input.engine || agent.engine || remote.daemon?.defaultEngine || 'codex',
          model: input.model ?? agent.model,
          prompt: agent.prompt,
          spec: input.spec,
          enabled: input.enabled ?? true,
          env: sanitizeScheduleEnv(input.env),
          retry,
          timeoutSec,
          createdAt: Date.now(),
          lastStatus: 'never' as const,
        }
        const r = await remoteSchedules.save(remote, sched)
        emitActivity({
          kind: 'check',
          title: `Remote schedule ${input.id ? 'updated' : 'created'} · ${agent.title}`,
          detail: `${sched.engine}${sched.model ? `/${sched.model}` : ''} · ${describeSpec(sched.spec)} · Run Now works over SSH; recurring timers need remote daemon install`,
          repo: sched.repoLabel,
          sessionId: cur().sessionId,
        })
        return r
      })()
    }
    const root = repoRootOf(cur().cwd)
    if (!root) return { error: 'not a git repo' }
    const agent = readAgents(root).find((a) => a.id === input.agentId)
    if (!agent) return { error: 'unknown agent' }
    // Host-targeted schedule: store the HOST repo path (~/repos/<name>, expanded by
    // the runner on the host) and ensure the repo is cloned there — the Mac repo
    // path wouldn't exist on the host, so the runner's worktree base would fail (#18).
    let hostRepoRootPath: string | undefined
    if (input.host) {
      const h = readSettings().remoteHosts.find((x) => x.id === input.host)
      if (!h) return { error: `unknown host: ${input.host}` }
      const er = await ensureHostRepo(h.sshTarget, root)
      if (!er.ok) return { error: `host repo: ${er.error}` }
      hostRepoRootPath = er.repoRoot
    }
    const base: NewSchedule = {
      repoRoot: hostRepoRootPath || root,
      repoLabel: repoForCwd(cur().cwd)?.path || basename(root),
      agentId: agent.id,
      agentTitle: agent.title,
      engine: input.engine || agent.engine || 'codex',
      model: input.model ?? agent.model,
      prompt: agent.prompt, // snapshot — runner uses this offline
      spec: input.spec,
      enabled: input.enabled ?? true,
      // Drop empty/whitespace-only keys so a half-filled editor doesn't pollute
      // the spawn env with bogus blanks; treat missing field as "no env vars".
      env: sanitizeScheduleEnv(input.env),
      retry,
      timeoutSec,
      host: input.host || undefined,
      runtime: input.runtime,
    }
    // Capture the prior schedule BEFORE the update so we can tear down its old
    // trigger if host or runtime changed — otherwise switching host A→B, k8s→bare,
    // bare→k8s, or local↔host would leave the previous timer/CronJob/plist firing.
    const prev = input.id ? getSchedule(input.id) : null
    const sched = input.id ? updateSchedule(input.id, base) : addSchedule(base)
    if (!sched) return { error: 'schedule not found' }
    if (prev && (prev.host !== sched.host || prev.runtime !== sched.runtime)) {
      await routeRemoveSchedule(prev).catch(() => {}) // best-effort teardown of the old trigger + host record
    }
    const r = await routeSyncSchedule(sched)
    if (!r.ok) return { error: r.error }
    emitActivity({
      kind: 'check',
      title: `Schedule ${input.id ? 'updated' : 'created'} · ${agent.title}`,
      detail: `${sched.engine}${sched.model ? `/${sched.model}` : ''} · ${describeSpec(sched.spec)}`,
      repo: sched.repoLabel,
      repoRoot: root,
      sessionId: cur().sessionId,
    })
    return { ok: true, id: sched.id }
  },
)

function sanitizeScheduleEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim()
    if (!key) continue
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue // POSIX-shaped var names only
    out[key] = String(v ?? '')
  }
  return Object.keys(out).length ? out : undefined
}
ipcMain.handle('schedules:remove', async (_e, id: string) => {
  const remote = curRemote()
  if (remote) return remoteSchedules.remove(remote, id).catch(() => false)
  const s = getSchedule(id)
  if (s) await routeRemoveSchedule(s)
  else unscheduleJob(id)
  const ok = removeSchedule(id)
  if (ok) {
    emitActivity({
      kind: 'check',
      title: `Schedule removed · ${s?.agentTitle || id}`,
      detail: s ? describeSpec(s.spec) : id,
      repo: s?.repoLabel,
      repoRoot: s?.repoRoot,
      sessionId: cur().sessionId,
    })
  }
  return ok
})
ipcMain.handle('schedules:toggle', async (_e, id: string, enabled: boolean) => {
  const remote = curRemote()
  if (remote) return remoteSchedules.toggle(remote, id, enabled).catch(() => false)
  const ok = toggleSchedule(id, enabled)
  const s = getSchedule(id)
  if (s) {
    try {
      await routeSyncSchedule(s)
    } catch {
      /* best effort */
    }
    if (ok) {
      emitActivity({
        kind: 'check',
        title: `Schedule ${enabled ? 'enabled' : 'paused'} · ${s.agentTitle}`,
        detail: describeSpec(s.spec),
        repo: s.repoLabel,
        repoRoot: s.repoRoot,
        sessionId: cur().sessionId,
      })
    }
  }
  return ok
})
// Fire a schedule's run on a remote — the same mechanism as the Runs-tab
// re-run (remote-helper `schedules.runNow` over SSH).
async function remoteRunNow(
  remote: RemoteSession,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const sched = (await remoteSchedules.list(remote).catch(() => [])).find((s) => s.id === id)
  const run = await remoteSchedules.runNow(remote, id, {
    worktreesDir: remote.daemon?.worktreesDir,
    enginePath: sched ? remote.daemon?.engines?.[sched.engine]?.path : undefined,
  })
  if ('error' in run) return run
  emitActivity({
    kind: 'agent-run',
    title: `Remote schedule run requested · ${sched?.agentTitle || id}`,
    detail: sched ? `${sched.engine}${sched.model ? `/${sched.model}` : ''}` : id,
    repo: sched?.repoLabel || repoLabelFor(cur().cwd),
    sessionId: cur().sessionId,
    runId: run.id,
    runSource: 'cron',
  })
  return { ok: true }
}
ipcMain.handle('schedules:run-now', (_e, id: string, hostId?: string) => {
  // Routed by routeRunNow (#43): an explicit hostId (the Runs-tab re-run path)
  // or the schedule's own `host` binding triggers the host-side runner over
  // SSH; only unbound schedules fall through to the attached-session remote or
  // the local launchd runner. A host schedule must never fire locally — its
  // repoRoot is a host-side path.
  const attached = curRemote()
  return routeRunNow(id, hostId, {
    getSchedule,
    hosts: () => readSettings().remoteHosts,
    hostRunNow: (host, sid) => {
      const remote = remoteFromHostId(host.id)
      return remote
        ? remoteRunNow(remote, sid)
        : Promise.resolve({ error: `unknown host: ${host.id}` })
    },
    attachedRunNow: attached ? (sid) => remoteRunNow(attached, sid) : undefined,
    localRunNow: (sid) => {
      const s = getSchedule(sid)
      runScheduleNow(sid)
      emitActivity({
        kind: 'agent-run',
        title: `Schedule run requested · ${s?.agentTitle || sid}`,
        detail: s ? `${s.engine}${s.model ? `/${s.model}` : ''}` : sid,
        repo: s?.repoLabel,
        repoRoot: s?.repoRoot,
        sessionId: cur().sessionId,
      })
    },
  })
})
ipcMain.handle('schedules:runs', (_e, id?: string) => {
  const remote = curRemote()
  return remote ? remoteSchedules.runs(remote, id).catch(() => []) : readCronRuns(id)
})
// Local runs only — always fast, safe to poll. Remote runs come from the
// separate `runs:remote-all` fan-out so the Runs tab can show BOTH in one view
// without switching the session's daemon profile.
ipcMain.handle('runs:all', () => listAllRuns())
// Fan out to every configured remote host in parallel, stamped with hostId so
// the tab can merge them with local runs and badge/filter by host. Best-effort:
// an unreachable host contributes an error entry, not a failed view.
ipcMain.handle('runs:remote-all', () => {
  const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
  return collectRemoteRuns(hosts, async (h) => {
    const ref = remoteFromHostId(h.id)
    if (!ref) return []
    return remoteRuns.all(ref)
  })
})
ipcMain.handle(
  'runs:log',
  (_e, source: 'cron' | 'agent' | 'bg' | 'session', runId: string, hostId?: string) => {
    // A run row carries its host; route the log fetch to that host. Fall back to
    // the focused session's remote (or local) when no hostId is supplied.
    const remote = hostId ? remoteFromHostId(hostId) : curRemote()
    if (remote) return remoteRuns.log(remote, runId).catch(() => '')
    if (source === 'cron') return readCronRunLog(runId)
    if (source === 'session') return readSessionRunLog(runId)
    if (source === 'bg') return readBgTaskLog(runId)
    // In-process agent run output lives in memory via listRuns(); fall back to the
    // on-disk log for a run that aged out of the in-memory working set (runs are
    // never deleted, so an archived run is still viewable).
    return listRuns().find((r) => r.id === runId)?.output || readAgentRunLog(runId)
  },
)
// Artifacts a run produced — agent-request reports under the repo's
// .TerMinal/agent-requests/ (#8). Local runs only; a remote run's artifacts live
// on its host. The renderer opens a report via openExternal(file://…).
ipcMain.handle('runs:artifacts', (_e, repoRoot: string) => listRepoArtifacts(repoRoot))
// Success-rate / duration trend over the last N days (#6) for the Runs tab.
ipcMain.handle('runs:trends', (_e, days?: number) => runTrends(days ?? 14))
// Cancel a running CRON run (#9). Local: SIGTERM the runner's own pid — its
// cooperative handler kills the current attempt and stops retrying, recording the
// run as canceled. Remote: route to the host's runs.cancel op.
ipcMain.handle('runs:cancel-cron', async (_e, id: string, hostId?: string) => {
  if (hostId) {
    const remote = remoteFromHostId(hostId)
    if (!remote) return { ok: false, error: `unknown host: ${hostId}` }
    return remoteRuns
      .cancel(remote, id)
      .then((ok) => (ok ? { ok: true } : { ok: false, error: 'host could not cancel the run' }))
      .catch((e) => ({ ok: false, error: String((e as Error).message || e) }))
  }
  const rec = readCronRuns(undefined, 20000).find((r) => r.id === id)
  if (!rec) return { ok: false, error: 'run not found' }
  if (rec.status !== 'running') return { ok: false, error: 'run is not running' }
  if (!rec.runnerPid)
    return { ok: false, error: 'no runner pid recorded (older run — cannot cancel)' }
  try {
    process.kill(rec.runnerPid, 'SIGTERM')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
ipcMain.handle('schedules:disabled-list', () => (curRemote() ? [] : listDisabled()))
ipcMain.handle('schedules:disabled-toggle', (_e, id: string, disabled: boolean) => {
  if (curRemote()) return false
  const ok = setAgentDisabled(id, disabled)
  emitActivity({
    kind: 'check',
    title: `Scheduled agent ${disabled ? 'paused' : 'resumed'} · ${id}`,
    detail: 'Manual override',
    sessionId: cur().sessionId,
  })
  return ok
})
ipcMain.handle('schedules:disabled-all', (_e, disabled: boolean) => {
  if (curRemote()) return false
  const ids = readSchedules(Date.now()).map((s) => s.id)
  const ok = setAllSchedulesDisabled(ids, disabled)
  emitActivity({
    kind: 'check',
    title: `All schedules ${disabled ? 'paused' : 'resumed'}`,
    detail: `${ids.length} schedule${ids.length === 1 ? '' : 's'}`,
    sessionId: cur().sessionId,
  })
  return ok
})
ipcMain.handle('schedules:run-log', (_e, runId: string) => {
  const remote = curRemote()
  return remote ? remoteSchedules.runLog(remote, runId).catch(() => '') : readCronRunLog(runId)
})
ipcMain.handle('schedules:reconcile', () =>
  curRemote()
    ? { ok: false, error: 'remote schedule reconcile needs the remote daemon runner' }
    : routeReconcile(readSchedules()),
)
// Baked at build time from git origin (electron.vite.config.ts define). '' when
// origin is unknown → hosts skip self-update rather than track a guessed repo.
declare const __BUILD_REPO_SLUG__: string
// Prepare a Linux host to run scheduled agents via systemd: install Bun, enable
// linger (headless firing), install the runner, report readiness (ADR-0002 #12).
ipcMain.handle('hosts:provision', async (_e, hostId: string) => {
  const host = readSettings().remoteHosts.find((h) => h.id === hostId)
  if (!host) return { ok: false, error: `unknown host: ${hostId}` }
  const engines = Object.keys(host.daemon?.engines || {})
  const r = await provisionHost(
    { sshTarget: host.sshTarget },
    runnerSrcPath(),
    engines.length ? engines : ['claude', 'codex'],
    {
      cliSrcPath: cliSrcPath(),
      // Hosts self-update from the repo THIS build was made from (baked at build
      // time from git origin), so a fork's hosts track the fork, not upstream.
      // '' → provisionHost skips self-update rather than guessing a repo.
      repoSlug: __BUILD_REPO_SLUG__,
    },
  )
  return { ok: r.ready, ...r }
})
// Reachability probe for a host (tailscale reauth / asleep / VPN down) → classified
// reason + actionable hint, so the UI degrades gracefully instead of hanging (#20).
ipcMain.handle('hosts:health', async (_e, hostId: string) => {
  const host = readSettings().remoteHosts.find((h) => h.id === hostId)
  if (!host) return { reachable: false, hint: `unknown host: ${hostId}` }
  return checkHostHealth(host.sshTarget)
})
ipcMain.handle('listeners:status', () => readListenerStatus())
ipcMain.handle('listeners:process', () => {
  const r = processListenerInbox()
  return { ...r, status: readListenerStatus() }
})
ipcMain.handle('listeners:toggle', (_e, enabled: boolean) => {
  setListenerEnabled(enabled)
  return readListenerStatus()
})
ipcMain.handle('listeners:open-dir', () => shell.openPath(readListenerStatus().inboxDir))
// Global HITL inbox (cross-repo). Filing fires a blocked notification (TG + macOS).
ipcMain.handle('hitl:list', () => readHitl())
// Fan out open HITL items from every configured host (ADR-0002 #14), stamped with
// hostId so the Inbox shows a host run's block alongside local ones. Best-effort:
// an unreachable host contributes an error, not a failed view.
ipcMain.handle('hitl:remote-all', () => {
  const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
  return collectRemoteHitl(hosts, async (h) => {
    const ref = remoteFromHostId(h.id)
    return ref ? remoteHitl.list(ref) : []
  })
})
ipcMain.handle('hitl:file', (_e, item: Omit<HitlItem, 'id' | 'status' | 'createdAt'>) =>
  fileHitl(item),
)
// Resolve/remove route to the item's host when it came from the remote fan-out
// (#14) — resolving a host block on the Mac must write on the host that owns it,
// not locally. No hostId → local, as before.
ipcMain.handle('hitl:resolve', (_e, id: string, resolved?: boolean, hostId?: string) => {
  if (hostId) {
    const ref = remoteFromHostId(hostId)
    if (ref) return remoteHitl.resolve(ref, id, resolved ?? true).catch(() => false)
  }
  return resolveHitl(id, resolved ?? true)
})
ipcMain.handle('hitl:remove', (_e, id: string, hostId?: string) => {
  if (hostId) {
    const ref = remoteFromHostId(hostId)
    if (ref) return remoteHitl.remove(ref, id).catch(() => false)
  }
  return removeHitl(id)
})
// Factory: read-only cross-repo health roll-up + start the orchestrator in-place.
ipcMain.handle('factory:health', () => factoryHealth())
ipcMain.handle('factory:start', (_e, engine: Engine) => {
  const remote = curRemote()
  if (!remote) return runFactorySpawn(repoRootOf(cur().cwd), engine || 'codex')
  const prompt = `Run the /factory orchestrator for THIS repository, following the project's /factory skill exactly. This is a no-handoff loop: continuously turn the backlog into REVIEWED, merge-ready PRs by reconciling with /merge-sync, running /stacked-mr passes, compacting/migrating context at phase boundaries, then continuing with any runnable independent lane. NEVER stop with "tell me when you're ready" language. Stop only if the user explicitly stops you, the goal is actually complete, or every remaining lane is blocked on human-only action. NEVER merge to main/master — the human merges. Park any TRUE human-need to the global HITL inbox, then continue other work. Emit an activity event at each checkpoint.`
  return remoteRuns.start(remote, {
    agentId: 'factory',
    agentTitle: 'Factory',
    engine: engine || remote.daemon?.defaultEngine || 'claude',
    model: remoteEngineModel(remote, engine || remote.daemon?.defaultEngine || 'claude'),
    steps: [{ label: 'factory loop', prompt }],
    inPlace: true,
  })
})
ipcMain.handle('schedules:remove-all', () => {
  if (curRemote()) return { removed: 0 }
  const n = removeAllJobs()
  for (const s of readSchedules()) removeSchedule(s.id)
  emitActivity({
    kind: 'check',
    title: 'All launchd schedules removed',
    detail: `${n} job${n === 1 ? '' : 's'} removed`,
    sessionId: cur().sessionId,
  })
  return { removed: n }
})
// ---- PTY IPC (routed by session key) ----
ipcMain.on('pty:input', (_e, key: string, data: string) => {
  sessions.get(key)?.pty.write(data)
})
ipcMain.on('pty:resize', (_e, key: string, size: { cols: number; rows: number }) => {
  try {
    sessions.get(key)?.pty.resize(size.cols, size.rows)
  } catch {
    /* ignore transient resize errors */
  }
})

// ---- data IPC (plugin pollers; all keyed to the attached session) ----
ipcMain.handle('data:transcript', () => readTranscriptStats(cur().sessionId))
ipcMain.handle('data:harness-tdd', () => readHarnessTdd(cur().cwd))
ipcMain.handle('data:usage', () => readUsage(cur().sessionId))
ipcMain.handle('data:git-status', () => {
  return activeDaemon().gitStatus()
})
ipcMain.handle('data:session-tasks', () => readSessionTasks(cur().sessionId))
ipcMain.handle('data:meta', () => ({ ...cur(), claude: enginePath('claude') }))

// ---- command widgets (declarative, per-repo extensible) ----
ipcMain.handle('widgets:list', () => listCommandWidgets(cur().cwd))
ipcMain.handle('widgets:run', (_e, command: string) => runCommand(command, cur().cwd))

// ---- custom tabs (declarative full-screen views, per-repo extensible) ----
ipcMain.handle('tabs:list', (_e, cwd?: string) => listCustomTabs(cwd || cur().cwd))
ipcMain.handle('tabs:run', (_e, command: string, cwd?: string) =>
  runTabCommand(command, cwd || cur().cwd),
)

// ---- scratch workspace (throwaway, repo-less sessions) ----
// One app-owned dir under the existing TerMinal config root — persistent
// (unlike /tmp), out of the way (unlike ~), and not a git repo so repo-scoped
// tabs/widgets stay off. All scratch sessions share it → one "scratch"
// workspace grouping.
ipcMain.handle('scratch:dir', () => {
  const dir = join(homedir(), '.config', 'TerMinal', 'scratch')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* already exists / race */
  }
  return dir
})

// ---- tabs: repo context + tickets/MRs (scoped to the session's repo) ----
ipcMain.handle('tab:context', async () => {
  return activeDaemon().context(cur().sessionId)
})
ipcMain.handle('docs:list', () => {
  return activeDaemon().docsList()
})
ipcMain.handle('docs:get', (_e, relPath: string) => {
  return activeDaemon().docsGet(relPath)
})
ipcMain.handle('sessions:project-list', () => {
  return activeDaemon().sessionsList()
})
ipcMain.handle('sessions:project-get', (_e, slug: string) => activeDaemon().sessionGet(slug))
ipcMain.handle('tickets:list', () => {
  return activeDaemon().ticketsList()
})
ipcMain.handle('tickets:get', (_e, slug: string) => {
  return activeDaemon().ticketGet(slug)
})
ipcMain.handle('tickets:provider-get', () => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local') return { error: 'Ticket provider setup is local-only for now.' }
  return readRepoTicketConfig(daemon.repoRoot())
})
ipcMain.handle('tickets:provider-save', (_e, cfg: RepoTicketsConfig) => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local') return { error: 'Ticket provider setup is local-only for now.' }
  const saved = saveRepoTicketConfig(daemon.repoRoot(), cfg)
  // Seed the vault's guide/board/template on save (idempotent, best-effort).
  if (saved.provider === 'obsidian') scaffoldObsidianVault(saved.obsidian)
  emitActivity({
    kind: 'info',
    title: `Ticket provider · ${saved.provider || 'local'}`,
    detail: daemon.repoLabel(),
    repo: daemon.repoLabel(),
    repoRoot: daemon.repoRoot(),
    sessionId: cur().sessionId,
  })
  return saved
})
ipcMain.handle('tickets:provider-test', (_e, cfg: RepoTicketsConfig, smoke?: boolean) => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local')
    return { ok: false, provider: 'local', message: 'Ticket provider setup is local-only for now.' }
  return testRepoTicketProvider(daemon.repoRoot(), cfg, { smoke: !!smoke })
})
ipcMain.handle('tickets:linear-teams', (_e, cfg?: RepoTicketsConfig) => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local') return []
  return listLinearTeams(daemon.repoRoot(), cfg)
})
// Open a ticket in Obsidian via its obsidian:// deep link. No-op (returns false)
// when the repo isn't on the obsidian provider or the vault isn't configured.
ipcMain.handle('tickets:open-in-obsidian', (_e, slug: string) => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local') return false
  const link = obsidianRepoDeepLink(daemon.repoRoot(), slug)
  if (!link) return false
  shell.openExternal(link)
  return true
})
ipcMain.handle('tickets:create', async (_e, input: NewTicket) => {
  const daemon = activeDaemon()
  const t = await daemon.ticketCreate(input)
  emitActivity({
    kind: 'ticket-filed',
    title: `Ticket filed · #${t.id}`,
    detail: t.title,
    repo: daemon.repoLabel(),
    repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
    sessionId: cur().sessionId,
    ref: { ticket: t.id },
  })
  return t
})
ipcMain.handle('tickets:recommend-agent', (_e, input: TicketAgentRecommendationInput) =>
  recommendTicketAgent(input),
)
ipcMain.handle(
  'tickets:spawn',
  (_e, text: string, engine: Engine, model?: string, requested?: unknown) => {
    const daemon = daemonForRequest(requested)
    if (!daemon.remote) return runTicketSpawn(daemon.repoRoot(), text, engine, model)
    const t = text.trim()
    if (!t) return { error: 'empty request' }
    const prompt = `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id, write .TerMinal/backlog/NNNN-slug.md with valid YAML frontmatter matching the repo's examples (legacy v1 repos may use backlog/), put detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
    return remoteRuns.start(daemon.remote, {
      agentId: 'ticket-spawn',
      agentTitle: `File ticket · ${t.slice(0, 48)}`,
      engine,
      model: remoteEngineModel(daemon.remote, engine, model),
      steps: [{ label: 'file ticket', prompt }],
      inPlace: true,
    })
  },
)
ipcMain.handle('tickets:update', async (_e, slug: string, patch: TicketPatch) => {
  const daemon = activeDaemon()
  const before = await daemon.ticketGet(slug)
  const ok = await daemon.ticketUpdate(slug, patch)
  if (ok && patch.status) {
    const t = await daemon.ticketGet(slug)
    const unblocked = before?.status === 'stuck' && patch.status !== 'stuck'
    emitActivity({
      kind: patch.status === 'closed' ? 'ticket-closed' : 'info',
      title: unblocked
        ? `Ticket unblocked · #${t?.id ?? slug}`
        : `Ticket ${patch.status} · #${t?.id ?? slug}`,
      detail: unblocked ? `${t?.title || slug} · ${patch.status}` : t?.title,
      repo: daemon.repoLabel(),
      repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
      sessionId: cur().sessionId,
      ref: t?.id ? { ticket: t.id } : undefined,
    })
  } else if (ok && patch.priority) {
    const t = await daemon.ticketGet(slug)
    emitActivity({
      kind: 'info',
      title: `Ticket priority · #${t?.id ?? slug}`,
      detail: `${t?.title || slug} · ${patch.priority}`,
      repo: daemon.repoLabel(),
      repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
      sessionId: cur().sessionId,
      ref: t?.id ? { ticket: t.id } : undefined,
    })
  }
  return ok
})
ipcMain.handle('skills:list', () => activeDaemon().skillsList())
ipcMain.handle('mrs:list', () => {
  return activeDaemon().mrsList()
})
ipcMain.handle('mrs:get', (_e, iid: number) => {
  return activeDaemon().mrGet(iid)
})
ipcMain.handle('mrs:diff', (_e, iid: number) => {
  return activeDaemon().mrDiff(iid)
})
ipcMain.handle('git:working-diff', () => {
  return activeDaemon().workingDiff()
})
ipcMain.handle('git:working-structural-diff', (_e, path: string, width?: number) => {
  return activeDaemon().workingStructuralDiff(path, width)
})
ipcMain.handle('mrs:structural-diff', (_e, iid: number, path: string, width?: number) => {
  return activeDaemon().mrStructuralDiff(iid, path, width)
})
ipcMain.handle('difft:available', () => difftOnPath())
ipcMain.handle('digest:get', (_e, iid: number, short?: string) => {
  return activeDaemon().digestGet(iid, short)
})
ipcMain.handle('digest:run', (_e, iid: number) => {
  return activeDaemon().digestRun(iid)
})
ipcMain.handle('digest:status', (_e, iid: number) => {
  return activeDaemon().digestRunStatus(iid)
})
ipcMain.handle('mrs:ci', (_e, iid: number) => {
  return activeDaemon().mrCi(iid)
})
ipcMain.handle('mrs:merge', (_e, iid: number) => {
  return activeDaemon().mrMerge(iid)
})
ipcMain.handle('open:external', (_e, url: string) => openExternalSafe(url))
// Reveal ~/.config/TerMinal/ in Finder. Power-user QoL for editing
// schedules.json, settings.json, or per-(repo, agent) state sidecars by hand.
ipcMain.handle('open:config-dir', () => shell.openPath(join(homedir(), '.config', 'TerMinal')))

// Install the MCP server entry into ~/.claude/mcp.json (and ~/.codex's
// equivalent if it exists). Read-only, stdio transport. Idempotent —
// re-running just updates the binary path.
ipcMain.handle('mcp:install', () => {
  const binPath = join(homedir(), '.config', 'TerMinal', 'bin', 'terminal-mcp-server')
  if (!existsSync(binPath)) {
    return { error: `terminal-mcp-server not installed at ${binPath}` }
  }
  const installed: string[] = []
  // Claude Code: ~/.claude/mcp.json (per Anthropic CLI docs)
  try {
    const claudeMcp = join(homedir(), '.claude', 'mcp.json')
    let cfg: any = {}
    if (existsSync(claudeMcp)) {
      try {
        cfg = JSON.parse(readFileSync(claudeMcp, 'utf8'))
      } catch {
        cfg = {}
      }
    }
    cfg.mcpServers ??= {}
    cfg.mcpServers['terminal-harness'] = {
      command: binPath,
      args: [],
    }
    mkdirSync(dirname(claudeMcp), { recursive: true })
    writeFileSync(claudeMcp, JSON.stringify(cfg, null, 2))
    installed.push('Claude Code (~/.claude/mcp.json)')
  } catch (e) {
    return { error: `failed to write Claude config: ${(e as Error).message}` }
  }
  return { ok: true, installed }
})

// Workspace bootstrap helpers.
// "Bootstrapped" === the project-template machinery is present in the repo
// (we check .agents/ as a low-effort proxy — the other dirs come together
// with it). Used by the in-session banner.
// First-user-prompt for an arbitrary session id (not just the active one).
// Used by the auto-naming flow in App.tsx — labels brand-new sessions with a
// truncated version of what the user actually asked Claude to do, instead of
// the bare "S1"/"S2" ordinal. The firstUserText is already extracted +
// capped to 140 chars by parseTranscriptFile.
ipcMain.handle('data:first-prompt', (_e, sessionId: string) => {
  if (!sessionId) return ''
  return readTranscriptStats(sessionId).firstUserText || ''
})

ipcMain.handle('workspace:is-bootstrapped', (_e, repoRoot: string) => {
  const remote = curRemote()
  if (remote)
    return remoteProject.bootstrapStatus(remote).catch((e) => ({
      state: 'none',
      bootstrapped: false,
      missing: [],
      message: (e as Error).message,
    }))
  if (!repoRoot) return { bootstrapped: true, state: 'full', missing: [], message: '' }
  return classifyBootstrapStatus(repoRoot, (rel) => existsSync(join(repoRoot, rel)))
})
// Run project-template/bootstrap.sh against a repo. The script is idempotent
// and skips clobbering existing files (it writes `<name>.workflow` sidecars
// for conflicts). Streams nothing — we just wait and return ok/error.
ipcMain.handle('workspace:bootstrap', async (_e, repoRoot: string) => {
  const remote = curRemote()
  if (remote) {
    const templateRepo = remote.daemon?.templateRepo || resolvedTemplateRepo()
    return remoteProject
      .bootstrap(remote, templateRepo)
      .catch((e) => ({ error: (e as Error).message }))
  }
  if (!repoRoot) return { error: 'no repoRoot' }
  const src = projectTemplateSource('bootstrap.sh')
  if ('error' in src) return { error: src.error }
  const script = join(src.dir, 'bootstrap.sh')
  // Template provenance (ticket 0045) — resolved BEFORE the spawn because
  // src.cleanup?.() may delete a tmp clone on exit.
  const templateSha = resolveTemplateSha(src.dir, bakedTemplateSha())
  return new Promise<{ ok: true; templateSha?: string } | { error: string }>((resolve) => {
    const p = cpSpawn('bash', [script, repoRoot], { stdio: 'pipe' })
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('exit', (code) => {
      src.cleanup?.()
      if (code === 0) {
        // Best-effort: a stamp failure shouldn't fail a completed bootstrap.
        try {
          writeBootstrapStamp(repoRoot, { sha: templateSha, stampedAt: new Date().toISOString() })
        } catch {
          /* repo stays unstamped */
        }
        resolve({ ok: true, templateSha })
      } else
        resolve({ error: `bootstrap exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}` })
    })
    p.on('error', (e) => {
      src.cleanup?.()
      resolve({ error: e.message })
    })
  })
})

// Installed-build update check (update-check.ts): compares the baked build sha
// against origin/main via the local source checkout (exact, fork-aware), else
// the GitHub compare API. On demand from the renderer + once after startup.
declare const __BUILD_SHA__: string
declare const __BUILD_REPO_PATH__: string
function runUpdateCheck() {
  // Same discovery as release:start, plus the checkout path baked at build time
  // (the packaged app's cwd/appPath never point at the source tree).
  const repoPath =
    sourceCheckoutRoot(join('bin', 'release')) ||
    (__BUILD_REPO_PATH__ && existsSync(join(__BUILD_REPO_PATH__, 'bin', 'release'))
      ? __BUILD_REPO_PATH__
      : '')
  return checkForUpdate({
    buildStamp: __BUILD_SHA__,
    repoPath: repoPath || undefined,
    repoSlug: __BUILD_REPO_SLUG__ || undefined,
  })
}
ipcMain.handle('update:check', () => runUpdateCheck())

// In-app rebuild. Spawns bin/release fully detached and routes its output to
// a log file the renderer can tail. The release script kills the running
// TerMinal mid-flow (so it can replace /Applications/TerMinal.app); the
// detached child outlives the parent and finishes the install + relaunch.
//
// Why detached + own process group: bin/release does `pkill -f
// "/Applications/TerMinal.app/Contents/MacOS"` which would otherwise kill the
// build itself. Putting the child in its own group + ignoring stdio + unref()
// makes it a true daemon — the harness exits cleanly and the script lands a
// fresh app in /Applications a minute or so later.
const RELEASE_LOG = join(homedir(), '.config', 'TerMinal', 'release.log')
let releasePid: number | null = null
ipcMain.handle('release:start', () => {
  if (releasePid) {
    try {
      process.kill(releasePid, 0) // throws if process is gone
      return { error: 'release already running' }
    } catch {
      releasePid = null
    }
  }
  // Resolve the repo root from this app's bundle. In dev this is the source
  // tree; in the packaged build there's no bin/release (packaged users would
  // need the source checkout). Refuse cleanly if it's missing.
  // We probe a few candidates: GT_REPO env var (dev override) → process.cwd()
  // → __dirname climb-up. This is enough for the dev / source-installed
  // workflow TerMinal actually runs in.
  const repoRoot = sourceCheckoutRoot(join('bin', 'release'))
  if (!repoRoot) {
    return {
      error:
        'bin/release not found — set GT_TERMINAL_REPO to your source checkout, or run from the repo directory',
    }
  }
  // Truncate the log so each rebuild starts fresh.
  try {
    writeFileSync(
      RELEASE_LOG,
      `▸ rebuild started ${new Date().toISOString()}\n▸ repo: ${repoRoot}\n`,
    )
  } catch {
    /* best-effort */
  }
  const out = openSync(RELEASE_LOG, 'a')
  const child = cpSpawn('bin/release', [], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  })
  child.unref()
  releasePid = child.pid || null
  emitActivity(
    {
      kind: 'check',
      title: 'Release started',
      detail: repoRoot,
      repo: repoLabelFor(repoRoot),
      repoRoot,
    },
    { notify: false },
  )
  return { ok: true, pid: releasePid, log: RELEASE_LOG, repoRoot }
})
ipcMain.handle('release:tail', () => {
  try {
    return readFileSync(RELEASE_LOG, 'utf8')
  } catch {
    return ''
  }
})
// Harness self-status. Meta-observability snapshot so the operator can see
// how the harness itself is doing without ls-ing config dirs. Cheap: one
// directory listing + the in-memory run map.
// Background tasks IPCs. /bg <prompt> fires a detached run.
ipcMain.handle('bg:list', () => (curRemote() ? [] : listBgTasks()))
ipcMain.handle('bg:get', (_e, id: string) => (curRemote() ? null : getBgTask(id)))
ipcMain.handle('bg:log', (_e, id: string) => (curRemote() ? '' : readBgTaskLog(id)))
ipcMain.handle(
  'bg:spawn',
  (_e, input: { repoRoot: string; prompt: string; engine?: Engine; model?: string }) => {
    const remote = curRemote()
    if (!remote) return spawnBgTask(input)
    const prompt = input.prompt?.trim()
    if (!prompt) return { error: 'empty prompt' }
    const engine = localOnlyToRemote(input.engine || remote.daemon?.defaultEngine || 'claude')
    const enrichedPrompt =
      prompt +
      `\n\n---\n` +
      `When you're done, if you opened a PR/MR include its URL on a line by itself in the format:\nMR: <url>\n` +
      `If you completed the task without opening a PR/MR, say so on a line starting with:\nDONE: <one-line summary>\n` +
      `If you couldn't complete the task, say so on a line starting with:\nFAILED: <one-line reason>`
    return remoteRuns.start(remote, {
      agentId: 'background-task',
      agentTitle: 'Background task',
      engine,
      model: remoteEngineModel(remote, engine, input.model),
      steps: [{ label: 'background task', prompt: enrichedPrompt }],
    })
  },
)
ipcMain.handle('bg:cancel', (_e, id: string) => (curRemote() ? false : cancelBgTask(id)))

// Loops — long-running planner/generator/evaluator loops (LOOPS.md pattern).
ipcMain.handle('loops:list', () => (curRemote() ? [] : listLoops()))
ipcMain.handle('loops:get', (_e, id: string) => (curRemote() ? null : getLoop(id) || null))
ipcMain.handle('loops:state', (_e, id: string) => (curRemote() ? null : readLoopState(id)))
ipcMain.handle('loops:create', (_e, input: CreateLoopInput) => {
  if (curRemote()) return { error: 'remote' }
  let repoRoot = input.repoRoot
  if (!repoRoot) {
    // default to the git top-level of the focused session's cwd
    const cwd = cur().cwd
    if (!cwd) return { error: 'no active session — open a repo first' }
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: 'pipe' })
        .toString()
        .trim()
    } catch {
      return { error: `not a git repo: ${cwd}` }
    }
  }
  return createLoop({ ...input, repoRoot })
})
ipcMain.handle('loops:step', (_e, id: string) => (curRemote() ? { error: 'remote' } : stepLoop(id)))
ipcMain.handle('loops:restart', (_e, id: string) =>
  curRemote() ? { error: 'remote' } : restartLoop(id),
)
ipcMain.handle('loops:stop', (_e, id: string) => (curRemote() ? { error: 'remote' } : stopLoop(id)))

// Cheap one-shot LLM call — routes through local coding-agent subscriptions.
ipcMain.handle(
  'llm:cheap',
  async (_e, opts: Parameters<typeof import('./cheap-llm').cheapCall>[0]) => {
    const { cheapCall } = await import('./cheap-llm')
    return cheapCall(opts)
  },
)

// Classifier IPCs — exposed so scripts/dashboard can use them too.
ipcMain.handle('classify:ci', async (_e, rawLog: string) => {
  const { classifyCiFailure } = await import('./ci-failure-classifier')
  return classifyCiFailure(rawLog)
})
ipcMain.handle(
  'classify:risk',
  async (_e, input: Parameters<typeof import('./pr-risk-classifier').classifyRisk>[0]) => {
    const { classifyRisk } = await import('./pr-risk-classifier')
    return classifyRisk(input)
  },
)

// Budget IPCs (#0002).
ipcMain.handle('budgets:get', () => readBudgets())
ipcMain.handle('budgets:setDaily', (_e, usd: number) => {
  const r = setDailyCap(usd)
  emitActivity({ kind: 'info', title: 'Daily budget updated', detail: `$${usd.toFixed(2)}` })
  return r
})
ipcMain.handle('budgets:setAgent', (_e, agentId: string, usd: number) => {
  const r = setAgentCap(agentId, usd)
  emitActivity({
    kind: 'info',
    title: `Agent budget updated · ${agentId}`,
    detail: `$${usd.toFixed(2)}`,
  })
  return r
})
ipcMain.handle('budgets:override', (_e, durationMs: number) => {
  const r = setOverride(durationMs)
  emitActivity({
    kind: 'info',
    title: 'Budget override set',
    detail: `${Math.round(durationMs / 60000)} minutes`,
  })
  return r
})
ipcMain.handle('budgets:gate', (_e, agentId?: string) => gateSpawn(agentId))

// AI fleet observability IPCs. Pull from the per-run AI ledger.
ipcMain.handle('observability:summary', (_e, range: Range = 'today') =>
  curRemote()
    ? { totalUsd: 0, totalRuns: 0, byModel: {}, bySource: {}, byAgent: {}, byRepo: {} }
    : summaryFor(range),
)
ipcMain.handle('observability:byAgent', (_e, range: Range = 'week') =>
  curRemote() ? [] : agentROI(range),
)
ipcMain.handle('observability:daily', (_e, days: number = 7) =>
  curRemote() ? [] : dailySpend(days),
)
ipcMain.handle('observability:runs', (_e, limit: number = 100) =>
  curRemote() ? [] : listAIRuns(limit),
)
ipcMain.handle('observability:models', () => knownModels())
ipcMain.handle('observability:index-status', () =>
  curRemote()
    ? {
        ...observabilityIndexStatus(),
        ok: false,
        error: 'Remote observability indexing is not wired yet.',
      }
    : observabilityIndexStatus(),
)
ipcMain.handle('observability:index-rebuild', (_e, limit: number = 240) =>
  curRemote()
    ? {
        ...observabilityIndexStatus(),
        ok: false,
        error: 'Remote observability indexing is not wired yet.',
        durationMs: 0,
        indexedSessions: 0,
      }
    : rebuildObservabilityIndex(limit),
)
ipcMain.handle('observability:index-query', (_e, query: ObservabilityIndexQueryId, arg?: string) =>
  curRemote()
    ? {
        ...queryObservabilityIndex(query, arg),
        rows: [],
        error: 'Remote observability indexing is not wired yet.',
      }
    : queryObservabilityIndex(query, arg),
)
ipcMain.handle('agentview:snapshot', (_e, limit: number = 120) =>
  curRemote()
    ? {
        ts: Date.now(),
        sessions: [],
        totals: {
          sessions: 0,
          readySessions: 0,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          toolCalls: 0,
        },
        byEngine: {},
        byRepo: {},
        topTools: [],
      }
    : readObservabilitySnapshot(limit),
)
ipcMain.handle('agentview:session', (_e, sessionId: string) =>
  curRemote() ? null : readObservabilitySessionDetail(sessionId),
)
ipcMain.handle('agentview:tool-call', (_e, sessionId: string, callId: string) =>
  curRemote() ? null : readObservabilityToolCallPayload(sessionId, callId),
)
ipcMain.handle(
  'agentview:transcript-window',
  (_e, sessionId: string, centerLine: number = 0, radius: number = 24) =>
    curRemote() ? null : readObservabilityTranscriptWindow(sessionId, centerLine, radius),
)
ipcMain.handle('harness:status', () => {
  const cfgDir = join(homedir(), '.config', 'TerMinal')
  const cronRunsDir = join(cfgDir, 'cron-runs')
  let cronRunFiles = 0
  let cronWorktrees = 0
  if (existsSync(cronRunsDir)) {
    try {
      cronRunFiles = readdirSync(cronRunsDir).filter((f) => f.endsWith('.json')).length
    } catch {
      /* ignore */
    }
  }
  const wtDir = join(cfgDir, 'cron-worktrees')
  if (existsSync(wtDir)) {
    try {
      cronWorktrees = readdirSync(wtDir).length
    } catch {
      /* ignore */
    }
  }
  const cronRuns = readCronRuns(undefined, 1000)
  const running = cronRuns.filter((r) => r.status === 'running').length
  const failed24h = cronRuns.filter(
    (r) => r.status === 'failed' && r.startedAt >= Date.now() - 86_400_000,
  ).length
  const paused = listDisabled().length
  const inProcessRunning = listRuns().filter((r) => r.status === 'running').length
  return {
    cronRunFiles,
    cronWorktrees,
    cronRunsRunning: running,
    cronFailed24h: failed24h,
    inProcessRunning,
    schedulesPaused: paused,
    configDir: cfgDir,
  }
})
ipcMain.handle('release:status', () => {
  if (!releasePid) return { running: false }
  try {
    process.kill(releasePid, 0)
    return { running: true, pid: releasePid }
  } catch {
    return { running: false, pid: releasePid }
  }
})
// Hand a target to a configured external app via `open -a <App>` (robust, no
// PATH/CLI dependency), falling back to the OS default if the app isn't there.
function openInApp(appName: string, target: string, fallback: () => void) {
  try {
    const p = cpSpawn('open', ['-a', appName, target], { stdio: 'ignore' })
    p.on('error', fallback)
    p.on('exit', (code) => {
      if (code !== 0) fallback()
    })
  } catch {
    fallback()
  }
}
// "Open in browser" — the configured browser (default Brave) with its extensions/wallet.
ipcMain.handle('open:in-browser', (_e, url: string) =>
  openInApp(resolvedBrowserApp(), url, () => shell.openExternal(url)),
)
// "Open in editor" — the configured editor (default Cursor). Opens a path; defaults
// to the active session's repo root.
ipcMain.handle('open:in-editor', (_e, path?: string) => {
  const target = path || repoRootOf(cur().cwd) || cur().cwd || homedir()
  openInApp(resolvedEditorApp(), target, () => shell.openPath(target))
})
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:read', () => clipboard.readText())
ipcMain.handle('clipboard:imageToFile', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const dir = join(tmpdir(), 'terminal-pastes')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `paste-${randomUUID().slice(0, 8)}.png`)
  writeFileSync(file, img.toPNG())
  return file
})

// ---- notes (repo-bound + global, persisted) ----
ipcMain.handle('notes:read', (_e, scope: NotesScope) => {
  return activeDaemon().notesRead(scope)
})
ipcMain.handle('notes:write', (_e, scope: NotesScope, content: string) =>
  activeDaemon().notesWrite(scope, content),
)
function configuredNoteFolder(id: string) {
  return readSettings().noteFolders.find((f) => f.id === id)
}
ipcMain.handle('notes:folder-list', (_e, id: string, rel: string) => {
  const folder = configuredNoteFolder(id)
  return folder ? listNoteFolder(folder.path, rel || '') : []
})
ipcMain.handle('notes:folder-read', (_e, id: string, rel: string) => {
  const folder = configuredNoteFolder(id)
  return folder
    ? readNoteFolderFile(folder.path, rel)
    : { ok: false, content: '', reason: 'note folder not found' }
})
ipcMain.handle('notes:folder-write', (_e, id: string, rel: string, content: string) => {
  const folder = configuredNoteFolder(id)
  return folder ? writeNoteFolderFile(folder.path, rel, content) : false
})
ipcMain.handle('knowledge:read', (_e, scope: KnowledgeScope) => {
  return readKnowledge(scope, activeDaemon().repoRoot())
})
ipcMain.handle('knowledge:write', (_e, scope: KnowledgeScope, kb: KnowledgeBase) => {
  return writeKnowledge(scope, activeDaemon().repoRoot(), kb)
})
ipcMain.handle('knowledge:preview', (_e, url: string) => fetchKnowledgePreview(url))
ipcMain.handle('knowledge:rag-status', (_e, scope: KnowledgeScope, item: any) =>
  knowledgeRagStatus({ scope, repoRoot: activeDaemon().repoRoot(), item }),
)
ipcMain.handle(
  'knowledge:rag-reindex',
  (_e, scope: KnowledgeScope, item: any, fullRebuild?: boolean) =>
    knowledgeRagReindex({ scope, repoRoot: activeDaemon().repoRoot(), item }, !!fullRebuild),
)
ipcMain.handle(
  'knowledge:rag-add-document',
  (_e, scope: KnowledgeScope, item: any, content: string, filepath?: string) =>
    knowledgeRagAddDocument({
      scope,
      repoRoot: activeDaemon().repoRoot(),
      item,
      content,
      filepath,
    }),
)
ipcMain.handle(
  'knowledge:rag-add-url',
  (_e, scope: KnowledgeScope, item: any, url: string, title?: string) =>
    knowledgeRagAddUrl({ scope, repoRoot: activeDaemon().repoRoot(), item, url, title }),
)
ipcMain.handle('knowledge:rag-search', (_e, scope: KnowledgeScope, item: any, query: string) =>
  knowledgeRagSearch({ scope, repoRoot: activeDaemon().repoRoot(), item, query }),
)

// ---- files (Cursor-like editor; scoped to repo root / cwd) ----
ipcMain.handle('files:list', (_e, rel: string) => {
  return activeDaemon().filesList(rel || '')
})
ipcMain.handle('files:read', (_e, rel: string) => {
  return activeDaemon().filesRead(rel)
})
ipcMain.handle('files:write', (_e, rel: string, content: string) => {
  return activeDaemon().filesWrite(rel, content)
})
ipcMain.handle('files:search', (_e, q: string) => {
  return activeDaemon().filesSearch(q)
})
ipcMain.handle('workspace:search', (_e, q: string, kinds?: WorkspaceSearchKind[]) => {
  return activeDaemon().search(q, kinds)
})
ipcMain.handle('files:create', (_e, rel: string, dir: boolean) => {
  return activeDaemon().filesCreate(rel, dir)
})
ipcMain.handle('files:rename', (_e, from: string, to: string) => {
  return activeDaemon().filesRename(from, to)
})
ipcMain.handle('files:delete', (_e, rel: string) => {
  return activeDaemon().filesDelete(rel)
})

// ---- my workflow (local Claude/Codex configuration) ----
ipcMain.handle('workflow:list', (_e, rel: string) => listWorkflowFiles(rel || ''))
ipcMain.handle('workflow:read', (_e, rel: string) => readWorkflowFile(rel))
ipcMain.handle('workflow:write', (_e, rel: string, content: string) =>
  writeWorkflowFile(rel, content),
)

// Safety net: never let a stray async error (e.g. a late PTY write) take down
// the whole app.
process.on('uncaughtException', (e) => console.error('[gt] uncaught:', e))

// Standard role-based menu, minus the View → Zoom items. Electron's default
// menu binds Cmd +/-/0 to webContents zoom, which shadows the terminal's own
// font-zoom keys and fights the app's uiScale. Dropping just those three items
// frees the keys for the terminal; every other default role (Edit copy/paste,
// Window, app menu) is preserved verbatim.
function installAppMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  fixPath() // packaged app has a minimal PATH — recover brew CLIs (glab/gh/…)
  installAppMenu()
  createWindow()
  // App-side watchdog. Catches phantom cron runs (schedule deleted before
  // runner finalized, terminal closed mid-run, OOM) that the per-schedule
  // sweep in bin/terminal-cron can't reach when no schedules are firing.
  sweepStaleCronRuns()
  setInterval(sweepStaleCronRuns, 30 * 60 * 1000)
  // In-process session runs die with the app — finalize any left at status:running
  // by a prior crash/quit so the Runs tab's "running" count reflects reality.
  sweepStaleSessionRuns()
  // AI fleet observability — periodic transcript scans for cost/token rollups.
  startAICollectionLoop()
  // Background-task watcher (#0004) — reconciles bg-tasks.json state with
  // actual PIDs, sweeps completed tasks, fires Telegram pings on MR ready.
  startBgWatcher()
  // Loop watcher — reconciles in-flight role turns and advances the phase.
  startLoopWatcher()
  // Paired-loop listener — always-on channel between a loop's two live sessions.
  startLoopListener(loopListenerDeps)
  // Budget watcher — fires HITL pings at warnAt thresholds.
  startBudgetWatcher()
  // Local automation listener inbox — processes JSON files dropped into
  // ~/.config/TerMinal/automation-inbox/new while the app is running.
  startListenerInboxWatcher()
  // Mobile bridge — binds a port ONLY when the setting is on.
  void applyBridgeSetting()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  void stopBridge() // never leave the port bound after the app goes away
})

app.on('window-all-closed', () => {
  if (watchTimer) clearInterval(watchTimer)
  if (activityTimer) clearInterval(activityTimer)
  if (telegramTimer) clearInterval(telegramTimer)
  for (const s of sessions.values()) s.pty.kill()
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
