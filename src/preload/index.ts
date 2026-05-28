import { contextBridge, ipcRenderer } from 'electron'

type StartOpts = {
  mode: 'new' | 'resume'
  sessionId?: string
  cwd?: string
  name?: string
  cols: number
  rows: number
}

// The single bridge the renderer (and every plugin) talks to.
const gt = {
  // session lifecycle
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  startSession: (opts: StartOpts) => ipcRenderer.invoke('session:start', opts),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  gauntletDirs: () => ipcRenderer.invoke('dirs:gauntlet'),

  // terminal io (the pty is spawned by startSession)
  pty: {
    input: (data: string) => ipcRenderer.send('pty:input', data),
    resize: (size: { cols: number; rows: number }) => ipcRenderer.send('pty:resize', size),
    onData: (cb: (data: string) => void) => {
      const h = (_e: unknown, d: string) => cb(d)
      ipcRenderer.on('pty:data', h)
      return () => ipcRenderer.removeListener('pty:data', h)
    },
    onExit: (cb: (code: number) => void) => {
      const h = (_e: unknown, c: number) => cb(c)
      ipcRenderer.on('pty:exit', h)
      return () => ipcRenderer.removeListener('pty:exit', h)
    },
  },

  // data sources for plugins (all keyed to the attached session)
  transcript: () => ipcRenderer.invoke('data:transcript'),
  harnessTdd: () => ipcRenderer.invoke('data:harness-tdd'),
  usage: () => ipcRenderer.invoke('data:usage'),
  gitStatus: () => ipcRenderer.invoke('data:git-status'),
  mrSummary: () => ipcRenderer.invoke('data:mr-summary'),
  meta: () => ipcRenderer.invoke('data:meta'),

  // command widgets (declarative / per-repo)
  listCommandWidgets: () => ipcRenderer.invoke('widgets:list'),
  runCommand: (command: string) => ipcRenderer.invoke('widgets:run', command),

  // tabs: repo context + tickets / MRs
  tabContext: () => ipcRenderer.invoke('tab:context'),
  tickets: {
    list: () => ipcRenderer.invoke('tickets:list'),
    get: (slug: string) => ipcRenderer.invoke('tickets:get', slug),
    create: (input: unknown) => ipcRenderer.invoke('tickets:create', input),
    update: (slug: string, patch: { status?: string; priority?: string }) =>
      ipcRenderer.invoke('tickets:update', slug, patch),
  },
  listMrs: () => ipcRenderer.invoke('mrs:list'),
  getMr: (iid: number) => ipcRenderer.invoke('mrs:get', iid),
  getMrDiff: (iid: number) => ipcRenderer.invoke('mrs:diff', iid),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),

  notes: {
    read: (scope: 'repo' | 'global') => ipcRenderer.invoke('notes:read', scope),
    write: (scope: 'repo' | 'global', content: string) =>
      ipcRenderer.invoke('notes:write', scope, content),
  },
  files: {
    list: (rel: string) => ipcRenderer.invoke('files:list', rel),
    read: (rel: string) => ipcRenderer.invoke('files:read', rel),
    write: (rel: string, content: string) => ipcRenderer.invoke('files:write', rel, content),
    search: (q: string) => ipcRenderer.invoke('files:search', q),
    create: (rel: string, dir: boolean) => ipcRenderer.invoke('files:create', rel, dir),
    rename: (from: string, to: string) => ipcRenderer.invoke('files:rename', from, to),
    del: (rel: string) => ipcRenderer.invoke('files:delete', rel),
  },

  // fires the instant the attached session's transcript changes
  onTick: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('gt:tick', h)
    return () => ipcRenderer.removeListener('gt:tick', h)
  },
}

contextBridge.exposeInMainWorld('gt', gt)

export type Gt = typeof gt
