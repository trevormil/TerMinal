import { app, shell, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import { join } from 'node:path'
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
} from './data'
import { readUsage } from './usage'
import { listCommandWidgets, runCommand } from './widgets'
import { repoRootOf, repoForCwd, gitStatus } from './repo'
import { listTickets, getTicket, createTicket, updateTicket, type NewTicket } from './backlog'
import { listMrs, getMr, getMrDiff, mrSummary } from './mrs'
import { readNotes, writeNotes, type NotesScope } from './notes'
import { listDir, readFile, writeFile, searchRepo, createEntry, renameEntry, removeEntry } from './files'
import { listProjectSessions, getProjectSession, hasSessions as repoHasSessions } from './sessions'

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

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 820,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    title: 'Gauntlet Terminal',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[gt] renderer gone:', d.reason),
  )

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
  }
})
ipcMain.handle('sessions:project-list', () => listProjectSessions(repoRootOf(cur().cwd)))
ipcMain.handle('sessions:project-get', (_e, slug: string) =>
  getProjectSession(repoRootOf(cur().cwd), slug),
)
ipcMain.handle('tickets:list', () => listTickets(repoRootOf(cur().cwd)))
ipcMain.handle('tickets:get', (_e, slug: string) => getTicket(repoRootOf(cur().cwd), slug))
ipcMain.handle('tickets:create', (_e, input: NewTicket) =>
  createTicket(repoRootOf(cur().cwd), input),
)
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
  for (const s of sessions.values()) s.pty.kill()
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
