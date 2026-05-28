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
  // session lifecycle (each session keyed by a renderer-generated id)
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  startSession: (key: string, opts: StartOpts) => ipcRenderer.invoke('session:start', key, opts),
  setActiveSession: (key: string) => ipcRenderer.invoke('session:setActive', key),
  stopSession: (key: string) => ipcRenderer.invoke('session:stop', key),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  gauntletDirs: () => ipcRenderer.invoke('dirs:gauntlet'),
  scaffoldProject: (name: string, parentDir?: string) =>
    ipcRenderer.invoke('project:scaffold', name, parentDir),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
  onFullscreen: (cb: (v: boolean) => void) => {
    const h = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('window:fullscreen', h)
    return () => ipcRenderer.removeListener('window:fullscreen', h)
  },

  // saved prompts / snippets + inject into the active terminal
  snippets: {
    list: () => ipcRenderer.invoke('snippets:list'),
    save: (list: unknown) => ipcRenderer.invoke('snippets:save', list),
  },
  typeIntoActive: (text: string) => ipcRenderer.send('pty:type', text),

  // activity feed + notifications
  activity: {
    list: () => ipcRenderer.invoke('activity:list'),
    clear: () => ipcRenderer.invoke('activity:clear'),
    onEvent: (cb: (ev: unknown) => void) => {
      const h = (_e: unknown, ev: unknown) => cb(ev)
      ipcRenderer.on('activity:event', h)
      return () => ipcRenderer.removeListener('activity:event', h)
    },
  },

  // terminal io, routed by session key (the pty is spawned by startSession)
  pty: {
    input: (key: string, data: string) => ipcRenderer.send('pty:input', key, data),
    resize: (key: string, size: { cols: number; rows: number }) =>
      ipcRenderer.send('pty:resize', key, size),
    onData: (cb: (key: string, data: string) => void) => {
      const h = (_e: unknown, key: string, d: string) => cb(key, d)
      ipcRenderer.on('pty:data', h)
      return () => ipcRenderer.removeListener('pty:data', h)
    },
    onExit: (cb: (key: string, code: number) => void) => {
      const h = (_e: unknown, key: string, c: number) => cb(key, c)
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
  sessionTasks: () => ipcRenderer.invoke('data:session-tasks'),
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
  projectSessions: () => ipcRenderer.invoke('sessions:project-list'),
  getProjectSession: (slug: string) => ipcRenderer.invoke('sessions:project-get', slug),
  listMrs: () => ipcRenderer.invoke('mrs:list'),
  getMr: (iid: number) => ipcRenderer.invoke('mrs:get', iid),
  getMrDiff: (iid: number) => ipcRenderer.invoke('mrs:diff', iid),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

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
