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
import { registerGitIpc } from './ipc/git'
import { registerCheckpointsIpc } from './ipc/checkpoints'
import { registerMrsIpc } from './ipc/mrs'
import { registerDocsIpc } from './ipc/docs'
import { registerTicketsIpc } from './ipc/tickets'
import { registerActivityIpc } from './ipc/activity'
import { registerSettingsIpc } from './ipc/settings'
import { registerRunsIpc } from './ipc/runs'
import { registerHostsIpc } from './ipc/hosts'
import { registerHitlIpc } from './ipc/hitl'
import { registerMonitorsIpc } from './ipc/monitors'
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
import { fixPath } from './env'
import { emitActivity, onActivity, startActivityTail } from './events'
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
import { onDigestEvent } from './digest-run'
import { type NotesScope } from './notes'
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
import { hiddenPresetIds } from './presets'
import { listWorkflowFiles, readWorkflowFile, writeWorkflowFile } from './workflow-files'
import { listDisabled } from './agents-disabled'
import { scaffoldProject, type ScaffoldTicketProvider } from './scaffold'
import {
  readSettings,
  setSettingsSecretStorage,
  syncTelegramSidecar,
  syncSlackSidecar,
} from './settings'
import {
  telegramControlEnabled,
  resolvedProjectsDir,
  resolvedWorktreesDir,
  resolvedEditorApp,
  resolvedBrowserApp,
  resolvedTemplateRepo,
  enginePath,
  resolveEngineModel,
} from './settings'
import { startMonitorLivenessWatch } from './monitor-liveness-runtime'
import { classifyBootstrapStatus } from './bootstrap'
import { bakedTemplateSha, resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'
import {
  cloneTemplateToTmp,
  pickTemplateSource,
  templateCandidates,
  type TemplateSource,
} from './template'
import { configureTelegramControl, markTelegramControlEnabled, pollTelegramOnce } from './telegram'
import {
  DEFAULT_AGENTS,
  readAgentRunContexts,
  listRuns,
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
import { registerMcpEverywhere } from './mcp-register'
import {
  flushAllSessionRunLogs,
  readCronRuns,
  sweepStaleCronRuns,
  sweepStaleSessionRuns,
} from './cron-runs'
import { bridgeStatus, startBridge, stopBridge } from './bridge/server'
import { bridgeHosts, ensureIdentity, pairingPayload, rotateToken } from './bridge/identity'
import { tailscaleSelf } from './bridge/tailscale'
import { apnsPaths, pushStatus } from './bridge/push'
import { isExternallyOpenableUrl } from '../shared/url-safety'
import { appCsp, isAppUrl, navigationDecision } from './window-guard'

// Only forward web/mail URLs to the OS. Non-http(s) schemes (file://, custom
// protocols) reaching shell.openExternal from rendered content is a known
// Electron footgun — see url-safety.ts.
const openExternalSafe = (url: unknown): void => {
  if (isExternallyOpenableUrl(url)) void shell.openExternal(url)
  else console.error('[gt] refused openExternal for non-web URL:', String(url).slice(0, 80))
}
import { startAICollectionLoop } from './ai-collectors'
import { startListenerInboxWatcher } from './listeners'
import {
  spawnBgTask,
  listBgTasks,
  getBgTask,
  cancelBgTask,
  readBgTaskLog,
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
import { composeSteps, pipelineLabel } from './pipelines'
import { remoteAgents, remoteDirs, remoteProject, remoteRuns } from './remote'
import { listCursorModels } from './cursor-models'
import { createCheckpoint } from './checkpoints'
import { resolveWithinAny } from './path-guard'
import { configPath, terminalConfigDir } from './config-dir'
// `handle` is `ipcMain.handle` bound to the generated channel map, so a handler
// is checked against the preload key that calls it. Channels migrate one domain
// at a time; the rest still use `ipcMain.handle` directly.
import { handle } from './typed-ipc'

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
handle('sessions:list', (_e, engine?: Engine) => listSessions(engine))
handle('session:start', (_e, key: string, opts: StartOpts) => startSession(key, opts))
handle('session:setActive', (_e, key: string) => setActiveSession(key))
handle('session:stop', (_e, key: string) => stopSession(key))
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
handle('fleet:list', () => fleetSnapshot())

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

handle('bridge:status', () => {
  const cfg = readSettings().bridge
  const status = bridgeStatus()
  return { ...status, enabled: cfg.enabled, port: cfg.enabled ? status.port : cfg.port }
})
// The pairing payload carries the bearer token, so it is only ever produced on
// demand for the Settings pane — never returned from a bridge HTTP route.
handle('bridge:pairing', () => {
  const cfg = readSettings().bridge
  const identity = ensureIdentity()
  return pairingPayload({ port: cfg.port, identity })
})
handle('bridge:push-status', () => ({ ...pushStatus(), ...apnsPaths() }))
handle('bridge:tailscale', async () => {
  const self = await tailscaleSelf()
  return self ? { available: true, dnsName: self.dnsName, login: self.login } : { available: false }
})
handle('bridge:rotate-token', () => {
  const cfg = readSettings().bridge
  const identity = rotateToken()
  emitActivity({
    kind: 'info',
    title: 'Mobile bridge token rotated',
    detail: 'Every paired device must scan the new code',
  })
  return pairingPayload({ port: cfg.port, identity })
})
handle('dialog:pickDir', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: homedir(),
  })
  return r.canceled ? null : r.filePaths[0]
})
handle(
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
handle('remote:dirs', (_e, hostId: string, path?: string) => {
  const remote = remoteFromHostId(hostId, path)
  if (!remote) return { cwd: path || '', parent: '', entries: [], error: 'remote host not found' }
  return remoteDirs
    .list(remote, path)
    .catch((e) => ({ cwd: path || '', parent: '', entries: [], error: (e as Error).message }))
})
handle('remote:scaffold', async (_e, hostId: string, name: string, parentDir?: string) => {
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
handle('window:is-fullscreen', () => win?.isFullScreen() ?? false)

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
handle('data:transcript', () => readTranscriptStats(cur().sessionId))
handle('data:harness-tdd', () => readHarnessTdd(cur().cwd))
handle('data:usage', () => readUsage(cur().sessionId))
handle('data:git-status', () => {
  return activeDaemon().gitStatus()
})
handle('data:session-tasks', () => readSessionTasks(cur().sessionId))
handle('data:meta', () => ({ ...cur(), claude: enginePath('claude') }))

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

handle('widgets:list', () => {
  const ctx = repoTrustContext(cur().cwd)
  return ctx.widgets.map((w) => ({ ...w, trusted: entryTrusted(w.source, ctx.trusted) }))
})
handle('widgets:run', (_e, id: string) => {
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

handle('tabs:list', (_e, cwd?: string) => {
  const ctx = repoTrustContext(openSessionCwd(cwd))
  return ctx.tabs.map((t) => ({ ...t, trusted: entryTrusted(t.source, ctx.trusted) }))
})
handle('tabs:run', (_e, id: string, cwd?: string) => {
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
handle('repoTrust:status', () => {
  const ctx = repoTrustContext(cur().cwd)
  return { repoRoot: ctx.repoRoot, hash: ctx.hash, trusted: ctx.trusted, commands: ctx.commands }
})
// Deliberately takes NO cwd. Granting trust is the one operation the renderer
// must not be able to point anywhere: `approve('/attacker/repo')` followed by
// `tabs:run(id, '/attacker/repo')` would walk straight around the gate. The
// approval always applies to the session the user is actually looking at.
handle('repoTrust:approve', () => {
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
handle('repoTrust:revoke', () => {
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
handle('scratch:dir', () => {
  const dir = configPath('scratch')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* already exists / race */
  }
  return dir
})

// ---- tabs: repo context + tickets/MRs (scoped to the session's repo) ----
handle('sessions:project-list', () => {
  return activeDaemon().sessionsList()
})
handle('sessions:project-get', (_e, slug: string) => activeDaemon().sessionGet(slug))
// Cursor's live model catalog (incl. the `auto` entry point for Cursor
// Router). Empty when the CLI is missing or not logged in — the renderer then
// keeps the static catalog.
handle('cursor:models', () => listCursorModels())
handle('open:external', (_e, url: string) => openExternalSafe(url))
// Reveal ~/.config/TerMinal/ in Finder. Power-user QoL for editing
// schedules.json, settings.json, or per-(repo, agent) state sidecars by hand.
handle('open:config-dir', () => shell.openPath(terminalConfigDir()))

// Install the MCP server entry into ~/.claude/mcp.json (and ~/.codex's
// equivalent if it exists). Read-only, stdio transport. Idempotent —
// re-running just updates the binary path.
handle('mcp:install', () => {
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
handle('data:first-prompt', (_e, sessionId: string) => {
  if (!sessionId) return ''
  return readTranscriptStats(sessionId).firstUserText || ''
})

handle('workspace:is-bootstrapped', (_e, repoRoot: string) => {
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
handle('workspace:bootstrap', async (_e, repoRoot: string) => {
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
declare const __BUILD_REPO_SLUG__: string
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
handle('update:check', () => runUpdateCheck())

// Global tm plugin status/sync for the Settings panel. Sync re-copies the
// bundled plugin and repairs the ~/.claude/skills/tm symlink.
handle('plugin:status', () => tmPluginStatus())

// Per-project sidecar: where this repo's tickets/reviews/sessions live, how
// many files are still sitting in the repo, and the one-time move.
handle('repoState:status', (_e, repoRoot?: string) => {
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
handle('repoState:migrate', (_e, repoRoot?: string) => {
  const root = repoRoot || cur().cwd
  const pluginDir = join(terminalConfigDir(), 'plugin')
  const r = migrateRepoState(root)
  const swept = r.error
    ? 0
    : sweepLegacyPluginCopies(root, pluginDir).moved + sweepLegacySeeds(root, pluginDir).moved
  return { ...r, sweptCopies: swept }
})
handle('plugin:sync', () => installTmPlugin(tmPluginSrcDir()))

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
handle('release:start', () => {
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
handle('release:tail', () => {
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
handle('bg:list', () => (curRemote() ? [] : listBgTasks()))
handle('bg:get', (_e, id: string) => (curRemote() ? null : getBgTask(id)))
handle('bg:log', (_e, id: string) => (curRemote() ? '' : readBgTaskLog(id)))
handle(
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
handle('bg:cancel', (_e, id: string) =>
  curRemote() ? { ok: false, error: 'remote' } : cancelBgTask(id),
)

// Loops — long-running planner/generator/evaluator loops (LOOPS.md pattern).
handle('loops:list', () => (curRemote() ? [] : listLoops()))
handle('loops:get', (_e, id: string) => (curRemote() ? null : getLoop(id) || null))
handle('loops:state', (_e, id: string) => (curRemote() ? { error: 'remote' } : readLoopState(id)))
handle('loops:create', (_e, input: CreateLoopInput) => {
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
handle('loops:step', (_e, id: string) => (curRemote() ? { error: 'remote' } : stepLoop(id)))
handle('loops:restart', (_e, id: string) => (curRemote() ? { error: 'remote' } : restartLoop(id)))
handle('loops:stop', (_e, id: string) => (curRemote() ? { error: 'remote' } : stopLoop(id)))

// Cheap one-shot LLM call — routes through local coding-agent subscriptions.
handle('llm:cheap', async (_e, opts: Parameters<typeof import('./cheap-llm').cheapCall>[0]) => {
  const { cheapCall } = await import('./cheap-llm')
  return cheapCall(opts)
})

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
handle('agentview:snapshot', (_e, limit: number = 120) =>
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
handle('agentview:session', (_e, sessionId: string) =>
  curRemote() ? null : readObservabilitySessionDetail(sessionId),
)
handle('agentview:tool-call', (_e, sessionId: string, callId: string) =>
  curRemote() ? null : readObservabilityToolCallPayload(sessionId, callId),
)
handle(
  'agentview:transcript-window',
  (_e, sessionId: string, centerLine: number = 0, radius: number = 24) =>
    curRemote() ? null : readObservabilityTranscriptWindow(sessionId, centerLine, radius),
)
handle('harness:status', () => {
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
handle('release:status', () => {
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
handle('open:in-browser', (_e, url: string) => {
  if (!isExternallyOpenableUrl(url)) return openExternalSafe(url)
  openInApp(resolvedBrowserApp(), url, () => openExternalSafe(url))
})
// "Open in editor" — the configured editor (default Cursor). Opens a path; defaults
// to the active session's repo root. Renderer-supplied paths are constrained to
// the roots the UI legitimately surfaces (workspace, worktrees, the active repo,
// TerMinal's config dir) so this can't be turned into an arbitrary "open any
// file on disk in an app" primitive.
function editorOpenRoots(): (string | undefined)[] {
  return [
    resolvedProjectsDir(),
    resolvedWorktreesDir(),
    repoRootOf(cur().cwd) || cur().cwd,
    activeDaemon().filesRoot(),
    terminalConfigDir(),
  ]
}
handle('open:in-editor', (_e, path?: string) => {
  const fallbackTarget = repoRootOf(cur().cwd) || cur().cwd || homedir()
  const target = path ? resolveWithinAny(editorOpenRoots(), path) : fallbackTarget
  if (!target) {
    console.error('[gt] refused open:in-editor outside allowed roots:', String(path).slice(0, 120))
    return
  }
  openInApp(resolvedEditorApp(), target, () => shell.openPath(target))
})
handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
handle('clipboard:read', () => clipboard.readText())
handle('clipboard:imageToFile', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const dir = join(tmpdir(), 'terminal-pastes')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `paste-${randomUUID().slice(0, 8)}.png`)
  writeFileSync(file, img.toPNG())
  return file
})

// ---- notes (repo-bound + global, persisted) ----
handle('notes:read', (_e, scope: NotesScope) => {
  return activeDaemon().notesRead(scope)
})
handle('notes:write', (_e, scope: NotesScope, content: string) =>
  activeDaemon().notesWrite(scope, content),
)
handle('knowledge:read', (_e, scope: KnowledgeScope) => {
  return readKnowledge(scope, activeDaemon().repoRoot())
})
handle('knowledge:write', (_e, scope: KnowledgeScope, kb: KnowledgeBase) => {
  return writeKnowledge(scope, activeDaemon().repoRoot(), kb)
})
handle('knowledge:preview', (_e, url: string) => fetchKnowledgePreview(url))
handle('knowledge:rag-status', (_e, scope: KnowledgeScope, item: any) =>
  knowledgeRagStatus({ scope, repoRoot: activeDaemon().repoRoot(), item }),
)
handle('knowledge:rag-reindex', (_e, scope: KnowledgeScope, item: any, fullRebuild?: boolean) =>
  knowledgeRagReindex({ scope, repoRoot: activeDaemon().repoRoot(), item }, !!fullRebuild),
)
handle(
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
handle(
  'knowledge:rag-add-url',
  (_e, scope: KnowledgeScope, item: any, url: string, title?: string) =>
    knowledgeRagAddUrl({ scope, repoRoot: activeDaemon().repoRoot(), item, url, title }),
)
handle('knowledge:rag-search', (_e, scope: KnowledgeScope, item: any, query: string) =>
  knowledgeRagSearch({ scope, repoRoot: activeDaemon().repoRoot(), item, query }),
)

registerFilesIpc({ activeDaemon })
// Repo-scoped read surfaces, all fed by the same active-workspace daemon: the
// Files tab's git views, the per-turn checkpoints, the MRs tab (+ its digest),
// and the Docs/context/skills reads.
registerGitIpc({ activeDaemon })
registerCheckpointsIpc({ activeDaemon })
registerMrsIpc({ activeDaemon })
registerDocsIpc({ activeDaemon, sessionId: () => cur().sessionId })
// Tickets: reads, the per-repo provider config, and the write paths that emit
// into the Activity feed.
registerTicketsIpc({
  activeDaemon,
  daemonForRequest,
  sessionId: () => cur().sessionId,
  remoteEngineModel,
})
// The Activity feed, env probe and the per-channel test-alert buttons.
registerActivityIpc()
// Settings, prompt snippets and presets. `applyBridgeSetting` stays owned here
// because startup calls it too.
registerSettingsIpc({ cur, remoteFromHostId, repoLabelFor, applyBridgeSetting })
// The Runs tab (local + per-host fan-out), host provisioning/health, the
// cross-repo HITL inbox, and Monitoring/CI.
registerRunsIpc({ curRemote, remoteFromHostId })
registerHostsIpc({ runnerSrcPath, cliSrcPath })
registerHitlIpc({ remoteFromHostId })
registerMonitorsIpc()

// ---- my workflow (local Claude/Codex configuration) ----
handle('workflow:list', (_e, rel: string) => listWorkflowFiles(rel || ''))
handle('workflow:read', (_e, rel: string) => readWorkflowFile(rel))
handle('workflow:write', (_e, rel: string, content: string) => writeWorkflowFile(rel, content))

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
