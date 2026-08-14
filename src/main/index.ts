import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from 'electron'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { statSync, existsSync } from 'node:fs'

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

import { readTranscriptStats, findSessionFile, lastAssistantTurn } from './data'
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
import { registerInboxItemsIpc } from './ipc/inbox-items'
import { registerMonitorsIpc } from './ipc/monitors'
import { registerDataIpc } from './ipc/data'
import { registerWidgetsIpc } from './ipc/widgets'
import { registerBgTasksIpc } from './ipc/bg-tasks'
import { registerLoopsIpc } from './ipc/loops'
import { registerAgentViewIpc } from './ipc/agentview'
import { registerSystemIpc } from './ipc/system'
import { registerMaintenanceIpc } from './ipc/maintenance'
import { registerWorkspaceIpc } from './ipc/workspace'
import { registerKnowledgeIpc } from './ipc/knowledge'
import { registerFaviconsIpc } from './ipc/favicons'
import { registerWorkflowIpc } from './ipc/workflow'
import { openExternalSafe } from './open-external'
import { registerSessionsIpc } from './ipc/sessions'
import { registerBridgeIpc } from './ipc/bridge'
import { registerProjectsIpc } from './ipc/projects'
import {
  localOnlyToRemote,
  remoteAgentCatalog,
  remoteEngineModel,
  remoteSteps,
} from './remote-dispatch'
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
  watchSession,
  stopWatchSession,
  activeDaemon,
  daemonForRequest,
} from './session-registry'
import { registerPersistentAgentsIpc } from './ipc/persistent-agents'
import { registerInboxIpc } from './ipc/inbox'
import { registerRepoTrustDenialIpc } from './ipc/repo-trust-denials'
import { registerSessionSearchIpc } from './ipc/session-search'
import { registerStacksIpc } from './ipc/stacks'
import { registerGithubReviewIpc } from './ipc/github-review'
import { fixPath } from './env'
import { emitActivity, onActivity, startActivityTail } from './events'
import { installStatuslineShim } from './statusline'
import { repoRootOf, repoForCwd } from './repo'
import { checkForUpdate } from './update-check'
import { onDigestEvent } from './digest-run'
import {
  readSettings,
  setSettingsSecretStorage,
  syncTelegramSidecar,
  syncSlackSidecar,
} from './settings'
import { telegramControlEnabled, resolvedTemplateRepo } from './settings'
import { startMonitorLivenessWatch } from './monitor-liveness-runtime'
import {
  cloneTemplateToTmp,
  pickTemplateSource,
  templateCandidates,
  type TemplateSource,
} from './template'
import { configureTelegramControl, markTelegramControlEnabled, pollTelegramOnce } from './telegram'
import { onAgentEvent, loadPersistedRuns, killAllAgentRuns } from './agents'
import { readSchedules } from './schedules'
import { installTmPlugin } from './plugin-install'
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
import { flushAllSessionRunLogs, sweepStaleCronRuns, sweepStaleSessionRuns } from './cron-runs'
import { startBridge, stopBridge } from './bridge/server'
import { bridgeHosts } from './bridge/identity'
import { isExternallyOpenableUrl } from '../shared/url-safety'
import { appCsp, isAppUrl, navigationDecision } from './window-guard'

import { startAICollectionLoop } from './ai-collectors'
import { startListenerInboxWatcher } from './listeners'
import { startBgWatcher } from './bg-tasks'
import { startLoopWatcher } from './loops'
import { startLoopListener, noteLoopTurnComplete, noteSingleLoopTurn } from './loop-listener'
import { createCheckpoint } from './checkpoints'
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

// AI fleet observability IPCs. Pull from the per-run AI ledger.
registerObservabilityIpc({ isRemote: () => !!curRemote() })

// Inbox snooze + alert delivery log. Same reason: the renderer already invokes
// these channels, so leaving them unregistered is an unhandled-invoke rejection.
registerInboxIpc()
// GitHub native stacked PRs. Reads only; degrades to no stacks everywhere the
// preview has not rolled out.
registerStacksIpc()
// GitHub-native PR review: checks, conversation, approvals, and the three
// user-initiated write actions. Every channel answers "GitHub-only for now"
// off GitHub, so wiring it costs a GitLab workspace nothing.
registerGithubReviewIpc()
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
registerInboxItemsIpc({ remoteFromHostId })
registerMonitorsIpc()
// Plugin pollers (all keyed to the attached session) and the declarative
// widget/tab surface with its repo-trust gate.
registerDataIpc({ cur, activeDaemon })
registerWidgetsIpc({
  cur,
  openCwds: () => [...sessions.values()].map((s) => s.pinned.cwd),
})
// Detached background tasks, the planner/generator/evaluator loops, and the
// AgentView observability reads.
registerBgTasksIpc({ curRemote })
registerLoopsIpc({ cur, curRemote })
registerAgentViewIpc({ curRemote })
// Session lifecycle + fleet snapshot, the mobile bridge's read surface, and
// local/remote project scaffolding.
registerSessionsIpc()
registerBridgeIpc()
registerProjectsIpc({ remoteFromHostId })
// OS integration (picker, scratch dir, MCP install, open-in-app, clipboard),
// the workspace bootstrap flow, notes/knowledge, my-workflow files, and the
// self-service maintenance surface.
registerSystemIpc({ window: () => win, cur, activeDaemon })
registerWorkspaceIpc({ curRemote, projectTemplateSource })
registerKnowledgeIpc({ activeDaemon })
registerFaviconsIpc()
registerWorkflowIpc()
registerMaintenanceIpc({
  cur,
  runUpdateCheck,
  tmPluginSrcDir,
  sourceCheckoutRoot,
  repoLabelFor,
})

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
