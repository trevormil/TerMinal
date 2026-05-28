import { app, shell, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { statSync, existsSync, readdirSync } from 'node:fs'
import * as pty from 'node-pty'
import {
  readTranscriptStats,
  readHarnessTdd,
  listSessions,
  findSessionFile,
  readSessionTasks,
  lastAssistantTurn,
} from './data'
import { emitActivity, readActivity, clearActivity, onActivity, startActivityTail } from './events'
import { readUsage } from './usage'
import { listCommandWidgets, runCommand } from './widgets'
import { repoRootOf, repoForCwd, gitStatus } from './repo'
import { listTickets, getTicket, createTicket, updateTicket, type NewTicket } from './backlog'
import { listMrs, getMr, getMrDiff, mrSummary } from './mrs'
import { readNotes, writeNotes, type NotesScope } from './notes'
import { listDir, readFile, writeFile, searchRepo, createEntry, renameEntry, removeEntry } from './files'
import { listProjectSessions, getProjectSession, hasSessions as repoHasSessions } from './sessions'
import { scaffoldProject } from './scaffold'
import { readSnippets, writeSnippets, type Snippet } from './snippets'
import {
  readAgents,
  hasAgents as repoHasAgents,
  runAgent,
  runTicketAgent,
  listRuns,
  cancelRun,
  removeWorktree,
  onAgentEvent,
  type Engine,
} from './agents'
import {
  readSchedules,
  addSchedule,
  removeSchedule,
  toggleSchedule,
  markRun,
  dueSchedules,
  type Cadence,
} from './schedules'

const CLAUDE = process.env.GT_CLAUDE_BIN || 'claude'
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'

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
type Pinned = { sessionId: string; cwd: string; mode: '' | 'new' | 'resume'; name: string }
const sessions = new Map<string, { pty: pty.IPty; pinned: Pinned }>()
let activeKey = ''
const cur = (): Pinned => sessions.get(activeKey)?.pinned ?? { sessionId: '', cwd: '', mode: '', name: '' }

type StartOpts = {
  mode: 'new' | 'resume'
  sessionId?: string
  cwd?: string
  name?: string
  cols: number
  rows: number
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

function startSession(key: string, opts: StartOpts) {
  sessions.get(key)?.pty.kill()

  const cwd = opts.cwd || homedir()
  const args: string[] = []
  let sessionId: string

  if (opts.mode === 'resume' && opts.sessionId) {
    sessionId = opts.sessionId
    args.push('--resume', sessionId)
  } else {
    sessionId = randomUUID()
    args.push('--session-id', sessionId)
    if (opts.name) args.push('--name', opts.name)
  }

  const cmd = [CLAUDE, ...args].map(shq).join(' ')
  const proc = pty.spawn(LOGIN_SHELL, ['-l', '-c', cmd], {
    name: 'xterm-256color',
    cols: opts.cols || 80,
    rows: opts.rows || 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  })
  proc.onData((d) => send('pty:data', key, d))
  proc.onExit(({ exitCode }) => send('pty:exit', key, exitCode))

  sessions.set(key, { pty: proc, pinned: { sessionId, cwd, mode: opts.mode, name: opts.name || '' } })
  activeKey = key
  watchSession()
  emitActivity({
    kind: 'session-start',
    title: `${opts.name || basename(cwd) || 'session'} · ${opts.mode === 'resume' ? 'resumed' : 'started'}`,
    detail: cwd.replace(homedir(), '~'),
    repo: repoForCwd(cwd)?.path || basename(repoRootOf(cwd) || ''),
    repoRoot: repoRootOf(cwd),
    sessionId,
  })
  return { sessionId, cwd }
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
let scheduleTimer: ReturnType<typeof setInterval> | null = null
function pollActivity() {
  for (const [key, s] of sessions) {
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
    title: 'Gauntlet Terminal',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
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
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[gt] renderer gone:', d.reason),
  )

  // push activity events to the renderer; poll all sessions for turn completion
  onActivity((ev) => send('activity:event', ev))
  startActivityTail() // surface externally-appended events (skills) live
  onAgentEvent((channel, payload) => send(channel, payload))
  if (!activityTimer) activityTimer = setInterval(pollActivity, 1500)
  // fire any due scheduled agent runs (interval-based cadence)
  if (!scheduleTimer)
    scheduleTimer = setInterval(() => {
      for (const s of dueSchedules()) {
        const r = runAgent(s.repoRoot, s.agentId, s.engine)
        if (!('error' in r)) markRun(s.id)
      }
    }, 60_000)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- session IPC ----
ipcMain.handle('sessions:list', () => listSessions())
ipcMain.handle('session:start', (_e, key: string, opts: StartOpts) => startSession(key, opts))
ipcMain.handle('session:setActive', (_e, key: string) => setActiveSession(key))
ipcMain.handle('session:stop', (_e, key: string) => stopSession(key))
ipcMain.handle('dirs:gauntlet', () => {
  const base = join(homedir(), 'CompSci', 'gauntlet')
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
ipcMain.handle('project:scaffold', (_e, name: string, parentDir?: string) =>
  scaffoldProject(name, parentDir),
)
ipcMain.handle('window:is-fullscreen', () => win?.isFullScreen() ?? false)
ipcMain.handle('activity:list', () => readActivity())
ipcMain.handle('activity:clear', () => clearActivity())
ipcMain.handle('snippets:list', () => readSnippets())
ipcMain.handle('snippets:save', (_e, list: Snippet[]) => writeSnippets(list))
ipcMain.handle('agents:list', () => readAgents(repoRootOf(cur().cwd)))
ipcMain.handle('agents:run', (_e, agentId: string, engine?: Engine) =>
  runAgent(repoRootOf(cur().cwd), agentId, engine),
)
ipcMain.handle('agents:run-ticket', (_e, slug: string, engine: Engine) => {
  const root = repoRootOf(cur().cwd)
  const t = getTicket(root, slug)
  return t ? runTicketAgent(root, { id: t.id, title: t.title, body: t.body }, engine) : { error: 'ticket not found' }
})
ipcMain.handle('agents:runs', () => listRuns())
ipcMain.handle('agents:cancel', (_e, runId: string) => cancelRun(runId))
ipcMain.handle('agents:remove-worktree', (_e, runId: string) => removeWorktree(runId))
ipcMain.handle('schedules:list', () => readSchedules())
ipcMain.handle(
  'schedules:add',
  (_e, input: { agentId: string; agentTitle: string; engine: Engine; cadence: Cadence }) =>
    addSchedule({
      repoRoot: repoRootOf(cur().cwd),
      repoLabel: repoForCwd(cur().cwd)?.path || basename(repoRootOf(cur().cwd) || ''),
      ...input,
    }),
)
ipcMain.handle('schedules:remove', (_e, id: string) => removeSchedule(id))
ipcMain.handle('schedules:toggle', (_e, id: string, enabled: boolean) => toggleSchedule(id, enabled))
// inject text into the ACTIVE session's terminal (snippet → prompt)
ipcMain.on('pty:type', (_e, text: string) => {
  try {
    sessions.get(activeKey)?.pty.write(text)
  } catch {
    /* session gone */
  }
})

// ---- PTY IPC (routed by session key) ----
ipcMain.on('pty:input', (_e, key: string, data: string) => sessions.get(key)?.pty.write(data))
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
ipcMain.handle('data:usage', () => readUsage())
ipcMain.handle('data:git-status', () => gitStatus(cur().cwd))
ipcMain.handle('data:session-tasks', () => readSessionTasks(cur().sessionId))
ipcMain.handle('data:mr-summary', () => mrSummary(repoRootOf(cur().cwd)))
ipcMain.handle('data:meta', () => ({ ...cur(), claude: CLAUDE }))

// ---- command widgets (declarative, per-repo extensible) ----
ipcMain.handle('widgets:list', () => listCommandWidgets(cur().cwd))
ipcMain.handle('widgets:run', (_e, command: string) => runCommand(command, cur().cwd))

// ---- tabs: repo context + tickets/MRs (scoped to the session's repo) ----
ipcMain.handle('tab:context', () => {
  const repoRoot = repoRootOf(cur().cwd)
  const repo = repoForCwd(cur().cwd)
  return {
    cwd: cur().cwd,
    sessionId: cur().sessionId,
    repoRoot,
    repoPath: repo?.path || '',
    repoHost: repo?.host || '',
    hasBacklog: !!repoRoot && existsSync(join(repoRoot, 'backlog')),
    hasSessions: repoHasSessions(repoRoot),
    hasAgents: repoHasAgents(repoRoot),
  }
})
ipcMain.handle('sessions:project-list', () => listProjectSessions(repoRootOf(cur().cwd)))
ipcMain.handle('sessions:project-get', (_e, slug: string) =>
  getProjectSession(repoRootOf(cur().cwd), slug),
)
ipcMain.handle('tickets:list', () => listTickets(repoRootOf(cur().cwd)))
ipcMain.handle('tickets:get', (_e, slug: string) => getTicket(repoRootOf(cur().cwd), slug))
ipcMain.handle('tickets:create', (_e, input: NewTicket) => {
  const root = repoRootOf(cur().cwd)
  const t = createTicket(root, input)
  emitActivity({
    kind: 'ticket-filed',
    title: `Ticket filed · #${t.id}`,
    detail: t.title,
    repo: repoForCwd(cur().cwd)?.path || basename(root || ''),
    repoRoot: root,
    sessionId: cur().sessionId,
  })
  return t
})
ipcMain.handle('tickets:update', (_e, slug: string, patch: { status?: string; priority?: string }) =>
  updateTicket(repoRootOf(cur().cwd), slug, patch),
)
ipcMain.handle('mrs:list', () => listMrs(repoRootOf(cur().cwd)))
ipcMain.handle('mrs:get', (_e, iid: number) => getMr(repoRootOf(cur().cwd), iid))
ipcMain.handle('mrs:diff', (_e, iid: number) => getMrDiff(repoRootOf(cur().cwd), iid))
ipcMain.handle('open:external', (_e, url: string) => shell.openExternal(url))
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:read', () => clipboard.readText())

// ---- notes (repo-bound + global, persisted) ----
ipcMain.handle('notes:read', (_e, scope: NotesScope) => readNotes(scope, repoRootOf(cur().cwd)))
ipcMain.handle('notes:write', (_e, scope: NotesScope, content: string) =>
  writeNotes(scope, content, repoRootOf(cur().cwd)),
)

// ---- files (Cursor-like editor; scoped to repo root / cwd) ----
const filesRoot = () => repoRootOf(cur().cwd) || cur().cwd || homedir()
ipcMain.handle('files:list', (_e, rel: string) => listDir(filesRoot(), rel || ''))
ipcMain.handle('files:read', (_e, rel: string) => readFile(filesRoot(), rel))
ipcMain.handle('files:write', (_e, rel: string, content: string) =>
  writeFile(filesRoot(), rel, content),
)
ipcMain.handle('files:search', (_e, q: string) => searchRepo(filesRoot(), q))
ipcMain.handle('files:create', (_e, rel: string, dir: boolean) => createEntry(filesRoot(), rel, dir))
ipcMain.handle('files:rename', (_e, from: string, to: string) => renameEntry(filesRoot(), from, to))
ipcMain.handle('files:delete', (_e, rel: string) => removeEntry(filesRoot(), rel))

// Safety net: never let a stray async error (e.g. a late PTY write) take down
// the whole app.
process.on('uncaughtException', (e) => console.error('[gt] uncaught:', e))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (watchTimer) clearInterval(watchTimer)
  if (activityTimer) clearInterval(activityTimer)
  if (scheduleTimer) clearInterval(scheduleTimer)
  for (const s of sessions.values()) s.pty.kill()
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
