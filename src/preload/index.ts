import { contextBridge, ipcRenderer, webUtils } from 'electron'

type StartOpts = {
  mode: 'new' | 'resume'
  engine?: 'claude' | 'codex' | 'cursor' | 'openrouter' | 'hermes' | 'local'
  model?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: {
    hostId: string
    label: string
    sshTarget: string
    cwd?: string
    platform?: 'auto' | 'linux' | 'macos'
    daemon?: unknown
  }
  loopId?: string
  loopRole?: 'driver' | 'worker'
  openrouterHarness?: 'codex' | 'hermes'
  cols: number
  rows: number
}

// The single bridge the renderer (and every plugin) talks to.
const gt = {
  // session lifecycle (each session keyed by a renderer-generated id)
  listSessions: (engine?: 'claude' | 'codex' | 'cursor') =>
    ipcRenderer.invoke('sessions:list', engine),
  startSession: (key: string, opts: StartOpts) => ipcRenderer.invoke('session:start', key, opts),
  setActiveSession: (key: string) => ipcRenderer.invoke('session:setActive', key),
  stopSession: (key: string) => ipcRenderer.invoke('session:stop', key),
  fleet: () => ipcRenderer.invoke('fleet:list'),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  projectDirs: () => ipcRenderer.invoke('dirs:projects'),
  detectEnv: () => ipcRenderer.invoke('env:detect'),
  installGtNotify: () => ipcRenderer.invoke('env:install-gt-notify'),
  scaffoldProject: (name: string, parentDir?: string, ticketProvider?: unknown) =>
    ipcRenderer.invoke('project:scaffold', name, parentDir, ticketProvider),
  remoteDirs: (hostId: string, path?: string) => ipcRenderer.invoke('remote:dirs', hostId, path),
  remoteScaffoldProject: (hostId: string, name: string, parentDir?: string) =>
    ipcRenderer.invoke('remote:scaffold', hostId, name, parentDir),
  provisionHost: (hostId: string) => ipcRenderer.invoke('hosts:provision', hostId),
  healthCheckHost: (hostId: string) => ipcRenderer.invoke('hosts:health', hostId),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
  onFullscreen: (cb: (v: boolean) => void) => {
    const h = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('window:fullscreen', h)
    return () => ipcRenderer.removeListener('window:fullscreen', h)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    patch: (patch: unknown) => ipcRenderer.invoke('settings:patch', patch),
    remoteProbe: (hostId: string) => ipcRenderer.invoke('settings:remote-probe', hostId),
    validateProjectsDir: (input: { dir?: string; hostId?: string }) =>
      ipcRenderer.invoke('settings:validate-projects-dir', input),
    suggestProjectsDir: () => ipcRenderer.invoke('settings:suggest-projects-dir'),
  },
  snippets: {
    list: (repoRoot?: string) => ipcRenderer.invoke('snippets:list', repoRoot),
    save: (input: unknown) => ipcRenderer.invoke('snippets:save', input),
  },
  presets: {
    get: () => ipcRenderer.invoke('presets:get'),
    hide: (kind: 'agents' | 'snippets', id: string) => ipcRenderer.invoke('presets:hide', kind, id),
    restore: (kind: 'agents' | 'snippets', id?: string) =>
      ipcRenderer.invoke('presets:restore', kind, id),
  },
  telegram: {
    test: () => ipcRenderer.invoke('telegram:test'),
  },
  alerts: {
    test: (channel: 'telegram' | 'desktop' | 'webhook') =>
      ipcRenderer.invoke('alerts:test', channel),
  },
  cheapLlm: (opts: {
    messages: { role: string; content: string }[]
    model?: string
    engine?: 'codex' | 'claude' | 'cursor'
    route?: 'auto' | 'claude-p'
    cwd?: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  }) => ipcRenderer.invoke('llm:cheap', opts),
  classify: {
    ci: (rawLog: string) => ipcRenderer.invoke('classify:ci', rawLog),
    risk: (input: { files: string[]; diffLines?: number; title?: string }) =>
      ipcRenderer.invoke('classify:risk', input),
  },
  // on-demand codex/claude/cursor agents
  agents: {
    allRuns: () => ipcRenderer.invoke('runs:all'),
    remoteAllRuns: () => ipcRenderer.invoke('runs:remote-all'),
    runLog: (source: 'cron' | 'agent' | 'bg' | 'session', runId: string, hostId?: string) =>
      ipcRenderer.invoke('runs:log', source, runId, hostId),
    runArtifacts: (repoRoot: string) => ipcRenderer.invoke('runs:artifacts', repoRoot),
    runTrends: (days?: number) => ipcRenderer.invoke('runs:trends', days),
    cancelCron: (id: string, hostId?: string) => ipcRenderer.invoke('runs:cancel-cron', id, hostId),
    list: () => ipcRenderer.invoke('agents:list'),
    definitions: () => ipcRenderer.invoke('agents:definitions'),
    save: (agent: unknown) => ipcRenderer.invoke('agents:save', agent),
    reset: (id: string) => ipcRenderer.invoke('agents:reset', id),
    script: (id: string) => ipcRenderer.invoke('agents:script', id),
    state: (id: string) => ipcRenderer.invoke('agents:state', id),
    stateReset: (id: string) => ipcRenderer.invoke('agents:state-reset', id),
    design: (text: string, engine: string, scope: 'repo' | 'global', model?: string) =>
      ipcRenderer.invoke('agents:design', text, engine, scope, model),
    personas: () => ipcRenderer.invoke('personas:list'),
    pipelines: () => ipcRenderer.invoke('agents:pipelines'),
    run: (
      id: string,
      engine?: string,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: unknown,
      openrouterHarness?: 'codex' | 'hermes',
      extraContext?: string,
    ) =>
      ipcRenderer.invoke(
        'agents:run',
        id,
        engine,
        persona,
        pipeline,
        model,
        remote,
        openrouterHarness,
        extraContext,
      ),
    runTicket: (
      slug: string,
      engine: string,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: unknown,
      lanes?: number,
      extraContext?: string,
    ) =>
      ipcRenderer.invoke(
        'agents:run-ticket',
        slug,
        engine,
        persona,
        pipeline,
        model,
        remote,
        lanes,
        extraContext,
      ),
    runPr: (
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
      kind: 'review' | 'iterate',
      engine: string,
      persona?: string,
      pipeline?: string,
      model?: string,
      remote?: unknown,
    ) => ipcRenderer.invoke('agents:run-pr', pr, kind, engine, persona, pipeline, model, remote),
    runs: () => ipcRenderer.invoke('agents:runs'),
    rerun: (runId: string) => ipcRenderer.invoke('agents:rerun', runId),
    cancel: (runId: string) => ipcRenderer.invoke('agents:cancel', runId),
    removeWorktree: (runId: string) => ipcRenderer.invoke('agents:remove-worktree', runId),
    onStatus: (cb: (run: unknown) => void) => {
      const h = (_e: unknown, run: unknown) => cb(run)
      ipcRenderer.on('agent:status', h)
      return () => ipcRenderer.removeListener('agent:status', h)
    },
    onOutput: (cb: (p: unknown) => void) => {
      const h = (_e: unknown, p: unknown) => cb(p)
      ipcRenderer.on('agent:output', h)
      return () => ipcRenderer.removeListener('agent:output', h)
    },
  },

  // global, directory-backed memory agents
  persistentAgents: {
    list: () => ipcRenderer.invoke('persistent-agents:list'),
    get: (id: string) => ipcRenderer.invoke('persistent-agents:get', id),
    save: (input: unknown) => ipcRenderer.invoke('persistent-agents:save', input),
    remove: (id: string) => ipcRenderer.invoke('persistent-agents:remove', id),
    updateFile: (id: string, file: string, body: string) =>
      ipcRenderer.invoke('persistent-agents:update-file', id, file, body),
    launchPrompt: (id: string, task: string, repoRoot?: string, engine?: string, model?: string) =>
      ipcRenderer.invoke('persistent-agents:launch-prompt', id, task, repoRoot, engine, model),
    run: (id: string, task: string, engine?: string, model?: string) =>
      ipcRenderer.invoke('persistent-agents:run', id, task, engine, model),
    design: (text: string, engine: string, model?: string) =>
      ipcRenderer.invoke('persistent-agents:design', text, engine, model),
    files: {
      list: (id: string, rel: string) =>
        ipcRenderer.invoke('persistent-agents:files-list', id, rel),
      read: (id: string, rel: string) =>
        ipcRenderer.invoke('persistent-agents:files-read', id, rel),
      write: (id: string, rel: string, content: string) =>
        ipcRenderer.invoke('persistent-agents:files-write', id, rel, content),
      create: (id: string, rel: string, dir: boolean) =>
        ipcRenderer.invoke('persistent-agents:files-create', id, rel, dir),
      del: (id: string, rel: string) =>
        ipcRenderer.invoke('persistent-agents:files-delete', id, rel),
    },
    artifacts: {
      list: (id: string) => ipcRenderer.invoke('persistent-agents:artifacts-list', id),
      read: (id: string, rel: string) =>
        ipcRenderer.invoke('persistent-agents:artifacts-read', id, rel),
    },
  },

  // scheduled (cron) agent runs
  schedules: {
    list: () => ipcRenderer.invoke('schedules:list'),
    save: (input: unknown) => ipcRenderer.invoke('schedules:save', input),
    remove: (id: string) => ipcRenderer.invoke('schedules:remove', id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('schedules:toggle', id, enabled),
    runNow: (id: string, hostId?: string) => ipcRenderer.invoke('schedules:run-now', id, hostId),
    runs: (id?: string) => ipcRenderer.invoke('schedules:runs', id),
    runLog: (runId: string) => ipcRenderer.invoke('schedules:run-log', runId),
    reconcile: () => ipcRenderer.invoke('schedules:reconcile'),
    removeAll: () => ipcRenderer.invoke('schedules:remove-all'),
    disabledList: () => ipcRenderer.invoke('schedules:disabled-list'),
    disabledToggle: (id: string, disabled: boolean) =>
      ipcRenderer.invoke('schedules:disabled-toggle', id, disabled),
    disabledAll: (disabled: boolean) => ipcRenderer.invoke('schedules:disabled-all', disabled),
    design: (text: string, engine: string) => ipcRenderer.invoke('schedules:design', text, engine),
  },
  listeners: {
    status: () => ipcRenderer.invoke('listeners:status'),
    process: () => ipcRenderer.invoke('listeners:process'),
    toggle: (enabled: boolean) => ipcRenderer.invoke('listeners:toggle', enabled),
    openDir: () => ipcRenderer.invoke('listeners:open-dir'),
  },
  hitl: {
    list: () => ipcRenderer.invoke('hitl:list'),
    remoteAll: () => ipcRenderer.invoke('hitl:remote-all'),
    file: (item: unknown) => ipcRenderer.invoke('hitl:file', item),
    resolve: (id: string, resolved?: boolean, hostId?: string) =>
      ipcRenderer.invoke('hitl:resolve', id, resolved, hostId),
    remove: (id: string, hostId?: string) => ipcRenderer.invoke('hitl:remove', id, hostId),
  },
  factory: {
    health: () => ipcRenderer.invoke('factory:health'),
    start: (engine: string) => ipcRenderer.invoke('factory:start', engine),
  },

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
  firstPrompt: (sessionId: string) => ipcRenderer.invoke('data:first-prompt', sessionId),
  harnessTdd: () => ipcRenderer.invoke('data:harness-tdd'),
  usage: () => ipcRenderer.invoke('data:usage'),
  gitStatus: () => ipcRenderer.invoke('data:git-status'),
  sessionTasks: () => ipcRenderer.invoke('data:session-tasks'),
  meta: () => ipcRenderer.invoke('data:meta'),

  // command widgets (declarative / per-repo)
  listCommandWidgets: () => ipcRenderer.invoke('widgets:list'),
  runCommand: (command: string) => ipcRenderer.invoke('widgets:run', command),

  // custom tabs (declarative full-screen views / per-repo)
  listCustomTabs: (cwd?: string) => ipcRenderer.invoke('tabs:list', cwd),
  runTabView: (command: string, cwd?: string) => ipcRenderer.invoke('tabs:run', command, cwd),

  // scratch workspace dir (throwaway, repo-less sessions)
  scratchDir: () => ipcRenderer.invoke('scratch:dir'),

  // tabs: repo context + tickets / MRs
  tabContext: () => ipcRenderer.invoke('tab:context'),
  tickets: {
    list: () => ipcRenderer.invoke('tickets:list'),
    get: (slug: string) => ipcRenderer.invoke('tickets:get', slug),
    providerGet: () => ipcRenderer.invoke('tickets:provider-get'),
    providerSave: (cfg: unknown) => ipcRenderer.invoke('tickets:provider-save', cfg),
    providerTest: (cfg: unknown, smoke?: boolean) =>
      ipcRenderer.invoke('tickets:provider-test', cfg, smoke),
    linearTeams: (cfg?: unknown) => ipcRenderer.invoke('tickets:linear-teams', cfg),
    openInObsidian: (slug: string) => ipcRenderer.invoke('tickets:open-in-obsidian', slug),
    create: (input: unknown) => ipcRenderer.invoke('tickets:create', input),
    recommendAgent: (input: unknown) => ipcRenderer.invoke('tickets:recommend-agent', input),
    update: (slug: string, patch: unknown) => ipcRenderer.invoke('tickets:update', slug, patch),
    spawn: (text: string, engine: string, model?: string, remote?: unknown) =>
      ipcRenderer.invoke('tickets:spawn', text, engine, model, remote),
  },
  docs: {
    list: () => ipcRenderer.invoke('docs:list'),
    get: (relPath: string) => ipcRenderer.invoke('docs:get', relPath),
  },
  projectSessions: () => ipcRenderer.invoke('sessions:project-list'),
  getProjectSession: (slug: string) => ipcRenderer.invoke('sessions:project-get', slug),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  listMrs: () => ipcRenderer.invoke('mrs:list'),
  getMr: (iid: number) => ipcRenderer.invoke('mrs:get', iid),
  getMrDiff: (iid: number) => ipcRenderer.invoke('mrs:diff', iid),
  getWorkingDiff: () => ipcRenderer.invoke('git:working-diff'),
  getWorkingStructuralDiff: (path: string, width?: number) =>
    ipcRenderer.invoke('git:working-structural-diff', path, width),
  getStructuralDiff: (iid: number, path: string, width?: number) =>
    ipcRenderer.invoke('mrs:structural-diff', iid, path, width),
  difftAvailable: () => ipcRenderer.invoke('difft:available'),
  getDigest: (iid: number, short?: string) => ipcRenderer.invoke('digest:get', iid, short),
  runDigest: (iid: number) => ipcRenderer.invoke('digest:run', iid),
  digestStatus: (iid: number) => ipcRenderer.invoke('digest:status', iid),
  onDigestStatus: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('digest:status', h)
    return () => ipcRenderer.removeListener('digest:status', h)
  },
  getMrCi: (iid: number) => ipcRenderer.invoke('mrs:ci', iid),
  mergeMr: (iid: number) => ipcRenderer.invoke('mrs:merge', iid),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  openInBrowser: (url: string) => ipcRenderer.invoke('open:in-browser', url),
  openInEditor: (path?: string) => ipcRenderer.invoke('open:in-editor', path),
  openConfigDir: () => ipcRenderer.invoke('open:config-dir'),
  mcpInstall: () => ipcRenderer.invoke('mcp:install'),
  workspace: {
    isBootstrapped: (repoRoot: string) => ipcRenderer.invoke('workspace:is-bootstrapped', repoRoot),
    bootstrap: (repoRoot: string) => ipcRenderer.invoke('workspace:bootstrap', repoRoot),
    search: (q: string, kinds?: string[]) => ipcRenderer.invoke('workspace:search', q, kinds),
  },
  release: {
    start: () => ipcRenderer.invoke('release:start'),
    tail: () => ipcRenderer.invoke('release:tail'),
    status: () => ipcRenderer.invoke('release:status'),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    onStatus: (cb: (r: unknown) => void) => {
      const h = (_e: unknown, r: unknown) => cb(r)
      ipcRenderer.on('update:status', h)
      return () => ipcRenderer.removeListener('update:status', h)
    },
  },
  harnessStatus: () => ipcRenderer.invoke('harness:status'),
  budgets: {
    get: () => ipcRenderer.invoke('budgets:get'),
    setDaily: (usd: number) => ipcRenderer.invoke('budgets:setDaily', usd),
    setAgent: (agentId: string, usd: number) =>
      ipcRenderer.invoke('budgets:setAgent', agentId, usd),
    override: (durationMs: number) => ipcRenderer.invoke('budgets:override', durationMs),
    gate: (agentId?: string) => ipcRenderer.invoke('budgets:gate', agentId),
  },
  bg: {
    list: () => ipcRenderer.invoke('bg:list'),
    get: (id: string) => ipcRenderer.invoke('bg:get', id),
    log: (id: string) => ipcRenderer.invoke('bg:log', id),
    spawn: (input: {
      repoRoot: string
      prompt: string
      engine?: 'claude' | 'codex' | 'cursor'
      model?: string
    }) => ipcRenderer.invoke('bg:spawn', input),
    cancel: (id: string) => ipcRenderer.invoke('bg:cancel', id),
  },
  loops: {
    list: () => ipcRenderer.invoke('loops:list'),
    get: (id: string) => ipcRenderer.invoke('loops:get', id),
    state: (id: string) => ipcRenderer.invoke('loops:state', id),
    create: (input: {
      repoRoot: string
      goal: string
      mode?: 'headless' | 'paired' | 'single'
      engine?: 'claude' | 'codex' | 'cursor' | 'hermes'
      model?: string
      maxIterations?: number
    }) => ipcRenderer.invoke('loops:create', input),
    step: (id: string) => ipcRenderer.invoke('loops:step', id),
    restart: (id: string) => ipcRenderer.invoke('loops:restart', id),
    stop: (id: string) => ipcRenderer.invoke('loops:stop', id),
  },
  observability: {
    summary: (range: string = 'today') => ipcRenderer.invoke('observability:summary', range),
    byAgent: (range: string = 'week') => ipcRenderer.invoke('observability:byAgent', range),
    daily: (days: number = 7) => ipcRenderer.invoke('observability:daily', days),
    runs: (limit: number = 100) => ipcRenderer.invoke('observability:runs', limit),
    models: () => ipcRenderer.invoke('observability:models'),
    indexStatus: () => ipcRenderer.invoke('observability:index-status'),
    rebuildIndex: (limit: number = 240) => ipcRenderer.invoke('observability:index-rebuild', limit),
    indexQuery: (query: string, arg?: string) =>
      ipcRenderer.invoke('observability:index-query', query, arg),
  },
  agentview: {
    snapshot: (limit: number = 120) => ipcRenderer.invoke('agentview:snapshot', limit),
    session: (sessionId: string) => ipcRenderer.invoke('agentview:session', sessionId),
    toolCall: (sessionId: string, callId: string) =>
      ipcRenderer.invoke('agentview:tool-call', sessionId, callId),
    transcriptWindow: (sessionId: string, centerLine: number = 0, radius: number = 24) =>
      ipcRenderer.invoke('agentview:transcript-window', sessionId, centerLine, radius),
  },
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  // Electron 32+ removed File.path — resolve a dropped file's absolute path
  // from the bridge, where webUtils is available. Empty string if unavailable.
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  // Write the current clipboard image (if any) to a temp PNG and return its
  // absolute path, or null when the clipboard holds no image.
  clipboardImageToFile: (): Promise<string | null> => ipcRenderer.invoke('clipboard:imageToFile'),

  notes: {
    read: (scope: 'repo' | 'global') => ipcRenderer.invoke('notes:read', scope),
    write: (scope: 'repo' | 'global', content: string) =>
      ipcRenderer.invoke('notes:write', scope, content),
    folderList: (id: string, rel: string) => ipcRenderer.invoke('notes:folder-list', id, rel),
    folderRead: (id: string, rel: string) => ipcRenderer.invoke('notes:folder-read', id, rel),
    folderWrite: (id: string, rel: string, content: string) =>
      ipcRenderer.invoke('notes:folder-write', id, rel, content),
  },
  knowledge: {
    read: (scope: 'repo' | 'global') => ipcRenderer.invoke('knowledge:read', scope),
    write: (scope: 'repo' | 'global', kb: unknown) =>
      ipcRenderer.invoke('knowledge:write', scope, kb),
    preview: (url: string) => ipcRenderer.invoke('knowledge:preview', url),
    ragStatus: (scope: 'repo' | 'global', item: unknown) =>
      ipcRenderer.invoke('knowledge:rag-status', scope, item),
    ragReindex: (scope: 'repo' | 'global', item: unknown, fullRebuild?: boolean) =>
      ipcRenderer.invoke('knowledge:rag-reindex', scope, item, fullRebuild),
    ragAddDocument: (scope: 'repo' | 'global', item: unknown, content: string, filepath?: string) =>
      ipcRenderer.invoke('knowledge:rag-add-document', scope, item, content, filepath),
    ragAddUrl: (scope: 'repo' | 'global', item: unknown, url: string, title?: string) =>
      ipcRenderer.invoke('knowledge:rag-add-url', scope, item, url, title),
    ragSearch: (scope: 'repo' | 'global', item: unknown, query: string) =>
      ipcRenderer.invoke('knowledge:rag-search', scope, item, query),
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
  workflow: {
    list: (rel: string) => ipcRenderer.invoke('workflow:list', rel),
    read: (rel: string) => ipcRenderer.invoke('workflow:read', rel),
    write: (rel: string, content: string) => ipcRenderer.invoke('workflow:write', rel, content),
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
