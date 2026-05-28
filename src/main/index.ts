import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { statSync, existsSync, readdirSync } from 'node:fs'
import * as pty from 'node-pty'
import { readTranscriptStats, readHarnessTdd, listSessions, findSessionFile } from './data'
import { readUsage } from './usage'
import { listCommandWidgets, runCommand } from './widgets'
import { repoRootOf, repoForCwd, gitStatus } from './repo'
import { listTickets, getTicket, createTicket, updateTicket, type NewTicket } from './backlog'
import { listMrs, getMr, getMrDiff, mrSummary } from './mrs'
import { readNotes, writeNotes, type NotesScope } from './notes'
import { listDir, readFile, writeFile, searchRepo, createEntry, renameEntry, removeEntry } from './files'

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
let ptyProc: pty.IPty | null = null

// the single session this window is attached to, for its whole life
let pinned = { sessionId: '', cwd: '', mode: '' as '' | 'new' | 'resume', name: '' }

type StartOpts = {
  mode: 'new' | 'resume'
  sessionId?: string
  cwd?: string
  name?: string
  cols: number
  rows: number
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

function startSession(opts: StartOpts) {
  ptyProc?.kill()

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

  pinned = { sessionId, cwd, mode: opts.mode, name: opts.name || '' }
  watchSession()

  const cmd = [CLAUDE, ...args].map(shq).join(' ')
  ptyProc = pty.spawn(LOGIN_SHELL, ['-l', '-c', cmd], {
    name: 'xterm-256color',
    cols: opts.cols || 80,
    rows: opts.rows || 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  })
  ptyProc.onData((d) => send('pty:data', d))
  ptyProc.onExit(({ exitCode }) => send('pty:exit', exitCode))

  return { sessionId, cwd }
}

// Watch the attached session's transcript and push a tick the instant it grows
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
    if (!pinned.sessionId) return
    if (!watchedFile) {
      const f = findSessionFile(pinned.sessionId)
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
ipcMain.handle('session:start', (_e, opts: StartOpts) => startSession(opts))
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

// ---- PTY IPC ----
ipcMain.on('pty:input', (_e, data: string) => ptyProc?.write(data))
ipcMain.on('pty:resize', (_e, size: { cols: number; rows: number }) => {
  try {
    ptyProc?.resize(size.cols, size.rows)
  } catch {
    /* ignore transient resize errors */
  }
})

// ---- data IPC (plugin pollers; all keyed to the attached session) ----
ipcMain.handle('data:transcript', () => readTranscriptStats(pinned.sessionId))
ipcMain.handle('data:harness-tdd', () => readHarnessTdd(pinned.cwd))
ipcMain.handle('data:usage', () => readUsage())
ipcMain.handle('data:git-status', () => gitStatus(pinned.cwd))
ipcMain.handle('data:mr-summary', () => mrSummary(repoRootOf(pinned.cwd)))
ipcMain.handle('data:meta', () => ({ ...pinned, claude: CLAUDE }))

// ---- command widgets (declarative, per-repo extensible) ----
ipcMain.handle('widgets:list', () => listCommandWidgets(pinned.cwd))
ipcMain.handle('widgets:run', (_e, command: string) => runCommand(command, pinned.cwd))

// ---- tabs: repo context + tickets/MRs (scoped to the session's repo) ----
ipcMain.handle('tab:context', () => {
  const repoRoot = repoRootOf(pinned.cwd)
  const repo = repoForCwd(pinned.cwd)
  return {
    cwd: pinned.cwd,
    sessionId: pinned.sessionId,
    repoRoot,
    repoPath: repo?.path || '',
    repoHost: repo?.host || '',
    hasBacklog: !!repoRoot && existsSync(join(repoRoot, 'backlog')),
  }
})
ipcMain.handle('tickets:list', () => listTickets(repoRootOf(pinned.cwd)))
ipcMain.handle('tickets:get', (_e, slug: string) => getTicket(repoRootOf(pinned.cwd), slug))
ipcMain.handle('tickets:create', (_e, input: NewTicket) =>
  createTicket(repoRootOf(pinned.cwd), input),
)
ipcMain.handle('tickets:update', (_e, slug: string, patch: { status?: string; priority?: string }) =>
  updateTicket(repoRootOf(pinned.cwd), slug, patch),
)
ipcMain.handle('mrs:list', () => listMrs(repoRootOf(pinned.cwd)))
ipcMain.handle('mrs:get', (_e, iid: number) => getMr(repoRootOf(pinned.cwd), iid))
ipcMain.handle('mrs:diff', (_e, iid: number) => getMrDiff(repoRootOf(pinned.cwd), iid))
ipcMain.handle('open:external', (_e, url: string) => shell.openExternal(url))

// ---- notes (repo-bound + global, persisted) ----
ipcMain.handle('notes:read', (_e, scope: NotesScope) => readNotes(scope, repoRootOf(pinned.cwd)))
ipcMain.handle('notes:write', (_e, scope: NotesScope, content: string) =>
  writeNotes(scope, content, repoRootOf(pinned.cwd)),
)

// ---- files (Cursor-like editor; scoped to repo root / cwd) ----
const filesRoot = () => repoRootOf(pinned.cwd) || pinned.cwd || homedir()
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
  ptyProc?.kill()
  if (process.platform !== 'darwin') app.quit()
})
