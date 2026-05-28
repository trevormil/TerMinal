import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { statSync, existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { readTranscriptStats, readHarnessTdd, listSessions, findSessionFile } from './data'
import { readUsage } from './usage'
import { listCommandWidgets, runCommand } from './widgets'
import { repoRootOf, repoForCwd } from './repo'
import { listTickets, getTicket, createTicket, type NewTicket } from './backlog'
import { listMrs } from './mrs'

const CLAUDE = process.env.GT_CLAUDE_BIN || 'claude'
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'

let win: BrowserWindow | null = null
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
  ptyProc.onData((d) => win?.webContents.send('pty:data', d))
  ptyProc.onExit(({ exitCode }) => win?.webContents.send('pty:exit', exitCode))

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
        win?.webContents.send('gt:tick')
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
ipcMain.handle('mrs:list', () => listMrs(repoRootOf(pinned.cwd)))
ipcMain.handle('open:external', (_e, url: string) => shell.openExternal(url))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyProc?.kill()
  if (process.platform !== 'darwin') app.quit()
})
