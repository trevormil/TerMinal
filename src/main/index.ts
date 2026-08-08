import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  Menu,
  safeStorage,
  session,
} from 'electron'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
const tmPluginSrcDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'plugin') : join(moduleDir, '../../plugin')

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
  findSessionFile,
  readSessionTasks,
  lastAssistantTurn,
  readObservabilitySnapshot,
  readObservabilitySessionDetail,
  readObservabilityToolCallPayload,
  readObservabilityTranscriptWindow,
} from './data'
import { registerAgentInsightsIpc } from './ipc/agent-insights'
import { registerObservabilityIpc } from './ipc/observability'
import { registerSchedulesIpc } from './ipc/schedules'
import { registerAgentsIpc } from './ipc/agents'
import { registerFilesIpc } from './ipc/files'
import { createBridgeDeps } from './bridge-deps'
import {
  bindSessionSender,
  cur,
  curRemote,
  killAllSessionPtys,
  loopListenerDeps,
  remoteFromHostId,
  repoLabelFor,
  requestedRemote,
  sessions,
  activeSessionKey,
  setActiveSession,
  startSession,
  stopSession,
  watchSession,
  stopWatchSession,
  activeDaemon,
  daemonForRequest,
  type StartOpts,
} from './session-registry'
import { registerPersistentAgentsIpc } from './ipc/persistent-agents'
import { registerInboxIpc } from './ipc/inbox'
import { registerRepoTrustDenialIpc } from './ipc/repo-trust-denials'
import { registerSessionSearchIpc } from './ipc/session-search'
import { registerStacksIpc } from './ipc/stacks'
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
import { installStatuslineShim } from './statusline'
import { listCommandWidgets, runCommand, repoRoot as widgetRepoRoot } from './widgets'
import { listCustomTabs, runTabCommand } from './tabs'
import {
  approveRepo,
  commandSetHash,
  isRepoTrusted,
  readTrustStore,
  revokeRepo,
  writeTrustStore,
} from './repo-trust'
import { repoRootOf, repoForCwd } from './repo'
import { orderFleetSnapshotEntries, restoreFleetSnapshotEntryOrder } from './fleet-snapshot'
import { checkForUpdate } from './update-check'
import { recommendTicketAgent } from './backlog'
import type { NewTicket, TicketAgentRecommendationInput, TicketPatch } from './backlog'
import {
  listLinearTeams,
  type NewTicketComment,
  readRepoTicketConfig,
  resolveHumanAuthor,
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
import { listDisabled } from './agents-disabled'
import { scaffoldProject, type ScaffoldTicketProvider } from './scaffold'
import {
  readSettings,
  patchSettings,
  setSettingsSecretStorage,
  syncTelegramSidecar,
  syncSlackSidecar,
} from './settings'
import { testSlack } from './slack-mirror'
import {
  telegramControlEnabled,
  resolvedProjectsDir,
  resolvedWorktreesDir,
  resolvedEditorApp,
  resolvedBrowserApp,
  resolvedTemplateRepo,
  enginePath,
  resolveEngineModel,
  classifyProjectsDir,
  countGitReposOneLevel,
  pickDensestRoot,
  CANDIDATE_ROOT_NAMES,
  type Settings,
  type SettingsPatch,
} from './settings'
import {
  listMonitorsWithStatus,
  writeMonitors,
  validateMonitors,
  runMonitorProbe,
} from './monitors'
import { startMonitorLivenessWatch } from './monitor-liveness-runtime'
import { listCiRuns, listCiJobs, fetchCiLog } from './ci'
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
  DEFAULT_AGENTS,
  readAgentRunContexts,
  runTicketSpawn,
  runFactorySpawn,
  listRuns,
  readAgentRunLog,
  agentRunLogPath,
  onAgentEvent,
  loadPersistedRuns,
  type Agent,
  type Engine,
  killAllAgentRuns,
} from './agents'
import { readSchedules } from './schedules'
import { installTmPlugin, tmPluginStatus } from './plugin-install'
import { migrateRepoState, pendingMigration, sidecarGitStatus } from './repo-state-migrate'
import {
  legacyPluginCopies,
  legacySeedCandidates,
  sweepLegacyPluginCopies,
  sweepLegacySeeds,
} from './legacy-sweep'
import {
  installRunner,
  installCli,
  installMcpServer,
  installMonitorDaemon,
  syncMonitorDaemon,
  installOrTier,
  // mcp-register pulled separately below; not part of launchd helpers.
  reconcileSchedules,
} from './launchd'
import { reconcileHosts } from './schedule-router'
import { provisionHost } from './host-provision'
import { checkHostHealth } from './host-health'
import { registerMcpEverywhere } from './mcp-register'
import {
  flushAllSessionRunLogs,
  readCronRuns,
  getCronRun,
  readCronRunLog,
  cronRunLogPath,
  readSessionRunLog,
  sessionRunLogPath,
  listAllRuns,
  sweepStaleCronRuns,
  sweepStaleSessionRuns,
} from './cron-runs'
import { clearTerminalScratch, sweepTerminalState } from './run-retention'
import { bridgeStatus, startBridge, stopBridge } from './bridge/server'
import { bridgeHosts, ensureIdentity, pairingPayload, rotateToken } from './bridge/identity'
import { tailscaleSelf } from './bridge/tailscale'
import { apnsPaths, pushStatus } from './bridge/push'
import { listRemoteSessions } from './remote-sessions'
import { collectRemoteRuns, collectRemoteHitl } from './remote-runs'
import { listRepoArtifacts } from './run-artifacts'
import { isExternallyOpenableUrl, isObsidianDeepLink } from '../shared/url-safety'
import { experimentGate } from '../shared/experiments'
import { appCsp, isAppUrl, navigationDecision } from './window-guard'

