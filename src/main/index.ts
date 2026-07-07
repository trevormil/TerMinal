import { app, shell, BrowserWindow, ipcMain, dialog, clipboard, Tray, Menu, nativeImage, safeStorage } from 'electron'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { statSync, existsSync, readdirSync, readFileSync, writeFileSync, openSync, mkdirSync } from 'node:fs'
import { spawn as cpSpawn, execFileSync, type ChildProcess } from 'node:child_process'
import * as pty from 'node-pty'

// The main bundle is ESM (package.json "type": "module"), so __dirname doesn't
// exist — derive the module dir the ESM-canonical way or the window never opens.
const moduleDir = dirname(fileURLToPath(import.meta.url))

function sourceCheckoutRoot(marker: string): string {
  const candidates = [process.env.GT_TERMINAL_REPO || '', process.cwd(), app.getAppPath(), join(moduleDir, '..', '..')].filter(Boolean)
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

type AgentViewUpstreamStatus = {
  ok: boolean
  running: boolean
  starting: boolean
  url: string
  apiUrl: string
  repoRoot: string
  error?: string
  log?: string
}

const AGENTVIEW_URL = 'http://127.0.0.1:5173'
const AGENTVIEW_API_URL = 'http://127.0.0.1:4317'
let agentViewApiProc: ChildProcess | null = null
let agentViewWebProc: ChildProcess | null = null
let agentViewInstallProc: ChildProcess | null = null
let agentViewStarting: Promise<AgentViewUpstreamStatus> | null = null
let agentViewLog = ''

function appendAgentViewLog(label: string, chunk: unknown) {
  const text = String(chunk || '')
  if (!text) return
  agentViewLog = `${agentViewLog}${text
    .split('\n')
    .filter(Boolean)
    .map((line) => `[${label}] ${line}`)
    .join('\n')}\n`.slice(-12_000)
}

function agentViewRepoRoot(): string {
  const terminalRoot = sourceCheckoutRoot(join('src', 'main', 'index.ts')) || join(moduleDir, '..', '..')
  const candidates = [
    process.env.AGENTVIEW_REPO || '',
    join(terminalRoot, 'vendor', 'agentview'),
    join(homedir(), 'CompSci', 'gauntlet', 'TerMinal', 'vendor', 'agentview'),
    join(homedir(), 'CompSci', 'gauntlet', 'agentview'),
    join(homedir(), 'CompSci', 'gauntlet', '.scratch', 'agentview-fresh'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json')) && existsSync(join(candidate, 'src', 'frontend', 'App.tsx'))) return candidate
  }
  return ''
}

async function urlOk(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 900)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function waitForUrl(url: string, timeoutMs = 20_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await urlOk(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return false
}

function spawnAgentViewProcess(repoRoot: string, script: 'api' | 'dev'): ChildProcess {
  const child = cpSpawn('bun', ['run', script], {
    cwd: repoRoot,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => appendAgentViewLog(script, chunk))
  child.stderr?.on('data', (chunk) => appendAgentViewLog(script, chunk))
  child.on('exit', (code, signal) => {
    appendAgentViewLog(script, `exited code=${code ?? ''} signal=${signal ?? ''}`)
    if (script === 'api') agentViewApiProc = null
    else agentViewWebProc = null
  })
  return child
}

function runAgentViewInstall(repoRoot: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (existsSync(join(repoRoot, 'node_modules'))) {
      resolve(true)
      return
    }
    appendAgentViewLog('install', 'node_modules missing; running npm ci from upstream package-lock.json')
    const child = cpSpawn('npm', ['ci'], {
      cwd: repoRoot,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    agentViewInstallProc = child
    child.stdout?.on('data', (chunk) => appendAgentViewLog('install', chunk))
    child.stderr?.on('data', (chunk) => appendAgentViewLog('install', chunk))
    child.on('exit', (code, signal) => {
      appendAgentViewLog('install', `exited code=${code ?? ''} signal=${signal ?? ''}`)
      agentViewInstallProc = null
      resolve(code === 0)
    })
    child.on('error', (error) => {
      appendAgentViewLog('install', error.message)
      agentViewInstallProc = null
      resolve(false)
    })
  })
}

async function agentViewUpstreamStatus(): Promise<AgentViewUpstreamStatus> {
  const repoRoot = agentViewRepoRoot()
  const running = (await urlOk(AGENTVIEW_URL)) && (await urlOk(`${AGENTVIEW_API_URL}/api/health`))
  return {
    ok: !!repoRoot,
    running,
    starting: !!agentViewStarting,
    url: AGENTVIEW_URL,
    apiUrl: AGENTVIEW_API_URL,
    repoRoot,
    error: repoRoot ? undefined : 'AgentView checkout not found. Initialize vendor/agentview or set AGENTVIEW_REPO.',
    log: agentViewLog,
  }
}

async function startAgentViewUpstream(): Promise<AgentViewUpstreamStatus> {
  if (agentViewStarting) return agentViewStarting
  agentViewStarting = (async () => {
    const repoRoot = agentViewRepoRoot()
    if (!repoRoot) return agentViewUpstreamStatus()
    agentViewLog = ''
    const installed = await runAgentViewInstall(repoRoot)
    if (!installed) {
      return {
        ok: false,
        running: false,
        starting: false,
        url: AGENTVIEW_URL,
        apiUrl: AGENTVIEW_API_URL,
        repoRoot,
        error: 'AgentView dependency install failed. Check the startup log.',
        log: agentViewLog,
      }
    }
    const apiLive = await urlOk(`${AGENTVIEW_API_URL}/api/health`)
    const webLive = await urlOk(AGENTVIEW_URL)
    if (!apiLive && !agentViewApiProc) agentViewApiProc = spawnAgentViewProcess(repoRoot, 'api')
    if (!webLive && !agentViewWebProc) agentViewWebProc = spawnAgentViewProcess(repoRoot, 'dev')
    const ready = await waitForUrl(AGENTVIEW_URL, 25_000)
    const apiReady = await waitForUrl(`${AGENTVIEW_API_URL}/api/health`, 10_000)
    return {
      ok: ready && apiReady,
      running: ready && apiReady,
      starting: false,
      url: AGENTVIEW_URL,
      apiUrl: AGENTVIEW_API_URL,
      repoRoot,
      error: ready && apiReady ? undefined : 'AgentView did not become ready. Check the startup log.',
      log: agentViewLog,
    }
  })().finally(() => {
    agentViewStarting = null
  })
  return agentViewStarting
}

function stopAgentViewUpstream() {
  agentViewInstallProc?.kill('SIGTERM')
  agentViewApiProc?.kill('SIGTERM')
  agentViewWebProc?.kill('SIGTERM')
  agentViewInstallProc = null
  agentViewApiProc = null
  agentViewWebProc = null
}

import {
  readTranscriptStats,
  readHarnessTdd,
  listSessions,
  findSessionFile,
  readSessionTasks,
  lastAssistantTurn,
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
import { emitActivity, readActivity, clearActivity, onActivity, startActivityTail } from './events'
import { readUsage } from './usage'
import { installStatuslineShim, statuslineSettingsArg } from './statusline'
import { listCommandWidgets, runCommand } from './widgets'
import { listCustomTabs, runTabCommand } from './tabs'
import { repoRootOf, repoForCwd } from './repo'
import { getTicket, recommendTicketAgent, updateTicket } from './backlog'
import type { NewTicket, TicketAgentRecommendationInput, TicketPatch } from './backlog'
import { loadRegistry, type ModuleRegistry, type ProfileId, type DataSource } from './modules'
import { moduleStatus } from './modules-detect'
import { seedModules, applyProfile } from './modules-seed'
import { runModuleQuery } from './modules-query'
import {
  getRepoTicket,
  listLinearTeams,
  readRepoTicketConfig,
  saveRepoTicketConfig,
  testRepoTicketProvider,
  type RepoTicketsConfig,
} from './ticket-provider'
import { mrSummary } from './mrs'
import { onDigestEvent } from './digest-run'
import { listNoteFolder, readNoteFolderFile, writeNoteFolderFile, type NotesScope } from './notes'
import { fetchKnowledgePreview, readKnowledge, writeKnowledge, type KnowledgeScope, type KnowledgeBase } from './knowledge'
import { knowledgeRagAddDocument, knowledgeRagAddUrl, knowledgeRagReindex, knowledgeRagSearch, knowledgeRagStatus } from './knowledge-rag'
import { BUILT_IN_SNIPPETS, listPromptSnippets, savePromptSnippet } from './snippets'
import { hiddenPresetIds, hidePreset, readPresetPrefs, restorePreset, type PresetKind } from './presets'
import { listWorkflowFiles, readWorkflowFile, writeWorkflowFile } from './workflow-files'
import { listDisabled, setDisabled as setAgentDisabled, setAllDisabled as setAllSchedulesDisabled } from './agents-disabled'
import { scaffoldProject } from './scaffold'
import {
  readSettings,
  patchSettings,
  setSettingsSecretStorage,
  telegramControlEnabled,
  resolvedProjectsDir,
  resolvedEditorApp,
  resolvedBrowserApp,
  resolvedTemplateRepo,
  enginePath,
  engineDefaultModel,
  resolveEngineModel,
  classifyProjectsDir,
  type SettingsPatch,
  type RemotePlatform,
  type DaemonCfg,
} from './settings'
import { classifyBootstrapStatus } from './bootstrap'
import { cloneTemplateToTmp, pickTemplateSource, templateCandidates, type TemplateSource } from './template'
import { configureTelegramControl, markTelegramControlEnabled, pollTelegramOnce, testTelegram } from './telegram'
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
import { readSchedules, addSchedule, updateSchedule, removeSchedule, toggleSchedule, getSchedule, type NewSchedule } from './schedules'
import {
  installRunner,
  installCli,
  installMcpServer,
  // mcp-register pulled separately below; not part of launchd helpers.
  reconcileSchedules,
  syncSchedule,
  unscheduleJob,
  removeAllJobs,
  runScheduleNow,
} from './launchd'
import { registerMcpEverywhere } from './mcp-register'
import {
  appendSessionRunLog,
  beginSessionRun,
  finalizeSessionRun,
  readCronRuns,
  readCronRunLog,
  readSessionRunLog,
  listAllRuns,
  sweepStaleCronRuns,
} from './cron-runs'
import { summaryFor, agentROI, dailySpend, listAIRuns, type Range } from './ai-runs'
import { startAICollectionLoop } from './ai-collectors'
import { processListenerInbox, readListenerStatus, setListenerEnabled, startListenerInboxWatcher } from './listeners'
import { knownModels } from './ai-pricing'
import { readBudgets, setDailyCap, setAgentCap, setOverride, gateSpawn, startBudgetWatcher } from './budgets'
import { spawnBgTask, listBgTasks, getBgTask, cancelBgTask, readBgTaskLog, startBgWatcher, type BgTask } from './bg-tasks'
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
import { readHitl, fileHitl, resolveHitl, removeHitl, type HitlItem } from './hitl'
import { factoryHealth } from './factory-health'
import { describeSpec, nextRun, type ScheduleSpec } from './cron'
import { composeSteps, pipelineLabel } from './pipelines'
import { type WorkspaceSearchKind } from './workspace-search'
import {
  remoteAgents,
  remoteCommandForEngine,
  remoteDirs,
  remoteMrs,
  remoteProbe,
  remoteProject,
  remoteRuns,
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
  if (!input || typeof input !== 'object' || !('sshTarget' in input) || typeof input.sshTarget !== 'string') return undefined
  return input as RemoteSession
}
function sshPathBasename(cwdOrRoot: string): string {
  const rest = cwdOrRoot.replace(/^ssh:\/\//, '')
  const slash = rest.indexOf('/')
  const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
  return remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() || (slash >= 0 ? rest.slice(0, slash) : rest)
}
const repoLabelFor = (cwdOrRoot: string) =>
  cwdOrRoot.startsWith('ssh://') ? sshPathBasename(cwdOrRoot) : repoForCwd(cwdOrRoot)?.path || basename(repoRootOf(cwdOrRoot) || cwdOrRoot || '')

type StartOpts = {
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
  return pinned.remote ? daemonForRemote(pinned.remote, pinned.cwd) : createLocalWorkspaceDaemon(pinned.cwd)
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
  const defaultModel = engine !== 'local' ? remote?.daemon?.engines?.[engine]?.defaultModel || (!remote ? engineDefaultModel(engine) : '') : ''

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
  } else if (opts.mode === 'resume' && opts.sessionId) {
    sessionId = opts.sessionId
    args.push('--resume', sessionId)
  } else {
    sessionId = randomUUID()
    args.push('--session-id', sessionId)
    if (opts.name) args.push('--name', opts.name)
  }
  if (engine === 'claude') args.push(...CLAUDE_AUTO_FLAGS)
  if (defaultModel && engine !== 'local') args.push('--model', defaultModel)
  const remoteEnginePath = remote && engine !== 'local' ? remote.daemon?.engines?.[engine]?.path : undefined
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

  const proc = remote
    ? pty.spawn('ssh', ['-tt', remote.sshTarget, remoteCommandForEngine(engine, args, cwd, remoteEnginePath)], {
        name: 'xterm-256color',
        cols: opts.cols || 80,
        rows: opts.rows || 30,
        cwd: homedir(),
        env,
      })
    : engine === 'local'
      ? pty.spawn(LOGIN_SHELL, ['-l'], {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd,
          env,
        })
      : pty.spawn(LOGIN_SHELL, ['-l', '-c', [enginePath(engine), ...args].map(shq).join(' ')], {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd,
          env,
        })
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
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_e, d) => console.error('[gt] renderer gone:', d.reason))

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
  const runnerSrc = app.isPackaged ? join(process.resourcesPath, 'terminal-cron') : join(moduleDir, '../../bin/terminal-cron')
  installRunner(runnerSrc)
  const cliSrc = app.isPackaged ? join(process.resourcesPath, 'terminal-cli') : join(moduleDir, '../../bin/terminal-cli')
  installCli(cliSrc)
  const mcpSrc = app.isPackaged ? join(process.resourcesPath, 'terminal-mcp-server') : join(moduleDir, '../../bin/terminal-mcp-server')
  installMcpServer(mcpSrc)
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
    if (!r.claude.ok) console.warn(`mcp register claude: ${r.claude.action} (${r.claude.error || ''})`)
    if (!r.codex.ok) console.warn(`mcp register codex: ${r.codex.action} (${r.codex.error || ''})`)
  } catch (e) {
    console.warn(`mcp register failed: ${(e as Error).message}`)
  }
  try {
    reconcileSchedules()
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
ipcMain.handle('fleet:list', () => {
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
      name: s.pinned.name || (s.pinned.remote ? s.pinned.remote.label || s.pinned.remote.sshTarget : basename(s.pinned.cwd)) || 'session',
      cwd: s.pinned.cwd,
      repo: s.pinned.remote ? s.pinned.remote.label || s.pinned.remote.sshTarget : repoForCwd(s.pinned.cwd)?.path || basename(repoRootOf(s.pinned.cwd) || s.pinned.cwd),
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
ipcMain.handle('project:scaffold', (_e, name: string, parentDir?: string) => {
  const r = scaffoldProject(name, parentDir)
  emitActivity(
    {
      kind: r.ok ? 'task-complete' : 'error',
      title: r.ok ? `Project scaffolded · ${basename(r.path || name)}` : `Project scaffold failed · ${name}`,
      detail: r.ok ? r.path : r.error,
      repo: r.ok && r.path ? basename(r.path) : undefined,
      repoRoot: r.ok ? r.path : undefined,
    },
    { notify: !r.ok },
  )
  return r
})
ipcMain.handle('remote:dirs', (_e, hostId: string, path?: string) => {
  const remote = remoteFromHostId(hostId, path)
  if (!remote) return { cwd: path || '', parent: '', entries: [], error: 'remote host not found' }
  return remoteDirs.list(remote, path).catch((e) => ({ cwd: path || '', parent: '', entries: [], error: (e as Error).message }))
})
ipcMain.handle('remote:scaffold', async (_e, hostId: string, name: string, parentDir?: string) => {
  const remote = remoteFromHostId(hostId, parentDir)
  if (!remote) return { ok: false, error: 'remote host not found' }
  const templateRepo = remote.daemon?.templateRepo || resolvedTemplateRepo()
  const r = await remoteProject.scaffold(remote, name, parentDir || remote.cwd || '~', templateRepo).catch((e) => ({
    ok: false,
    path: undefined,
    error: (e as Error).message,
  }))
  emitActivity(
    {
      kind: r.ok ? 'task-complete' : 'error',
      title: r.ok ? `Remote project scaffolded · ${basename(r.path || name)}` : `Remote project scaffold failed · ${name}`,
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
ipcMain.handle('settings:validate-projects-dir', async (_e, input: { dir?: string; hostId?: string }) => {
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
  return classifyProjectsDir(dir, (d) => existsSync(join(d, '.git')))
})
ipcMain.handle('snippets:list', (_e, root?: string) => listPromptSnippets(repoRootOf(root || cur().cwd)))
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

async function remoteAgentCatalog(remote: NonNullable<ReturnType<typeof curRemote>>): Promise<Agent[]> {
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

function remoteSteps(base: { label: string; prompt: string }, personaId?: string, pipelineId?: string) {
  const persona = personaId ? readAgentRunContexts('').find((p) => p.id === personaId) : null
  return {
    steps: composeSteps(base, persona?.prompt ?? null, pipelineId),
    persona: persona?.title,
    pipeline: pipelineLabel(pipelineId),
  }
}

function remoteEngineModel(remote: NonNullable<ReturnType<typeof curRemote>>, engine: Engine, model?: string) {
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
ipcMain.handle('agents:design', (_e, text: string, engine: Engine, scope: 'repo' | 'global', model?: string) =>
  curRemote() ? { error: 'remote agent design needs the remote daemon writer' } : runDesignerSpawn(repoRootOf(cur().cwd), text, engine, scope, model),
)
ipcMain.handle('schedules:design', (_e, text: string, engine: Engine) =>
  curRemote() ? { error: 'remote schedule design needs the remote daemon writer' } : runScheduleDesignerSpawn(repoRootOf(cur().cwd), text, engine),
)
ipcMain.handle('agents:pipelines', () => listPipelines())
ipcMain.handle('personas:list', () => readAgentRunContexts(repoRootOf(cur().cwd)))
ipcMain.handle('agents:run', (_e, agentId: string, engine?: Engine, persona?: string, pipeline?: string, model?: string, requested?: unknown) =>
  (async () => {
    const remote = requestedRemote(requested) || curRemote()
    if (!remote) return runAgent(repoRootOf(cur().cwd), agentId, engine, persona, pipeline, model)
    const agent = (await remoteAgentCatalog(remote)).find((a) => a.id === agentId)
    if (!agent) return { error: 'unknown agent' }
    const resolvedEngine = engine || agent.engine || remote.daemon?.defaultEngine || 'claude'
    const { steps, persona: personaLabel, pipeline: pipelineLabelText } = remoteSteps({ label: agent.title, prompt: agent.prompt }, persona, pipeline)
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
ipcMain.handle('agents:run-ticket', async (_e, slug: string, engine: Engine, persona?: string, pipeline?: string, model?: string, requested?: unknown, lanes?: number) => {
  const remote = requestedRemote(requested) || curRemote()
  if (remote) {
    // v1: lanes are local-only. Remote runs a single attempt.
    return (async () => {
      const t = await remoteTickets.get(remote, slug)
      if (!t) return { error: 'ticket not found' }
      const base = `Implement backlog ticket #${t.id}: ${t.title}\n\n${t.body}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. Commit your work and open a PR that references ticket #${t.id}. If fully delivered set the ticket status to closed (else in-progress) and link the PR in its prs: field. End with a short summary of what changed and the PR URL.`
      const { steps } = remoteSteps({ label: `implement #${t.id}`, prompt: base }, persona, pipeline)
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
  const ticketInput = { slug: t.slug, id: t.id, title: t.title, body: t.body, externalKey: t.externalKey, url: t.url, agent: t.agent }
  const res = runTicketLanes(root, ticketInput, engine, persona, pipeline, model, lanes)
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
})
ipcMain.handle(
  'agents:run-pr',
  (_e, pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string }, kind: PrAgentKind, engine: Engine, persona?: string, pipeline?: string, model?: string, requested?: unknown) =>
    (async () => {
      const remote = requestedRemote(requested) || curRemote()
      if (!remote) return runPrAgent(repoRootOf(cur().cwd), pr, kind, engine, persona, pipeline, model)
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
      const { steps } = remoteSteps({ label: `${kind} ${forgeSym}${pr.iid}`, prompt: base }, persona, pipeline)
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
ipcMain.handle('agents:rerun', (_e, runId: string) => (curRemote() ? { error: 'remote rerun needs the remote daemon runner' } : rerunAgentRun(runId)))
ipcMain.handle('agents:cancel', (_e, runId: string) => (curRemote() ? false : cancelRun(runId)))
ipcMain.handle('agents:remove-worktree', (_e, runId: string) => (curRemote() ? false : removeWorktree(runId)))
ipcMain.handle('persistent-agents:list', () => listPersistentAgents())
ipcMain.handle('persistent-agents:get', (_e, id: string) => getPersistentAgent(id))
ipcMain.handle('persistent-agents:save', (_e, input: unknown) => savePersistentAgent(input as any))
ipcMain.handle('persistent-agents:remove', (_e, id: string) => removePersistentAgent(id))
ipcMain.handle('persistent-agents:update-file', (_e, id: string, file: string, body: string) => updatePersistentAgentFile(id, file as any, body))
ipcMain.handle('persistent-agents:launch-prompt', (_e, id: string, task: string, repoRoot?: string, engine?: Engine, model?: string) =>
  persistentAgentLaunchPrompt(id, task, {
    repoRoot: repoRoot || repoRootOf(cur().cwd),
    engine,
    model,
  }),
)
ipcMain.handle('persistent-agents:run', (_e, id: string, task: string, engine?: Engine, model?: string) => runPersistentAgent(repoRootOf(cur().cwd), id, task, engine, model))
ipcMain.handle('persistent-agents:design', (_e, text: string, engine: Engine, model?: string) => runPersistentAgentDesignerSpawn(repoRootOf(cur().cwd), text, engine, model))
ipcMain.handle('persistent-agents:files-list', (_e, id: string, rel: string) => listPersistentAgentFiles(id, rel || ''))
ipcMain.handle('persistent-agents:files-read', (_e, id: string, rel: string) => readPersistentAgentFile(id, rel))
ipcMain.handle('persistent-agents:files-write', (_e, id: string, rel: string, content: string) => writePersistentAgentFile(id, rel, content))
ipcMain.handle('persistent-agents:files-create', (_e, id: string, rel: string, dir: boolean) => createPersistentAgentFile(id, rel, dir))
ipcMain.handle('persistent-agents:files-delete', (_e, id: string, rel: string) => removePersistentAgentFile(id, rel))
ipcMain.handle('persistent-agents:artifacts-list', (_e, id: string) => listPersistentAgentArtifacts(id))
ipcMain.handle('persistent-agents:artifacts-read', (_e, id: string, rel: string) => readPersistentAgentArtifact(id, rel))
// Schedules are backed by real launchd jobs; every mutation syncs launchd in
// lockstep, and `enriched` annotates each with its human cadence + next fire.
ipcMain.handle('schedules:list', () => {
  const now = Date.now()
  const remote = curRemote()
  if (remote) {
    return remoteSchedules
      .list(remote)
      .then((rows) => rows.map((s) => ({ ...s, describe: describeSpec(s.spec), nextRun: nextRun(s.spec, now) })))
      .catch(() => [])
  }
  return readSchedules(now).map((s) => ({
    ...s,
    describe: describeSpec(s.spec),
    nextRun: nextRun(s.spec, now),
  }))
})
ipcMain.handle(
  'schedules:save',
  (
    _e,
    input: {
      id?: string
      agentId: string
      engine: Engine
      model?: string
      spec: ScheduleSpec
      enabled?: boolean
      env?: Record<string, string>
    },
  ) => {
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
          engine: input.engine || agent.engine || remote.daemon?.defaultEngine || 'claude',
          model: input.model ?? agent.model,
          prompt: agent.prompt,
          spec: input.spec,
          enabled: input.enabled ?? true,
          env: sanitizeScheduleEnv(input.env),
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
    const base: NewSchedule = {
      repoRoot: root,
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
    }
    const sched = input.id ? updateSchedule(input.id, base) : addSchedule(base)
    if (!sched) return { error: 'schedule not found' }
    const r = syncSchedule(sched)
    if (!r.ok) return { error: `launchd: ${r.error}` }
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
ipcMain.handle('schedules:remove', (_e, id: string) => {
  const remote = curRemote()
  if (remote) return remoteSchedules.remove(remote, id).catch(() => false)
  const s = getSchedule(id)
  unscheduleJob(id)
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
ipcMain.handle('schedules:toggle', (_e, id: string, enabled: boolean) => {
  const remote = curRemote()
  if (remote) return remoteSchedules.toggle(remote, id, enabled).catch(() => false)
  const ok = toggleSchedule(id, enabled)
  const s = getSchedule(id)
  if (s) {
    try {
      syncSchedule(s)
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
ipcMain.handle('schedules:run-now', async (_e, id: string) => {
  const remote = curRemote()
  if (remote) {
    const sched = (await remoteSchedules.list(remote).catch(() => [])).find((s) => s.id === id)
    const run = await remoteSchedules.runNow(remote, id, {
      worktreesDir: remote.daemon?.worktreesDir,
      enginePath: sched ? remote.daemon?.engines?.[sched.engine]?.path : undefined,
    })
    if (!('error' in run)) {
      emitActivity({
        kind: 'agent-run',
        title: `Remote schedule run requested · ${sched?.agentTitle || id}`,
        detail: sched ? `${sched.engine}${sched.model ? `/${sched.model}` : ''}` : id,
        repo: sched?.repoLabel || repoLabelFor(cur().cwd),
        sessionId: cur().sessionId,
        runId: run.id,
        runSource: 'cron',
      })
    }
    return 'error' in run ? run : { ok: true }
  }
  const s = getSchedule(id)
  runScheduleNow(id)
  emitActivity({
    kind: 'agent-run',
    title: `Schedule run requested · ${s?.agentTitle || id}`,
    detail: s ? `${s.engine}${s.model ? `/${s.model}` : ''}` : id,
    repo: s?.repoLabel,
    repoRoot: s?.repoRoot,
    sessionId: cur().sessionId,
  })
  return { ok: true }
})
ipcMain.handle('schedules:runs', (_e, id?: string) => {
  const remote = curRemote()
  return remote ? remoteSchedules.runs(remote, id).catch(() => []) : readCronRuns(id)
})
ipcMain.handle('runs:all', () => {
  const remote = curRemote()
  return remote ? remoteRuns.all(remote).catch(() => []) : listAllRuns()
})
ipcMain.handle('runs:log', (_e, source: 'cron' | 'agent' | 'bg' | 'session', runId: string) => {
  const remote = curRemote()
  if (remote) return remoteRuns.log(remote, runId).catch(() => '')
  if (source === 'cron') return readCronRunLog(runId)
  if (source === 'session') return readSessionRunLog(runId)
  if (source === 'bg') return readBgTaskLog(runId)
  // In-process agent run output lives in memory via listRuns(); look it up by id.
  return listRuns().find((r) => r.id === runId)?.output || ''
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
ipcMain.handle('schedules:reconcile', () => (curRemote() ? { ok: false, error: 'remote schedule reconcile needs the remote daemon runner' } : reconcileSchedules()))
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
ipcMain.handle('hitl:file', (_e, item: Omit<HitlItem, 'id' | 'status' | 'createdAt'>) => fileHitl(item))
ipcMain.handle('hitl:resolve', (_e, id: string, resolved?: boolean) => resolveHitl(id, resolved ?? true))
ipcMain.handle('hitl:remove', (_e, id: string) => removeHitl(id))
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
ipcMain.handle('data:mr-summary', async () => {
  const r = curRemote()
  if (r) {
    const res = await remoteMrs.list(r).catch((e) => ({ mrs: [], error: (e as Error).message }))
    const label = (await remoteProbe(r).catch(() => null))?.forgeLabel || 'PR'
    if ('error' in res && res.error) {
      return {
        ok: false,
        error: res.error,
        open: 0,
        approve: 0,
        changes: 0,
        needsReview: 0,
        label,
      }
    }
    const mrs = res.mrs
    const opened = mrs.filter((m) => m.state === 'opened')
    return {
      ok: true,
      open: opened.length,
      approve: 0,
      changes: 0,
      needsReview: opened.length,
      label,
    }
  }
  return mrSummary(repoRootOf(cur().cwd))
})
ipcMain.handle('data:meta', () => ({ ...cur(), claude: enginePath('claude') }))

// ---- command widgets (declarative, per-repo extensible) ----
ipcMain.handle('widgets:list', () => listCommandWidgets(cur().cwd))
ipcMain.handle('widgets:run', (_e, command: string) => runCommand(command, cur().cwd))

// ---- custom tabs (declarative full-screen views, per-repo extensible) ----
ipcMain.handle('tabs:list', (_e, cwd?: string) => listCustomTabs(cwd || cur().cwd))
ipcMain.handle('tabs:run', (_e, command: string, cwd?: string) => runTabCommand(command, cwd || cur().cwd))

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
  if (daemon.kind !== 'local') return { ok: false, provider: 'local', message: 'Ticket provider setup is local-only for now.' }
  return testRepoTicketProvider(daemon.repoRoot(), cfg, { smoke: !!smoke })
})
ipcMain.handle('tickets:linear-teams', (_e, cfg?: RepoTicketsConfig) => {
  const daemon = activeDaemon()
  if (daemon.kind !== 'local') return []
  return listLinearTeams(daemon.repoRoot(), cfg)
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
ipcMain.handle('tickets:recommend-agent', (_e, input: TicketAgentRecommendationInput) => recommendTicketAgent(input))
ipcMain.handle('tickets:spawn', (_e, text: string, engine: Engine, model?: string, requested?: unknown) => {
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
})
ipcMain.handle('tickets:update', async (_e, slug: string, patch: TicketPatch) => {
  const daemon = activeDaemon()
  const before = await daemon.ticketGet(slug)
  const ok = await daemon.ticketUpdate(slug, patch)
  if (ok && patch.status) {
    const t = await daemon.ticketGet(slug)
    const unblocked = before?.status === 'stuck' && patch.status !== 'stuck'
    emitActivity({
      kind: patch.status === 'closed' ? 'ticket-closed' : 'info',
      title: unblocked ? `Ticket unblocked · #${t?.id ?? slug}` : `Ticket ${patch.status} · #${t?.id ?? slug}`,
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
ipcMain.handle('ci:list', async (_e, limit?: number) => {
  return activeDaemon().ciList(limit)
})
ipcMain.handle('ci:jobs', async (_e, runId: string) => {
  return activeDaemon().ciJobs(runId)
})
ipcMain.handle('ci:log', async (_e, jobId: string) => {
  return activeDaemon().ciLog(jobId)
})
ipcMain.handle('open:external', (_e, url: string) => shell.openExternal(url))
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
  if (remote) return remoteProject.bootstrapStatus(remote).catch((e) => ({
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
    return remoteProject.bootstrap(remote, templateRepo).catch((e) => ({ error: (e as Error).message }))
  }
  if (!repoRoot) return { error: 'no repoRoot' }
  const src = projectTemplateSource('bootstrap.sh')
  if ('error' in src) return { error: src.error }
  const script = join(src.dir, 'bootstrap.sh')
  return new Promise<{ ok: true } | { error: string }>((resolve) => {
    const p = cpSpawn('bash', [script, repoRoot], { stdio: 'pipe' })
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('exit', (code) => {
      src.cleanup?.()
      if (code === 0) resolve({ ok: true })
      else resolve({ error: `bootstrap exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}` })
    })
    p.on('error', (e) => {
      src.cleanup?.()
      resolve({ error: e.message })
    })
  })
})

// ---- capability modules (Admin tab: seed / detect / query) ----
function resolveModuleRegistry(): { reg: ModuleRegistry; dir: string; cleanup?: () => void } | { error: string } {
  const src = projectTemplateSource('modules/modules.json')
  if ('error' in src) return { error: src.error }
  try {
    return { reg: loadRegistry(src.dir), dir: src.dir, cleanup: src.cleanup }
  } catch (e) {
    src.cleanup?.()
    return { error: `module registry unreadable: ${(e as Error).message}` }
  }
}

ipcMain.handle('modules:status', (_e, repoRoot: string) => {
  if (!repoRoot) return { error: 'no repoRoot' }
  const r = resolveModuleRegistry()
  if ('error' in r) return r
  try {
    const byId = new Map(moduleStatus(repoRoot, r.reg).map((s) => [s.id, s]))
    const modules = r.reg.modules.map((m) => ({ ...m, ...(byId.get(m.id) as object) }))
    let profile: string | undefined
    try {
      profile = JSON.parse(readFileSync(join(repoRoot, '.TerMinal', 'template.json'), 'utf-8')).profile
    } catch {
      /* no template.json */
    }
    return { modules, profiles: r.reg.profiles, profile }
  } finally {
    r.cleanup?.()
  }
})

ipcMain.handle('modules:seed', (_e, repoRoot: string, id: string) => {
  if (!repoRoot || !id) return { error: 'repoRoot + id required' }
  const r = resolveModuleRegistry()
  if ('error' in r) return r
  try {
    return seedModules(repoRoot, [id], r.reg, r.dir)
  } finally {
    r.cleanup?.()
  }
})

ipcMain.handle('modules:apply-profile', (_e, repoRoot: string, profile: ProfileId) => {
  if (!repoRoot || !profile) return { error: 'repoRoot + profile required' }
  const r = resolveModuleRegistry()
  if ('error' in r) return r
  try {
    return applyProfile(repoRoot, profile, r.reg, r.dir)
  } finally {
    r.cleanup?.()
  }
})

ipcMain.handle('modules:apply-selection', (_e, repoRoot: string, ids: string[], profile?: ProfileId) => {
  if (!repoRoot || !Array.isArray(ids)) return { error: 'repoRoot + ids required' }
  const r = resolveModuleRegistry()
  if ('error' in r) return r
  try {
    return seedModules(repoRoot, ids, r.reg, r.dir, profile)
  } finally {
    r.cleanup?.()
  }
})

ipcMain.handle('modules:query', (_e, repoRoot: string, source: DataSource) => {
  if (!repoRoot || !source) return { error: 'repoRoot + source required' }
  return runModuleQuery(repoRoot, source)
})

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
      error: 'bin/release not found — set GT_TERMINAL_REPO to your source checkout, or run from the repo directory',
    }
  }
  // Truncate the log so each rebuild starts fresh.
  try {
    writeFileSync(RELEASE_LOG, `▸ rebuild started ${new Date().toISOString()}\n▸ repo: ${repoRoot}\n`)
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
ipcMain.handle('bg:spawn', (_e, input: { repoRoot: string; prompt: string; engine?: Engine; model?: string }) => {
  const remote = curRemote()
  if (!remote) return spawnBgTask(input)
  const prompt = input.prompt?.trim()
  if (!prompt) return { error: 'empty prompt' }
  const engine = input.engine || remote.daemon?.defaultEngine || 'claude'
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
})
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
ipcMain.handle('llm:cheap', async (_e, opts: Parameters<typeof import('./cheap-llm').cheapCall>[0]) => {
  const { cheapCall } = await import('./cheap-llm')
  return cheapCall(opts)
})

// Classifier IPCs — exposed so scripts/dashboard can use them too.
ipcMain.handle('classify:ci', async (_e, rawLog: string) => {
  const { classifyCiFailure } = await import('./ci-failure-classifier')
  return classifyCiFailure(rawLog)
})
ipcMain.handle('classify:risk', async (_e, input: Parameters<typeof import('./pr-risk-classifier').classifyRisk>[0]) => {
  const { classifyRisk } = await import('./pr-risk-classifier')
  return classifyRisk(input)
})

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
  curRemote() ? { totalUsd: 0, totalRuns: 0, byModel: {}, bySource: {}, byAgent: {}, byRepo: {} } : summaryFor(range),
)
ipcMain.handle('observability:byAgent', (_e, range: Range = 'week') => (curRemote() ? [] : agentROI(range)))
ipcMain.handle('observability:daily', (_e, days: number = 7) => (curRemote() ? [] : dailySpend(days)))
ipcMain.handle('observability:runs', (_e, limit: number = 100) => (curRemote() ? [] : listAIRuns(limit)))
ipcMain.handle('observability:models', () => knownModels())
ipcMain.handle('observability:index-status', () => (curRemote() ? observabilityIndexStatus() : observabilityIndexStatus()))
ipcMain.handle('observability:index-rebuild', (_e, limit: number = 240) =>
  curRemote()
    ? { ...observabilityIndexStatus(), ok: false, error: 'Remote observability indexing is not wired yet.', durationMs: 0, indexedSessions: 0 }
    : rebuildObservabilityIndex(limit),
)
ipcMain.handle('observability:index-query', (_e, query: ObservabilityIndexQueryId, arg?: string) =>
  curRemote() ? { ...queryObservabilityIndex(query, arg), rows: [], error: 'Remote observability indexing is not wired yet.' } : queryObservabilityIndex(query, arg),
)
ipcMain.handle('agentview:snapshot', (_e, limit: number = 120) =>
  curRemote()
    ? {
        ts: Date.now(),
        sessions: [],
        totals: { sessions: 0, readySessions: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0 },
        byEngine: {},
        byRepo: {},
        topTools: [],
      }
    : readObservabilitySnapshot(limit),
)
ipcMain.handle('agentview:session', (_e, sessionId: string) => (curRemote() ? null : readObservabilitySessionDetail(sessionId)))
ipcMain.handle('agentview:tool-call', (_e, sessionId: string, callId: string) =>
  curRemote() ? null : readObservabilityToolCallPayload(sessionId, callId),
)
ipcMain.handle('agentview:transcript-window', (_e, sessionId: string, centerLine: number = 0, radius: number = 24) =>
  curRemote() ? null : readObservabilityTranscriptWindow(sessionId, centerLine, radius),
)
ipcMain.handle('agentview:upstream-status', () => agentViewUpstreamStatus())
ipcMain.handle('agentview:upstream-start', () => startAgentViewUpstream())
ipcMain.handle('agentview:upstream-stop', () => {
  stopAgentViewUpstream()
  return agentViewUpstreamStatus()
})

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
  const failed24h = cronRuns.filter((r) => r.status === 'failed' && r.startedAt >= Date.now() - 86_400_000).length
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
ipcMain.handle('open:in-browser', (_e, url: string) => openInApp(resolvedBrowserApp(), url, () => shell.openExternal(url)))
// "Open in editor" — the configured editor (default Cursor). Opens a path; defaults
// to the active session's repo root.
ipcMain.handle('open:in-editor', (_e, path?: string) => {
  const target = path || repoRootOf(cur().cwd) || cur().cwd || homedir()
  openInApp(resolvedEditorApp(), target, () => shell.openPath(target))
})
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:read', () => clipboard.readText())

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
  return folder ? readNoteFolderFile(folder.path, rel) : { ok: false, content: '', reason: 'note folder not found' }
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
ipcMain.handle('knowledge:rag-reindex', (_e, scope: KnowledgeScope, item: any, fullRebuild?: boolean) =>
  knowledgeRagReindex({ scope, repoRoot: activeDaemon().repoRoot(), item }, !!fullRebuild),
)
ipcMain.handle('knowledge:rag-add-document', (_e, scope: KnowledgeScope, item: any, content: string, filepath?: string) =>
  knowledgeRagAddDocument({ scope, repoRoot: activeDaemon().repoRoot(), item, content, filepath }),
)
ipcMain.handle('knowledge:rag-add-url', (_e, scope: KnowledgeScope, item: any, url: string, title?: string) =>
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
ipcMain.handle('workflow:write', (_e, rel: string, content: string) => writeWorkflowFile(rel, content))

// Safety net: never let a stray async error (e.g. a late PTY write) take down
// the whole app.
process.on('uncaughtException', (e) => console.error('[gt] uncaught:', e))

app.on('before-quit', () => {
  stopAgentViewUpstream()
})

app.whenReady().then(() => {
  fixPath() // packaged app has a minimal PATH — recover brew CLIs (glab/gh/…)
  createWindow()
  // App-side watchdog. Catches phantom cron runs (schedule deleted before
  // runner finalized, terminal closed mid-run, OOM) that the per-schedule
  // sweep in bin/terminal-cron can't reach when no schedules are firing.
  sweepStaleCronRuns()
  setInterval(sweepStaleCronRuns, 30 * 60 * 1000)
  // AI fleet observability — periodic transcript scans for cost/token rollups.
  startAICollectionLoop()
  // Background-task watcher (#0004) — reconciles bg-tasks.json state with
  // actual PIDs, sweeps completed tasks, fires Telegram pings on MR ready.
  startBgWatcher()
  // Loop watcher — reconciles in-flight role turns and advances the phase.
  startLoopWatcher()
  // Budget watcher — fires HITL pings at warnAt thresholds.
  startBudgetWatcher()
  // Local automation listener inbox — processes JSON files dropped into
  // ~/.config/TerMinal/automation-inbox/new while the app is running.
  startListenerInboxWatcher()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (watchTimer) clearInterval(watchTimer)
  if (activityTimer) clearInterval(activityTimer)
  if (telegramTimer) clearInterval(telegramTimer)
  for (const s of sessions.values()) s.pty.kill()
  sessions.clear()
  stopAgentViewUpstream()
  if (process.platform !== 'darwin') app.quit()
})
