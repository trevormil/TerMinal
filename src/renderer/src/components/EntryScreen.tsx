import { useEffect, useState } from 'react'
import { X, FolderOpen, Plus, GitBranch, FolderGit2, SquareTerminal, RefreshCw, Server, ArrowUp, Home, Check } from 'lucide-react'
import type { Engine, RemoteDirList, RemoteHost, RemoteSession, SessionEngine, SessionMeta } from '../lib/types'
import { EngineLogo } from './EngineLogo'
import logo from '../assets/logo.png'

export type Choice = {
  mode: 'new' | 'resume'
  engine: SessionEngine
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  remote?: RemoteSession
}

function rel(ms: number): string {
  const s = (Date.now() - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const isRemotePath = (p: string) => p.startsWith('ssh://')
const pathLabel = (p: string) => {
  if (isRemotePath(p)) {
    const rest = p.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
    return remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() || (slash >= 0 ? rest.slice(0, slash) : rest)
  }
  return p.replace(/\/$/, '').split('/').pop() || p
}
const remoteDisplayPath = (p: string) => (p.startsWith('/home/') ? p.replace(/^\/home\/[^/]+/, '~') : p)
const underDir = (sessionCwd: string, dir: string) =>
  sessionCwd === dir || sessionCwd.startsWith(dir.replace(/\/$/, '') + '/')
const isAiEngine = (value: SessionEngine): value is Engine => value !== 'local'
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const SESSION_PAGE_SIZE = 50

export function EntryScreen({
  onChoose,
  onCancel,
  lockedCwd,
  lockedRemote,
}: {
  onChoose: (c: Choice) => void
  onCancel?: () => void
  /** When set, the EntryScreen is being opened inside an existing workspace to
   *  add a session — the repo is fixed, so the cwd picker and the scaffold/
   *  project-browser sections are hidden. Resume listing is auto-filtered to
   *  this repo. */
  lockedCwd?: string
  lockedRemote?: RemoteSession
}) {
  const [sessionsByEngine, setSessionsByEngine] = useState<Partial<Record<Engine, SessionMeta[]>>>({})
  const [loadingSessions, setLoadingSessions] = useState<Partial<Record<Engine, boolean>>>({})
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_PAGE_SIZE)
  const [cwd, setCwd] = useState(lockedRemote?.cwd || lockedCwd || '') // new-session target
  const [filterDir, setFilterDir] = useState(lockedCwd || '') // resume filter ('' = all)
  const [engine, setEngine] = useState<SessionEngine>('local')
  const [location, setLocation] = useState<'local' | 'remote'>(lockedRemote ? 'remote' : 'local')
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([])
  const [remoteHostId, setRemoteHostId] = useState(lockedRemote?.hostId || '')
  const [name, setName] = useState('')
  // "new project from template" scaffold form
  const [projName, setProjName] = useState('')
  const [projParent, setProjParent] = useState('')
  const [scaffoldBusy, setScaffoldBusy] = useState(false)
  const [scaffoldErr, setScaffoldErr] = useState('')
  const [defaultParent, setDefaultParent] = useState('') // configured projects dir ('' → ~)
  const [remoteListing, setRemoteListing] = useState<RemoteDirList | null>(null)
  const [remoteListingLoading, setRemoteListingLoading] = useState(false)
  const [remoteListingErr, setRemoteListingErr] = useState('')
  const parentLabel = defaultParent ? tilde(defaultParent) : '~'

  const pickParent = async () => {
    if (location === 'remote') {
      setProjParent(cwd || remoteListing?.cwd || '')
      return
    }
    const d = await window.gt.pickDir()
    if (d) setProjParent(d)
  }
  const createProject = async () => {
    if (!projName.trim() || scaffoldBusy) return
    setScaffoldBusy(true)
    setScaffoldErr('')
    const parent = location === 'remote' ? projParent || cwd || undefined : projParent || undefined
    const r =
      location === 'remote' && remoteHostId
        ? await window.gt.remoteScaffoldProject(remoteHostId, projName.trim(), parent)
        : await window.gt.scaffoldProject(projName.trim(), parent)
    setScaffoldBusy(false)
    if (r.ok && r.path) {
      if (location === 'remote') {
        const host = remoteHosts.find((h) => h.id === remoteHostId)
        if (!host) return setScaffoldErr('remote host not found')
        onChoose({
          mode: 'new',
          engine: engine === 'local' ? host.daemon.defaultEngine || 'claude' : engine,
          cwd: r.path,
          remote: {
            hostId: host.id,
            label: host.label || host.sshTarget,
            sshTarget: host.sshTarget,
            cwd: r.path,
            platform: host.platform,
            daemon: host.daemon,
          },
        })
      } else {
        onChoose({ mode: 'new', engine, cwd: r.path })
      }
    } else {
      setScaffoldErr(r.error || 'scaffold failed')
    }
  }

  useEffect(() => {
    window.gt.settings.get().then((s) => {
      setDefaultParent(s.projectsDir)
      setRemoteHosts(s.remoteHosts || [])
      if (!remoteHostId && s.remoteHosts?.[0]) setRemoteHostId(s.remoteHosts[0].id)
    })
  }, [])

  const loadEngineSessions = async (target?: Engine, force = false) => {
    const next = target ?? (isAiEngine(engine) ? engine : null)
    if (!next || loadingSessions[next] || (!force && sessionsByEngine[next])) return
    setLoadingSessions((cur) => ({ ...cur, [next]: true }))
    try {
      // Let the loading affordance paint before the main process starts walking
      // transcript files. Even with the picker scan optimized, large local
      // session archives can take a beat.
      await nextFrame()
      const loaded = await window.gt.listSessions(next)
      setSessionsByEngine((cur) => ({ ...cur, [next]: loaded }))
      if (!cwd && loaded[0]?.cwd) setCwd(loaded[0].cwd)
    } finally {
      setLoadingSessions((cur) => ({ ...cur, [next]: false }))
    }
  }

  const selectEngine = (next: SessionEngine) => {
    setEngine(next)
    setVisibleSessionCount(SESSION_PAGE_SIZE)
    if (isAiEngine(next)) loadEngineSessions(next)
  }
  const switchLocation = (next: 'local' | 'remote') => {
    setLocation(next)
    setFilterDir('')
    if (lockedCwd) return
    if (next === 'local') {
      setCwd('')
      setProjParent('')
      return
    }
    const host = remoteHosts.find((h) => h.id === remoteHostId) || remoteHosts[0]
    if (host) {
      setRemoteHostId(host.id)
      const nextCwd = host.defaultCwd || host.daemon.projectsDir || ''
      setCwd(nextCwd)
      setProjParent(nextCwd)
      if (engine === 'local') setEngine(host.daemon.defaultEngine || 'claude')
    } else {
      setCwd('')
      setProjParent('')
    }
  }

  useEffect(() => {
    setVisibleSessionCount(SESSION_PAGE_SIZE)
  }, [engine, filterDir])

  // selecting a folder targets the new session there AND filters resume to it
  const selectDir = (path: string) => {
    setCwd(path)
    setFilterDir(path)
  }
  const browse = async () => {
    const dir = await window.gt.pickDir()
    if (dir) selectDir(dir)
  }

  const canResume = isAiEngine(engine) && location === 'local' && !lockedRemote
  const sessions = canResume ? sessionsByEngine[engine] : undefined
  const shown = sessions ? (filterDir ? sessions.filter((s) => underDir(s.cwd, filterDir)) : sessions) : []
  const visibleShown = shown.slice(0, visibleSessionCount)
  const hiddenShown = Math.max(0, shown.length - visibleShown.length)
  const isLoadingThisEngine = canResume ? !!loadingSessions[engine] : false
  const remoteHost = lockedRemote
    ? {
        id: lockedRemote.hostId,
        label: lockedRemote.label,
        sshTarget: lockedRemote.sshTarget,
        defaultCwd: lockedRemote.cwd || '',
        platform: lockedRemote.platform || 'auto',
        daemon: lockedRemote.daemon,
      }
    : remoteHosts.find((h) => h.id === remoteHostId) || null
  const remoteCwd = cwd.trim() || remoteHost?.defaultCwd || remoteHost?.daemon?.projectsDir || ''

  const loadRemoteDir = async (path?: string, opts?: { select?: boolean }) => {
    if (!remoteHost) return
    const target = path || remoteCwd || '~'
    setRemoteListingLoading(true)
    setRemoteListingErr('')
    const r = await window.gt.remoteDirs(remoteHost.id, target)
    setRemoteListingLoading(false)
    setRemoteListing(r)
    if (r.error) {
      setRemoteListingErr(r.error)
      return
    }
    if (opts?.select) {
      setCwd(r.cwd)
      setProjParent(r.cwd)
    }
  }

  useEffect(() => {
    if (location !== 'remote' || !remoteHost) return
    setRemoteListing(null)
    setRemoteListingErr('')
    loadRemoteDir(remoteCwd || '~', { select: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, remoteHost?.id])

  const buildChoice = (): Choice => {
    const base = {
      mode: 'new' as const,
      engine,
      cwd: location === 'remote' ? remoteCwd : cwd.trim() || undefined,
      name: name.trim() || undefined,
    }
    if (location !== 'remote' || !remoteHost) return base
    return {
      ...base,
      remote: {
        hostId: remoteHost.id,
        label: remoteHost.label || remoteHost.sshTarget,
        sshTarget: remoteHost.sshTarget,
        cwd: remoteCwd,
        platform: remoteHost.platform,
        daemon: remoteHost.daemon,
      },
    }
  }
  const choiceFromRecent = (path: string): Choice => {
    if (!isRemotePath(path)) return { mode: 'new', engine, cwd: path }
    const rest = path.replace(/^ssh:\/\//, '')
    const slash = rest.indexOf('/')
    const target = slash >= 0 ? rest.slice(0, slash) : rest
    const remotePath = slash >= 0 ? '/' + rest.slice(slash + 1).replace(/^\/+/, '') : '~'
    const host = remoteHosts.find((h) => h.label === target || h.sshTarget === target || h.id === target)
    if (!host) return { mode: 'new', engine, cwd: path }
    const resolvedEngine = engine === 'local' ? host.daemon.defaultEngine || 'claude' : engine
    return {
      mode: 'new',
      engine: resolvedEngine,
      cwd: remotePath,
      remote: {
        hostId: host.id,
        label: host.label || host.sshTarget,
        sshTarget: host.sshTarget,
        cwd: remotePath,
        platform: host.platform,
        daemon: host.daemon,
      },
    }
  }
  const resumeCountLabel = sessions
    ? shown.length > visibleShown.length
      ? ` (${visibleShown.length}/${shown.length})`
      : ` (${shown.length})`
    : ''
  const projectParentLabel =
    location === 'remote'
      ? remoteDisplayPath(projParent || cwd || remoteCwd || '~')
      : projParent
        ? tilde(projParent)
        : parentLabel

  const sel =
    'rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <div className="mb-1 flex items-center gap-2.5">
          <img src={logo} alt="" draggable={false} className="h-9 w-9 rounded-lg" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">TerMinal</h1>
          <div className="flex-1" />
          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            >
              <X size={13} strokeWidth={2} />
              cancel
            </button>
          )}
        </div>
        <p className="mb-6 text-sm text-zinc-500">
          {lockedCwd ? (
            <>
              New session in{' '}
              <span className="font-mono text-zinc-300">{tilde(lockedCwd)}</span> — pick "Start"
              for a fresh session{lockedRemote ? '.' : ' or attach to a prior one below.'}
            </>
          ) : (
            <>
              Start Claude, Codex, Cursor, or a local shell. This window pins to one session so workspace
              tabs track the same repo.
            </>
          )}
        </p>

        {/* Recently closed workspaces. Click to re-open as a fresh session on
            that repo. Only shown for the "+ workspace" flow — inside a locked
            workspace the recents are irrelevant. */}
        {!lockedCwd &&
          (() => {
            let recents: string[] = []
            try {
              recents = JSON.parse(localStorage.getItem('gt.recentWorkspaces') || '[]')
            } catch {
              /* ignore */
            }
            recents = [...new Set(recents.filter((x) => typeof x === 'string'))].slice(0, 8)
            if (!recents.length) return null
            return (
              <div className="mb-4">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Recent
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recents.map((r) => (
                    <button
                      key={r}
                      onClick={() => onChoose(choiceFromRecent(r))}
                      title={r}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[12px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60"
                    >
                      {isRemotePath(r) ? <Server size={11} strokeWidth={2} className="text-[var(--gt-accent-2)]" /> : <FolderOpen size={11} strokeWidth={2} className="text-zinc-500" />}
                      <span>{pathLabel(r)}</span>
                      {isRemotePath(r) && <span className="rounded bg-[var(--gt-accent)]/15 px-1 text-[9px] uppercase tracking-wide text-[var(--gt-accent-2)]">ssh</span>}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

        {/* new project from template — hidden when adding inside an existing
            workspace (the repo is fixed) */}
        {!lockedCwd && (
        <div className="mb-4 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            <FolderGit2 size={13} strokeWidth={2} />
            New project from template
          </div>
          <div className="flex items-center gap-2">
            <input
              value={projName}
              onChange={(e) => {
                setProjName(e.target.value)
                setScaffoldErr('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="project-name"
              spellCheck={false}
              className={`${sel} min-w-0 flex-1 font-mono`}
            />
            <button
              onClick={pickParent}
              title="Choose parent directory"
              className={`${sel} inline-flex shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}
            >
              {location === 'remote' ? <Server size={13} strokeWidth={2} /> : <FolderOpen size={13} strokeWidth={2} />}
              {projectParentLabel}
            </button>
            <button
              onClick={createProject}
              disabled={!projName.trim() || scaffoldBusy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              <Plus size={14} strokeWidth={2.5} />
              {scaffoldBusy ? 'Creating…' : 'Create'}
            </button>
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Copies <span className="font-mono text-zinc-500">project-template</span> →{' '}
            <span className="font-mono text-zinc-500">
              {projectParentLabel}/{projName.trim() || 'name'}
            </span>
            , runs <span className="font-mono text-zinc-500">git init</span>, and opens a session there.
          </div>
          {scaffoldErr && <div className="mt-1 text-[11px] text-[var(--gt-red)]">{scaffoldErr}</div>}
        </div>
        )}

        {/* start new */}
        <div className="mb-6 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Start a new session
          </div>
          <div className="mb-2 grid grid-cols-4 gap-2">
            {(['local', 'claude', 'codex', 'cursor'] as SessionEngine[]).map((e) => (
              <button
                key={e}
                onClick={() => selectEngine(e)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${
                  engine === e
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                }`}
              >
                {e === 'local' ? <SquareTerminal size={14} strokeWidth={2} /> : <EngineLogo engine={e} size={14} />}
                {e}
              </button>
            ))}
          </div>
          {!lockedCwd && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => switchLocation('local')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] ${
                  location === 'local'
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                    : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                }`}
              >
                <FolderOpen size={13} strokeWidth={2} />
                <span className="flex flex-col items-start leading-tight">
                  <span>Local</span>
                  <span className="text-[9.5px] font-normal text-zinc-600">this Mac</span>
                </span>
              </button>
              <button
                onClick={() => switchLocation('remote')}
                disabled={remoteHosts.length === 0}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] ${
                  location === 'remote'
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                    : remoteHosts.length === 0
                      ? 'cursor-not-allowed border-[var(--gt-border)] bg-black/10 text-zinc-700'
                      : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                }`}
              >
                <Server size={13} strokeWidth={2} />
                <span className="flex flex-col items-start leading-tight">
                  <span>Remote SSH</span>
                  <span className="text-[9.5px] font-normal text-zinc-600">
                    {remoteHost ? remoteHost.label || remoteHost.sshTarget : 'host profile'}
                  </span>
                </span>
              </button>
            </div>
          )}
          {location === 'remote' && (
            <div className="mb-2 space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                <Server size={13} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
                <span className="font-semibold text-zinc-200">Remote daemon</span>
                <span className="truncate font-mono">{remoteHost?.sshTarget || 'no host selected'}</span>
                <span className="hidden text-zinc-600 sm:inline">
                  tabs read from this SSH workspace
                </span>
              </div>
              {lockedRemote ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] text-zinc-300">
                  <span>{lockedRemote.label || lockedRemote.sshTarget}</span>
                  <span className="font-mono text-zinc-600">{lockedRemote.sshTarget}</span>
                </div>
              ) : remoteHosts.length === 0 ? (
                <div className="text-[11px] text-zinc-600">Add remote hosts in Settings &gt; Remote hosts.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {remoteHosts.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        setRemoteHostId(h.id)
                        const nextCwd = h.defaultCwd || h.daemon.projectsDir || ''
                        setCwd(nextCwd)
                        setProjParent(nextCwd)
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                        remoteHostId === h.id
                          ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 text-zinc-100'
                          : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                      }`}
                    >
                      <Server size={11} strokeWidth={2} />
                      <span>{h.label || h.sshTarget}</span>
                      <span className="font-mono text-zinc-600">{h.sshTarget}</span>
                      <span className="rounded bg-white/5 px-1 text-[9px] uppercase tracking-wide text-zinc-600">
                        {h.platform}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-[var(--gt-border)] bg-black/20">
                <div className="flex items-center gap-1.5 border-b border-[var(--gt-border)] p-2">
                  <input
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadRemoteDir(cwd, { select: true })}
                    placeholder={remoteHost?.defaultCwd || '~ (remote home)'}
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[12px] text-zinc-200 outline-none placeholder:text-zinc-700"
                  />
                  <button
                    onClick={() => loadRemoteDir('~', { select: true })}
                    className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
                    title="Remote home"
                  >
                    <Home size={13} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => remoteListing?.parent && loadRemoteDir(remoteListing.parent, { select: true })}
                    disabled={!remoteListing?.parent}
                    className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200 disabled:opacity-35"
                    title="Parent folder"
                  >
                    <ArrowUp size={13} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => loadRemoteDir(cwd || remoteListing?.cwd || '~', { select: true })}
                    className="rounded-md border border-[var(--gt-border)] p-1.5 text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
                    title="Refresh"
                  >
                    <RefreshCw size={13} strokeWidth={2} className={remoteListingLoading ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => {
                      const selected = remoteListing?.cwd || cwd
                      setCwd(selected)
                      setProjParent(selected)
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1.5 text-[11px] text-zinc-100"
                  >
                    <Check size={12} strokeWidth={2.5} />
                    Use
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto p-1.5">
                  {remoteListingLoading && !remoteListing ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-zinc-600">
                      <RefreshCw size={12} strokeWidth={2} className="animate-spin" />
                      Loading folders…
                    </div>
                  ) : remoteListingErr ? (
                    <div className="px-2 py-3 text-[11px] text-[var(--gt-red)]">{remoteListingErr}</div>
                  ) : remoteListing && remoteListing.entries.length === 0 ? (
                    <div className="px-2 py-3 text-[11px] text-zinc-600">No child folders.</div>
                  ) : (
                    remoteListing?.entries.map((d) => (
                      <button
                        key={d.path}
                        onClick={() => loadRemoteDir(d.path, { select: true })}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/5"
                      >
                        <FolderOpen size={13} strokeWidth={2} className="shrink-0 text-zinc-500" />
                        <span className="truncate">{d.name}</span>
                        <span className="ml-auto truncate font-mono text-[10px] text-zinc-700">{remoteDisplayPath(d.path)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-zinc-600">
                <span className="font-mono">{remoteDisplayPath(remoteListing?.cwd || remoteCwd || '~')}</span>
                <span>drives Tickets, MRs, Agents, Runs, Schedules, Files, Docs, CI, and Search.</span>
              </div>
            </div>
          )}
          {!lockedCwd && location === 'local' && (
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={browse}
                className={`${sel} inline-flex shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}
              >
                <FolderOpen size={13} strokeWidth={2} />
                Folder
              </button>
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="~ (home)"
                spellCheck={false}
                className={`${sel} min-w-0 flex-1 font-mono`}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="session name (optional)"
              className={`${sel} min-w-0 flex-1`}
            />
            <button
              onClick={() => onChoose(buildChoice())}
              disabled={location === 'remote' && !remoteHost}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90"
            >
              <Plus size={14} strokeWidth={2.5} />
              New session
            </button>
          </div>
        </div>

        {canResume && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Resume {engine}{filterDir ? ` · ${filterDir.split('/').pop()}` : ''}{resumeCountLabel}
              </span>
              <button
                onClick={() => loadEngineSessions(undefined, true)}
                disabled={isLoadingThisEngine}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[11px] text-[var(--gt-accent-2)] hover:border-[var(--gt-accent)]/50 disabled:opacity-50"
              >
                <RefreshCw size={11} strokeWidth={2} className={isLoadingThisEngine ? 'animate-spin' : ''} />
                {sessions ? 'refresh' : 'load sessions'}
              </button>
              {filterDir && (
                <button
                  onClick={() => setFilterDir('')}
                  className="text-[11px] text-[var(--gt-accent-2)] hover:underline"
                >
                  show all
                </button>
              )}
            </div>
            {!sessions && !isLoadingThisEngine ? (
              <button
                onClick={() => loadEngineSessions()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-300"
              >
                <EngineLogo engine={engine} size={13} />
                Load prior {engine} sessions
              </button>
            ) : isLoadingThisEngine ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-[12px] text-zinc-500">
                <RefreshCw size={13} strokeWidth={2} className="animate-spin" />
                Scanning {engine} sessions…
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--gt-border)] p-6 text-center text-[12px] text-zinc-600">
                {filterDir ? 'No sessions for this folder — start a new one above.' : `No prior ${engine} sessions found.`}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleShown.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onChoose({ mode: 'resume', engine: s.engine, sessionId: s.id, cwd: s.cwd })}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 text-left hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-zinc-100">
                        {s.firstUserText || <span className="italic text-zinc-500">untitled session</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-zinc-500">
                        <EngineLogo engine={s.engine} size={10} />
                        <span className="font-mono">{tilde(s.cwd) || '~'}</span>
                        {s.gitBranch && (
                          <span className="inline-flex items-center gap-0.5 text-zinc-600">
                            <GitBranch size={11} strokeWidth={2} />
                            {s.gitBranch}
                          </span>
                        )}
                        <span className="text-zinc-600">· {s.turns} turns</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10.5px] text-zinc-500">
                      <div>{rel(s.mtime)}</div>
                      <div className="font-mono text-zinc-600">{s.id.slice(0, 8)}</div>
                    </div>
                  </button>
                ))}
                {hiddenShown > 0 && (
                  <button
                    onClick={() => setVisibleSessionCount((n) => n + SESSION_PAGE_SIZE)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--gt-border)] bg-black/10 p-3 text-[12px] text-zinc-500 hover:border-[var(--gt-accent)]/50 hover:text-zinc-300"
                  >
                    Load {Math.min(SESSION_PAGE_SIZE, hiddenShown)} more
                    <span className="text-zinc-700">· {hiddenShown} remaining</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