// Only forward web/mail URLs to the OS. Non-http(s) schemes (file://, custom
// protocols) reaching shell.openExternal from rendered content is a known
// Electron footgun — see url-safety.ts.
const openExternalSafe = (url: unknown): void => {
  if (isExternallyOpenableUrl(url)) void shell.openExternal(url)
  else console.error('[gt] refused openExternal for non-web URL:', String(url).slice(0, 80))
}
import { startAICollectionLoop } from './ai-collectors'
import {
  processListenerInbox,
  readListenerStatus,
  setListenerEnabled,
  startListenerInboxWatcher,
} from './listeners'
import {
  spawnBgTask,
  listBgTasks,
  getBgTask,
  cancelBgTask,
  readBgTaskLog,
  bgTaskLogPath,
  startBgWatcher,
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
import { startLoopListener, noteLoopTurnComplete, noteSingleLoopTurn } from './loop-listener'
import {
  readHitl,
  fileHitl,
  resolveHitl,
  removeHitl,
  markHitlRead,
  markAllHitlRead,
  type HitlItem,
} from './hitl'
import { factoryHealth } from './factory-health'
import { composeSteps, pipelineLabel } from './pipelines'
import {
  remoteAgents,
  remoteDirs,
  remoteProbe,
  remoteProject,
  remoteRuns,
  remoteHitl,
  remoteSettings,
} from './remote'
import { listCursorModels } from './cursor-models'
import { readFileTail } from './fs-tail'
import {
  checkpointChangedRanges,
  createCheckpoint,
  fileAtCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  reviewBaseFor,
} from './checkpoints'
import { resolveWithinAny } from './path-guard'
import { maskSettingsSecrets, stripMaskedSecrets } from './settings-mask'
import { configPath, terminalConfigDir } from './config-dir'

setSettingsSecretStorage({
  canEncrypt: () => safeStorage.isEncryptionAvailable(),
  seal: (value) => safeStorage.encryptString(value).toString('base64'),
  open: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
})

// Mirror decrypted telegram creds to the 0600 sidecar on startup so out-of-process
// filers (cron/CLI/MCP) can deliver HITL pings even for already-configured users
// who won't re-save settings. Subsequent saves refresh it via patchSettings.
syncTelegramSidecar()
syncSlackSidecar()

let win: BrowserWindow | null = null

// Safe send: the PTY + watcher keep firing during window reload/close, and
// win.webContents may already be destroyed — sending then throws an uncaught
// "Object has been destroyed" that crashes the main process.
function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}
bindSessionSender(send)
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
    const focusedHere = key === activeSessionKey() && (win?.isFocused() ?? false)
    const label = s.pinned.name || basename(s.pinned.cwd) || 'session'
    const st = readTranscriptStats(sid)
    // Say WHAT the agent just did, not a generic "ready". The turn's closing
    // message is the most honest "what happened"; fall back to the session's AI
    // title or the last tool. Title carries a headline snippet so the
    // notification is legible without opening anything.
    const summary =
      t.summary || st.aiTitle || (st.lastAction ? `ran ${st.lastAction.tool}` : 'finished its turn')
    const headline = summary.length > 72 ? `${summary.slice(0, 71)}…` : summary
    // Snapshot the workspace at each turn boundary so the turn is undoable.
    // Best-effort and silent: a checkpoint failing must never disrupt a run.
    const root = repoRootOf(s.pinned.cwd)
    if (root) void createCheckpoint(root, `${label} — ${headline}`).catch(() => {})
    emitActivity(
      {
        kind: 'task-complete',
        title: `${label} — ${headline}`,
        detail: summary,
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

// One-shot latch for installBinariesAndReconcile.
let bootstrapped = false

// Once-per-launch: install the headless runner / CLI / MCP server / monitor
// daemon at their stable paths, register MCP with Claude Code + Codex, and
// reconcile launchd against schedules.json.
//
// `createWindow` is also called from the macOS `activate` handler (dock click
// with no window open), and all of this used to re-run on every re-activate:
// four binaries rewritten to disk, MCP re-registered in ~/.claude.json and
// ~/.codex/config.toml, plus a full SYNCHRONOUS launchd reconcile — a
// multi-second freeze on a gesture that should just show a window.
function installBinariesAndReconcile() {
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
  // Global tm plugin: skills/hooks land once at ~/.config/TerMinal/plugin and
  // load in every repo via the ~/.claude/skills/tm symlink (no per-repo copies).
  const tmInstall = installTmPlugin(tmPluginSrcDir())
  if (!tmInstall.ok) console.error('[tm-plugin] launch install failed:', tmInstall.error)
  // The Monitoring daemon: refresh the runner + load its single launchd job so
  // checks run on their own process even when the app is closed.
  const monitorSrc = app.isPackaged
    ? join(process.resourcesPath, 'terminal-monitor')
    : join(moduleDir, '../../bin/terminal-monitor')
  installMonitorDaemon(monitorSrc)
  syncMonitorDaemon()
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
}

/** The one document the app window is ever allowed to be: dev server or the
 *  packaged renderer bundle. Everything else is remote content. */
function appDocumentUrl(): string {
  return (
    process.env.ELECTRON_RENDERER_URL ||
    pathToFileURL(join(moduleDir, '../renderer/index.html')).href
  )
}

// Electron has no true headless mode. `show: false` is the closest equivalent:
// the window is created and the renderer runs and paints exactly as normal —
// so every assertion and every screenshot still works — it just never appears
// on screen or takes focus. Opt-IN via env, so production behaviour is
// unchanged; the UX suite sets it, and `HEADED=1` turns it back off for
// debugging. See docs/ux-testing.md.
const headless = () => process.env.TERMINAL_HEADLESS === '1'

function createWindow() {
  win = new BrowserWindow({
    show: !headless(),
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

  // ---- window hardening (see window-guard.ts for the decisions) ------------
  const appUrl = appDocumentUrl()
  // Nothing may navigate the app's own window away from the app document: a
  // top-level navigation (or a dropped .html file) would put attacker-authored
  // content in the origin that holds `window.gt` — including runCommand.
  // <webview> browsing is a separate WebContents and is NOT affected by these.
  const guardNavigation = (
    e: { preventDefault: () => void },
    url: string,
    isMainFrame: boolean,
  ) => {
    if (navigationDecision(url, appUrl, isMainFrame) === 'allow') return
    e.preventDefault()
    console.error('[gt] blocked in-app navigation to:', String(url).slice(0, 120))
  }
  win.webContents.on('will-navigate', (e, url) => guardNavigation(e, url, true))
  win.webContents.on('will-frame-navigate', (e) => guardNavigation(e, e.url, e.isMainFrame))
  // Stamp a CSP on the app document itself. `script-src 'self'` is the point:
  // no remotely-hosted script can be pulled into the privileged origin. The
  // Browser/CI/Tickets <webview>s run in the `persist:browser` partition, a
  // different session, so ordinary browsing is untouched.
  const csp = appCsp(!!process.env.ELECTRON_RENDERER_URL)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!isAppUrl(details.url, appUrl)) return cb({})
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // The macOS traffic lights are hidden in fullscreen, so the renderer should
  // drop its left reserve for them. Broadcast the fullscreen state.
  const sendFullscreen = () => send('window:fullscreen', win?.isFullScreen() ?? false)
  win.on('enter-full-screen', sendFullscreen)
  win.on('leave-full-screen', sendFullscreen)
  win.on('ready-to-show', () => {
    if (!headless()) win?.show()
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
  // `window-all-closed` clears watchTimer along with the others, but unlike
  // activityTimer/telegramTimer nothing below re-arms it — so after a dock
  // re-activate the transcript-tick fast path stayed dead until the user
  // happened to switch sessions. watchSession() is idempotent (it clears any
  // existing interval first).
  watchSession()
  startActivityTail() // surface externally-appended events (skills) live
  onAgentEvent((channel, payload) => send(channel, payload))
  onDigestEvent((channel, payload) => send(channel, payload))
  loadPersistedRuns() // restore past agent runs
  if (!activityTimer) activityTimer = setInterval(pollActivity, 1500)
  // A dead monitoring daemon cannot report itself dead (ticket 117), so the
  // liveness check has to run in a process that is definitely alive.
  startMonitorLivenessWatch()
  if (!bootstrapped) {
    bootstrapped = true
    installBinariesAndReconcile()
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
  // Rejection routed, not swallowed: this primes the Telegram getUpdates cursor,
  // and a silent failure leaves AFK control looking enabled while it quietly
  // receives nothing (ticket 100 — the point is a decision per promise, never a
  // blanket `void`).
  if (telegramControlEnabled())
    markTelegramControlEnabled(true, false).catch((e: unknown) =>
      console.error('[gt] telegram: restoring control cursor failed:', e),
    ) // restore cursor quietly
  if (!telegramTimer) telegramTimer = setInterval(pollTelegramOnce, 5000)

  // Deliberately the same value the navigation guard allowlists — loading via
  // a second, independently-derived path is how those two silently drift apart.
  void win.loadURL(appUrl)
}

// ---- session IPC ----
ipcMain.handle('sessions:list', (_e, engine?: Engine) => listSessions(engine))
ipcMain.handle('session:start', (_e, key: string, opts: StartOpts) => startSession(key, opts))
ipcMain.handle('session:setActive', (_e, key: string) => setActiveSession(key))
ipcMain.handle('session:stop', (_e, key: string) => stopSession(key))
// Fleet snapshot: a summary of every live session (for the cross-session
// overview + the live status dots on the session tabs).
function fleetSnapshot() {
  const entries = [...sessions]
  const out = []
  for (const [key, s] of orderFleetSnapshotEntries(entries, activeSessionKey())) {
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
  return restoreFleetSnapshotEntryOrder(out, entries)
}
ipcMain.handle('fleet:list', () => fleetSnapshot())

const bridgeDeps = createBridgeDeps({
  liveSessions: () =>
    [...sessions.values()].map((s) => ({
      sessionId: s.pinned.sessionId,
      cwd: s.pinned.cwd,
      write: (d: string) => s.pty.write(d),
    })),
  cliSrcPath: () => cliSrcPath(),
  remoteFromHostId,
  hasWindow: () => !!win,
  openSessionInRenderer: (payload) => {
    if (!win) return false
    win.webContents.send('remote:open-session', payload)
    return true
  },
})

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
ipcMain.handle('bridge:tailscale', async () => {
  const self = await tailscaleSelf()
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
// Count-only badge endpoints — the tab badges poll ~1/s while a terminal
// streams; shipping the full lists over IPC just to count them was ~1MB/s of
// renderer-side JSON deserialization.
ipcMain.handle('activity:unseen-count', (_e, since: number, kinds: string[]) => {
  const hi = new Set(kinds)
  return readActivity().filter((ev) => ev.ts > since && hi.has(ev.kind)).length
})
ipcMain.handle('activity:clear', () => clearActivity())
ipcMain.handle('env:detect', () => detectEnv())
ipcMain.handle('env:install-gt-notify', () => installGtNotify())
ipcMain.handle('telegram:test', () => testTelegram())
ipcMain.handle('slack:test', () => testSlack())
// One "send test alert" entry point per outbound channel (Settings → Alerts).
// `webhookId` picks one destination out of the list; the renderer only holds a
// mask of the URL, so it names the entry instead of sending the value back.
ipcMain.handle(
  'alerts:test',
  (_e, channel: 'telegram' | 'desktop' | 'webhook', webhookId?: string) => {
    if (channel === 'telegram') return testTelegram()
    if (channel === 'desktop') return testDesktopAlert()
    if (channel === 'webhook') {
      const hook = readSettings().alerts.webhooks.find((w) => w.id === webhookId)
      if (!hook) return { ok: false, error: 'Save the webhook before testing it.' }
      return testWebhook(hook.url)
    }
    return { ok: false, error: `unknown alert channel: ${channel}` }
  },
)
// Secrets are sealed on disk; handing the renderer the decrypted values on
// every read undoes that. It gets masks plus a `secretsSet` map instead — see
// settings-mask.ts. Writes still work: only an actual edit is saved.
ipcMain.handle('settings:get', () => maskSettingsSecrets(readSettings()))
ipcMain.handle('settings:storage-report', () => sweepTerminalState(undefined, { dryRun: true }))
ipcMain.handle('settings:storage-reclaim', async () => {
  const report = await sweepTerminalState(undefined, { dryRun: false })
  emitActivity(
    {
      kind: 'info',
      title: 'Storage reclaim completed',
      detail: `${report.reclaimedBytes} bytes reclaimed`,
    },
    { notify: false },
  )
  return report
})
ipcMain.handle('settings:scratch-clear', () => clearTerminalScratch())
ipcMain.handle('settings:patch', (_e, patch: SettingsPatch) => {
  const before = readSettings()
  // The renderer now holds masks where secrets used to be. If one is echoed back
  // (a form that re-submits every field, say), persisting it would overwrite a
  // real credential with '••••••••'. Strip those before patching.
  //
  // patchSettings THROWS on a corrupt settings.json (it quarantines the file
  // rather than overwriting real config with defaults). Surface that in the
  // Activity feed and hand back the unchanged settings — an uncaught throw here
  // is an unhandled rejection in the renderer and the user sees nothing at all.
  let next: Settings
  try {
    next = patchSettings(stripMaskedSecrets(patch))
  } catch (e) {
    emitActivity({
      kind: 'blocked',
      title: 'Settings not saved',
      detail: e instanceof Error ? e.message : String(e),
    })
    // Masked for the same reason settings:get is — the renderer must never
    // receive a real credential back, least of all on the failure path.
    return maskSettingsSecrets(before)
  }
  // react when the AFK-control toggle actually flips
  if (next.telegram.control !== before.telegram.control) {
    markTelegramControlEnabled(next.telegram.control).catch((e: unknown) =>
      console.error('[gt] telegram: applying control toggle failed:', e),
    )
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
  // Mask on the way back out too. The renderer feeds this straight into its
  // settings state, so returning raw `next` would both leak cleartext secrets
  // and drop `secretsSet` — making all five secret fields render "not set".
  return maskSettingsSecrets(next)
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

registerAgentsIpc({
  cur: () => cur(),
  curRemote: () => curRemote(),
  requestedRemote,
  remoteAgentCatalog,
  remoteSteps,
  localOnlyToRemote,
  remoteEngineModel,
  repoLabelFor,
})

registerPersistentAgentsIpc({ activeRepoRoot: () => repoRootOf(cur().cwd) })

// Schedules are backed by real launchd jobs; every mutation syncs launchd in
// lockstep, and `enriched` annotates each with its human cadence + next fire.
registerSchedulesIpc({
  cur: () => cur(),
  curRemote: () => curRemote(),
  repoLabelFor,
  remoteAgentCatalog,
  remoteFromHostId,
})

// Local runs only — always fast, safe to poll. Remote runs come from the
// separate `runs:remote-all` fan-out so the Runs tab can show BOTH in one view
// without switching the session's daemon profile.
ipcMain.handle('runs:all', () => listAllRuns())
ipcMain.handle(
  'runs:running-count',
  () => listAllRuns().filter((r) => r.source !== 'session' && r.status === 'running').length,
)
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
// Bounded log fetch for the live run pane: only the last `maxBytes` of the log
// are read and shipped over IPC. The pane polls every 1.5s while a run streams
// — full-file reads of multi-MB agent logs froze both processes. runs:log stays
// the full-fidelity path (export buttons, "load full log").
ipcMain.handle(
  'runs:log-tail',
  async (
    _e,
    source: 'cron' | 'agent' | 'bg' | 'session',
    runId: string,
    hostId?: string,
    maxBytes = 512 * 1024,
  ) => {
    const tail = (path: string) => {
      try {
        const { text, size } = readFileTail(path, maxBytes)
        return { text, size, truncated: size > maxBytes }
      } catch {
        return { text: '', size: 0, truncated: false }
      }
    }
    const remote = hostId ? remoteFromHostId(hostId) : curRemote()
    if (remote) {
      const text = await remoteRuns.log(remote, runId).catch(() => '')
      return { text: text.slice(-maxBytes), size: text.length, truncated: text.length > maxBytes }
    }
    if (source === 'cron') return tail(cronRunLogPath(runId))
    if (source === 'session') return tail(sessionRunLogPath(runId))
    if (source === 'bg') return tail(bgTaskLogPath(runId))
    const mem = listRuns().find((r) => r.id === runId)?.output
    if (mem != null && mem !== '')
      return { text: mem.slice(-maxBytes), size: mem.length, truncated: mem.length > maxBytes }
    return tail(agentRunLogPath(runId))
  },
)
// Artifacts a run produced — agent-request reports under the repo's
// .TerMinal/agent-requests/ (#8). Local runs only; a remote run's artifacts live
// on its host. The renderer opens a report via openExternal(file://…).
ipcMain.handle('runs:artifacts', (_e, repoRoot: string) => listRepoArtifacts(repoRoot))
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
  const rec = getCronRun(id)
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
// Which sessions are currently mirrored to the phone (registered + not ended),
// so the desktop can show a live "on phone" indicator for the active session.
// agentSessionId is the engine session id — the same value as the desktop's
// info.sessionId — with cwd as a fallback correlation.
ipcMain.handle('remote:active', () =>
  listRemoteSessions()
    .filter((s) => s.status !== 'ended')
    .map((s) => ({
      id: s.id,
      title: s.title,
      agentSessionId: s.agentSessionId,
      cwd: s.cwd,
      status: s.status,
    })),
)
ipcMain.handle('hitl:list', () => readHitl())
// Monitoring: read-only list for the tab; writes go through monitors.json (the
// tab edits it directly via these handlers), and a check triggers the daemon.
ipcMain.handle('monitors:list', () => listMonitorsWithStatus())
ipcMain.handle('monitors:save', (_e, list: unknown) => {
  // monitors.json is executed by bin/terminal-monitor on a launchd timer, so
  // the write path validates rather than trusting the renderer's JSON.
  if (!Array.isArray(list)) return { ok: false, saved: 0, rejected: 0, error: 'expected an array' }
  const { monitors, rejected } = validateMonitors(list)
  if (rejected) console.error(`[gt] monitors:save dropped ${rejected} invalid monitor(s)`)
  try {
    writeMonitors(monitors)
    syncMonitorDaemon()
  } catch (e) {
    // Was `return true` unconditionally — a failed write reported success and
    // the user's edit silently vanished on the next read.
    return { ok: false, saved: 0, rejected, error: (e as Error).message }
  }
  return { ok: true, saved: monitors.length, rejected }
})
// Native CI: forge-agnostic run/job/log views for the repo (gh run / glab api).
// repoRoot comes from the tab's context. The webview view is the default; this
// backs the "Runs" toggle.
ipcMain.handle('ci:list', (_e, repoRoot: string, limit?: number) =>
  listCiRuns(repoRoot, limit ?? 40),
)
ipcMain.handle('ci:jobs', (_e, repoRoot: string, runId: string) => listCiJobs(repoRoot, runId))
ipcMain.handle('ci:log', (_e, repoRoot: string, jobId: string) => fetchCiLog(repoRoot, jobId))
// Async execFile, NOT execFileSync: this ran a 40-second-timeout probe inside an
// IPC handler, so one "Run check" click on a hung endpoint froze the entire main
// process — every window, every session, every timer — for up to 40s. The worst
// remaining blocker in the app.
ipcMain.handle('monitors:run', async (_e, id: string) => {
  await runMonitorProbe(id) // never rejects; failures surface via the state file
  return listMonitorsWithStatus()
})
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
// Mark-read routes to the owning host like resolve/remove (#14) — a remote
// item's readAt must persist where the item lives, or the 15s remote fan-in
// flips it back to unread. No hostId → local, as before.
ipcMain.handle('hitl:mark-read', (_e, ids: string[], hostId?: string, read = true) => {
  if (hostId) {
    const ref = remoteFromHostId(hostId)
    if (ref) return remoteHitl.markRead(ref, ids, read).catch(() => 0)
  }
  return markHitlRead(ids, read)
})
ipcMain.handle('hitl:mark-all-read', () => markAllHitlRead())
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

// ---- command widgets + custom tabs (declarative, per-repo extensible) ------
//
// Two trust rules live here, both of which used to be enforced only by renderer
// convention:
//
//  1. The renderer never supplies a COMMAND, only an opaque widget/tab id. Main
//     resolves it against the widget set for the session's own cwd, so the
//     "run an arbitrary shell string" sink no longer exists on the IPC surface.
//  2. REPO-sourced entries (.TerMinal/widgets.json, .TerMinal/tabs.json) are
//     inert until the user approves that repo for that exact command set — see
//     repo-trust.ts. GLOBAL entries (~/.config/TerMinal) are the user's own
//     files and behave exactly as before.
function repoTrustContext(cwd: string) {
  // Global kill switch ABOVE the per-repo trust flow: with repo extensions
  // disabled (the default), repo-sourced widgets/tabs are never listed, never
  // runnable, and never even prompt for approval — the surface doesn't exist.
  // Global entries (~/.config/TerMinal) are the user's own files and unaffected.
  const allowRepo = readSettings().allowRepoExtensions
  const widgets = listCommandWidgets(cwd).filter((w) => allowRepo || w.source !== 'repo')
  const tabs = listCustomTabs(cwd).filter((t) => allowRepo || t.source !== 'repo')
  const root = cwd ? widgetRepoRoot(cwd) : ''
  const commands = [
    ...widgets.filter((w) => w.source === 'repo').map((w) => `widget: ${w.command}`),
    ...tabs
      .filter((t) => t.source === 'repo')
      .map((t) => (t.command ? `tab: ${t.command}` : `tab url: ${t.url}`)),
  ]
  const hash = commandSetHash(commands)
  return {
    repoRoot: root,
    hash,
    commands,
    widgets,
    tabs,
    trusted: isRepoTrusted(readTrustStore(), root, hash),
  }
}
/** Global entries are always live; repo entries only once the repo is approved. */
const entryTrusted = (source: 'global' | 'repo', repoTrusted: boolean) =>
  source === 'global' || repoTrusted

ipcMain.handle('widgets:list', () => {
  const ctx = repoTrustContext(cur().cwd)
  return ctx.widgets.map((w) => ({ ...w, trusted: entryTrusted(w.source, ctx.trusted) }))
})
ipcMain.handle('widgets:run', (_e, id: string) => {
  const cwd = cur().cwd
  const ctx = repoTrustContext(cwd)
  const w = ctx.widgets.find((x) => x.id === id)
  if (!w) return { ok: false, stdout: 'unknown widget', code: 127 }
  if (!entryTrusted(w.source, ctx.trusted))
    return { ok: false, stdout: 'repo not trusted — approve it in the Plugins drawer', code: 126 }
  return runCommand(w.command, cwd)
})

// A renderer-supplied cwd is a REQUEST, never an authority: it is only honoured
// when it belongs to a session the user actually has open. Otherwise a
// compromised renderer could name any directory on disk — approve it, then run
// its widgets — which would defeat the trust gate entirely.
const openSessionCwd = (cwd?: string): string => {
  if (!cwd) return cur().cwd
  for (const s of sessions.values()) if (s.pinned.cwd === cwd) return cwd
  console.error('[gt] refused a cwd that is not an open session:', String(cwd).slice(0, 120))
  return cur().cwd
}

ipcMain.handle('tabs:list', (_e, cwd?: string) => {
  const ctx = repoTrustContext(openSessionCwd(cwd))
  return ctx.tabs.map((t) => ({ ...t, trusted: entryTrusted(t.source, ctx.trusted) }))
})
ipcMain.handle('tabs:run', (_e, id: string, cwd?: string) => {
  const dir = openSessionCwd(cwd)
  const ctx = repoTrustContext(dir)
  const t = ctx.tabs.find((x) => x.id === id)
  if (!t?.command) return { ok: false, html: 'unknown tab', code: 127 }
  if (!entryTrusted(t.source, ctx.trusted))
    return { ok: false, html: 'repo not trusted — approve it in the Plugins drawer', code: 126 }
  return runTabCommand(t.command, dir)
})

// The approval surface: the literal commands the repo wants to run, so the user
// approves what they can actually read.
ipcMain.handle('repoTrust:status', () => {
  const ctx = repoTrustContext(cur().cwd)
  return { repoRoot: ctx.repoRoot, hash: ctx.hash, trusted: ctx.trusted, commands: ctx.commands }
})
// Deliberately takes NO cwd. Granting trust is the one operation the renderer
// must not be able to point anywhere: `approve('/attacker/repo')` followed by
// `tabs:run(id, '/attacker/repo')` would walk straight around the gate. The
// approval always applies to the session the user is actually looking at.
ipcMain.handle('repoTrust:approve', () => {
  const ctx = repoTrustContext(cur().cwd)
  if (!ctx.repoRoot || !ctx.commands.length) return false
  writeTrustStore(approveRepo(readTrustStore(), ctx.repoRoot, ctx.hash))
  emitActivity({
    kind: 'check',
    title: `Trusted repo widgets · ${basename(ctx.repoRoot)}`,
    detail: `${ctx.commands.length} repo-defined command${ctx.commands.length > 1 ? 's' : ''} approved`,
  })
  return true
})
ipcMain.handle('repoTrust:revoke', () => {
  const ctx = repoTrustContext(cur().cwd)
  if (!ctx.repoRoot) return false
  writeTrustStore(revokeRepo(readTrustStore(), ctx.repoRoot))
  return true
})

// ---- scratch workspace (throwaway, repo-less sessions) ----
// One app-owned dir under the existing TerMinal config root — persistent
// (unlike /tmp), out of the way (unlike ~), and not a git repo so repo-scoped
// tabs/widgets stay off. All scratch sessions share it → one "scratch"
// workspace grouping.
ipcMain.handle('scratch:dir', () => {
  const dir = configPath('scratch')
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
  // Deep links are minted from repo-controlled config (vault name + subdir), so
  // validate the result is still an obsidian://open link before handing it to
  // the OS — a custom-scheme sink is the whole reason url-safety.ts exists.
  if (!isObsidianDeepLink(link)) {
    console.error('[gt] refused non-obsidian deep link:', String(link).slice(0, 80))
    return false
  }
  void shell.openExternal(link)
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
    const prompt = `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id, write $TERMINAL_BACKLOG_DIR/NNNN-slug.md with valid YAML frontmatter matching the repo's examples (legacy v1 repos may use backlog/), put detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
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
ipcMain.handle(
  'tickets:comment',
  async (_e, slug: string, input: Partial<NewTicketComment> & { body: string }) => {
    const daemon = activeDaemon()
    // The UI never asks who you are — a human comment is signed with the repo's
    // git identity so the log matches the commits and PRs beside it.
    const kind = input.kind === 'agent' ? 'agent' : 'human'
    const comment: NewTicketComment = {
      ...input,
      kind,
      author:
        input.author?.trim() ||
        (kind === 'agent'
          ? 'agent'
          : await resolveHumanAuthor(daemon.kind === 'local' ? daemon.repoRoot() : process.cwd())),
    }
    const ok = await daemon.ticketComment(slug, comment)
    if (!ok) return false
    const t = await daemon.ticketGet(slug)
    emitActivity({
      kind: 'info',
      title: `Ticket comment · #${t?.id ?? slug}`,
      detail: `${comment.author}: ${comment.body.trim().slice(0, 120)}`,
      repo: daemon.repoLabel(),
      repoRoot: daemon.kind === 'local' ? daemon.repoRoot() : '',
      sessionId: cur().sessionId,
      ref: t?.id ? { ticket: t.id } : undefined,
    })
    return true
  },
)
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
ipcMain.handle('git:file-at-head', (_e, rel: string) => {
  return activeDaemon().fileAtHead(rel)
})
ipcMain.handle('git:file-at-head-binary', (_e, rel: string) => {
  return activeDaemon().fileAtHeadBinary(rel)
})
ipcMain.handle('git:status-porcelain', () => {
  return activeDaemon().statusPorcelain()
})
// Git views for the Files tab (history / branches / stashes / tags).
ipcMain.handle('git:log', (_e, opts?: { limit?: number; skip?: number; ref?: string }) => {
  return activeDaemon().gitLog(opts)
})
ipcMain.handle('git:show', (_e, ref: string) => {
  return activeDaemon().gitShow(ref)
})
ipcMain.handle('git:branches', () => {
  return activeDaemon().gitBranches()
})
ipcMain.handle('git:checkout', (_e, branch: string) => {
  return activeDaemon().gitCheckout(branch)
})
ipcMain.handle('git:create-branch', (_e, name: string, from?: string) => {
  return activeDaemon().gitCreateBranch(name, from)
})
ipcMain.handle('git:stashes', () => {
  return activeDaemon().gitStashes()
})
ipcMain.handle('git:tags', () => {
  return activeDaemon().gitTags()
})
ipcMain.handle('git:working-file-patch', (_e, rel: string) => {
  return activeDaemon().gitWorkingFilePatch(rel)
})
ipcMain.handle('git:compare-files-patch', (_e, a: string, b: string) => {
  return activeDaemon().gitCompareFilesPatch(a, b)
})
ipcMain.handle('checkpoints:list', () => listCheckpoints(activeDaemon().repoRoot()))
ipcMain.handle('checkpoints:create', (_e, label: string) =>
  createCheckpoint(activeDaemon().repoRoot(), label || 'manual checkpoint'),
)
ipcMain.handle('checkpoints:restore', (_e, sha: string) =>
  restoreCheckpoint(activeDaemon().repoRoot(), sha),
)
ipcMain.handle('checkpoints:file', (_e, sha: string, rel: string) =>
  fileAtCheckpoint(activeDaemon().repoRoot(), sha, rel),
)
ipcMain.handle('checkpoints:ranges', (_e, sha: string) =>
  checkpointChangedRanges(activeDaemon().repoRoot(), sha),
)
ipcMain.handle('checkpoints:review-base', (_e, rel: string, buffer: string) =>
  reviewBaseFor(activeDaemon().repoRoot(), rel, buffer),
)
ipcMain.handle('git:working-structural-diff', (_e, path: string, width?: number) => {
  return activeDaemon().workingStructuralDiff(path, width)
})
ipcMain.handle('mrs:structural-diff', (_e, iid: number, path: string, width?: number) => {
  return activeDaemon().mrStructuralDiff(iid, path, width)
})
ipcMain.handle('difft:available', () => difftOnPath())
// Cursor's live model catalog (incl. the `auto` entry point for Cursor
// Router). Empty when the CLI is missing or not logged in — the renderer then
// keeps the static catalog.
ipcMain.handle('cursor:models', () => listCursorModels())
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
ipcMain.handle('open:config-dir', () => shell.openPath(terminalConfigDir()))

// Install the MCP server entry into ~/.claude/mcp.json (and ~/.codex's
// equivalent if it exists). Read-only, stdio transport. Idempotent —
// re-running just updates the binary path.
ipcMain.handle('mcp:install', () => {
  const binPath = configPath('bin', 'terminal-mcp-server')
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
      } catch (e) {
        // Was `cfg = {}`, which then overwrote the file — DESTROYING every other
        // tool's MCP registration — and still reported {ok: true}. A registry we
        // cannot parse is a registry we must not rewrite.
        return {
          error:
            `${claudeMcp} is not valid JSON (${(e as Error).message}). ` +
            `Refusing to overwrite it — fix or move the file, then install again.`,
        }
      }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
        return {
          error: `${claudeMcp} is not a JSON object. Refusing to overwrite it.`,
        }
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
// "Bootstrapped" === the project-template repo data + Codex mirror are present
// (BOOTSTRAP_MARKERS in bootstrap.ts; Claude skills come from the global tm
// plugin, not the repo). Used by the in-session banner.
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
// Run project-template/bootstrap.sh against a repo. The script is idempotent:
// keeps repo data, writes `<name>.workflow` sidecars on conflict, and moves
// legacy per-repo Claude machinery to .claude/pre-tm-backup/ (the tm plugin
// serves it now). Streams nothing — we just wait and return ok/error.
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

// Global tm plugin status/sync for the Settings panel. Sync re-copies the
// bundled plugin and repairs the ~/.claude/skills/tm symlink.
ipcMain.handle('plugin:status', () => tmPluginStatus())

// Per-project sidecar: where this repo's tickets/reviews/sessions live, how
// many files are still sitting in the repo, and the one-time move.
ipcMain.handle('repoState:status', (_e, repoRoot: string) => {
  const root = repoRoot || cur().cwd
  const pluginDir = join(terminalConfigDir(), 'plugin')
  return {
    ...sidecarGitStatus(root),
    pending: pendingMigration(root),
    legacyCopies:
      legacyPluginCopies(root, pluginDir).length + legacySeedCandidates(root, pluginDir).length,
  }
})
// One-time cleanup: state files → sidecar, plus everything older bootstraps
// seeded per-repo that is global now — plugin-served skill/bin/hook copies,
// the Codex stop hook, seed artifacts, the layout marker, the forge selector
// (preserved into the sidecar), and unmodified default script agents. All
// banked in .claude/pre-tm-backup, never deleted.
ipcMain.handle('repoState:migrate', (_e, repoRoot: string) => {
  const root = repoRoot || cur().cwd
  const pluginDir = join(terminalConfigDir(), 'plugin')
  const r = migrateRepoState(root)
  const swept = r.error
    ? 0
    : sweepLegacyPluginCopies(root, pluginDir).moved + sweepLegacySeeds(root, pluginDir).moved
  return { ...r, sweptCopies: swept }
})
ipcMain.handle('plugin:sync', () => installTmPlugin(tmPluginSrcDir()))

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
const RELEASE_LOG = (): string => configPath('release.log')
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
      RELEASE_LOG(),
      `▸ rebuild started ${new Date().toISOString()}\n▸ repo: ${repoRoot}\n`,
    )
  } catch {
    /* best-effort */
  }
  const out = openSync(RELEASE_LOG(), 'a')
  const child = cpSpawn('bin/release', [], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', out, out],
    // TERMINAL_SELF_UPDATE arms bin/release's provenance gate (F-14). This is
    // the ONE path where the operator clicks a button and trusts whatever comes
    // out, so the build must come from a commit that is actually published —
    // not from a dirty tree or a local-only commit that something else wrote.
    // Signing raises the stakes rather than lowering them: an ad-hoc build
    // announced itself with a Gatekeeper warning, a Developer ID build will not.
    env: { ...process.env, TERMINAL_SELF_UPDATE: '1' },
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
  return { ok: true, pid: releasePid, log: RELEASE_LOG(), repoRoot }
})
ipcMain.handle('release:tail', () => {
  try {
    return readFileSync(RELEASE_LOG(), 'utf8')
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
// Behind the `loops` experiment. Only CREATION is gated: it is the one handler
// that starts work (cuts a worktree, spawns agents). list/get/state are reads
// and stop only ever winds a loop down, so gating them would strand a loop
// created while the flag was on with no way to see or stop it after a flip off.
ipcMain.handle('loops:list', () => (curRemote() ? [] : listLoops()))
ipcMain.handle('loops:get', (_e, id: string) => (curRemote() ? null : getLoop(id) || null))
ipcMain.handle('loops:state', (_e, id: string) => (curRemote() ? null : readLoopState(id)))
ipcMain.handle('loops:create', (_e, input: CreateLoopInput) => {
  if (curRemote()) return { error: 'remote' }
  const gate = experimentGate(readSettings(), 'loops')
  if (gate) return gate
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

// AI fleet observability IPCs. Pull from the per-run AI ledger.
registerObservabilityIpc({ isRemote: () => !!curRemote() })

// Inbox snooze + alert delivery log. Same reason: the renderer already invokes
// these channels, so leaving them unregistered is an unhandled-invoke rejection.
registerInboxIpc()
// GitHub native stacked PRs. Reads only; degrades to no stacks everywhere the
// preview has not rolled out.
registerStacksIpc()
// Agent scorecards, the disabled roster with WHY/WHEN, and manual memory
// compaction. Unregistered, the Agents tab's reliability column is empty and
// a circuit-broken agent can never be re-enabled from the UI.
registerAgentInsightsIpc()
// Repo-widget trust denials. Unregistered, "don't trust this repo" is silently
// forgotten and the prompt re-appears on every session switch.
registerRepoTrustDenialIpc(ipcMain)
// Full-text transcript search for the Sessions tab. `thisRepoOnly` scopes to
// whichever repo is currently active, the same accessor the rest of the
// repo-scoped handlers use.
registerSessionSearchIpc({ cwd: () => activeDaemon().repoRoot() })
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
  const cfgDir = terminalConfigDir()
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
// `open -a <App> <target>` hands the OS an arbitrary string, so this sink needs
// the same scheme gate as shell.openExternal (url-safety.ts) — otherwise it is
// simply a second, unguarded way to reach an OS protocol handler.
ipcMain.handle('open:in-browser', (_e, url: string) => {
  if (!isExternallyOpenableUrl(url)) return openExternalSafe(url)
  openInApp(resolvedBrowserApp(), url, () => openExternalSafe(url))
})
// "Open in editor" — the configured editor (default Cursor). Opens a path; defaults
// to the active session's repo root. Renderer-supplied paths are constrained to
// the roots the UI legitimately surfaces (workspace, worktrees, the active repo,
// TerMinal's config dir, configured note folders) so this can't be turned into
// an arbitrary "open any file on disk in an app" primitive.
function editorOpenRoots(): (string | undefined)[] {
  const s = readSettings()
  return [
    resolvedProjectsDir(),
    resolvedWorktreesDir(),
    repoRootOf(cur().cwd) || cur().cwd,
    activeDaemon().filesRoot(),
    terminalConfigDir(),
    ...s.noteFolders.map((f) => f.path),
  ]
}
ipcMain.handle('open:in-editor', (_e, path?: string) => {
  const fallbackTarget = repoRootOf(cur().cwd) || cur().cwd || homedir()
  const target = path ? resolveWithinAny(editorOpenRoots(), path) : fallbackTarget
  if (!target) {
    console.error('[gt] refused open:in-editor outside allowed roots:', String(path).slice(0, 120))
    return
  }
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

registerFilesIpc({ activeDaemon })

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
//
// app.setName + package.json's productName both matter here: role: 'appMenu'
// fills in "About/Hide/Quit ${app.name}", and Electron's app.name falls back
// to package.json's lowercase "name" ("terminal") unless productName is set
// or setName is called — hence the previously-lowercase "About terminal".
declare const __BUILD_BRANCH__: string
declare const __BUILD_TIME__: string
declare const __APP_VERSION__: string
function installAppMenu() {
  app.setName('TerMinal')
  app.setAboutPanelOptions({
    applicationName: 'TerMinal',
    applicationVersion: __APP_VERSION__,
    version: `${__BUILD_SHA__} on ${__BUILD_BRANCH__} · built ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')}`,
    copyright: 'MIT License',
    website: 'https://github.com/trevormil/TerMinal',
  })
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

// A throw anywhere in startup used to become an unhandled rejection: the window
// might exist, the menu might not, and nothing said so. Surfacing it is the
// difference between a bug report and "it just didn't open".
app
  .whenReady()
  .then(() => {
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
    // Local automation listener inbox — processes JSON files dropped into
    // ~/.config/TerMinal/automation-inbox/new while the app is running.
    startListenerInboxWatcher()
    // Mobile bridge — binds a port ONLY when the setting is on.
    void applyBridgeSetting()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((e: unknown) => {
    console.error('[gt] startup failed:', e)
  })

// QUIT kills everything. This is the only handler Electron guarantees on
// `app.quit()` — `window-all-closed` does NOT fire for it, so before this the
// engines simply outlived the app: shells, `claude`/`codex` children and
// detached `codex exec` runs kept going, burning tokens invisibly and still
// committing and pushing.
app.on('will-quit', () => {
  flushAllSessionRunLogs()
  const killed = killAllAgentRuns()
  if (killed) console.error(`[gt] quit: killed ${killed} in-flight agent run(s)`)
  killAllSessionPtys()
  void stopBridge() // never leave the port bound after the app goes away
})

// CLOSE (macOS red button) does NOT kill sessions. The app stays resident and
// re-activating from the dock brings the window back, so tearing down live
// agent terminals here was destroying work on a window-management gesture. The
// polling timers do stop — nothing is watching. On non-macOS, closing the last
// window IS quitting, so app.quit() runs will-quit and the sessions die there.
app.on('window-all-closed', () => {
  stopWatchSession()
  if (activityTimer) clearInterval(activityTimer)
  if (telegramTimer) clearInterval(telegramTimer)
  activityTimer = null
  telegramTimer = null
  if (process.platform !== 'darwin') app.quit()
})
