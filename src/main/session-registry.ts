// The pty session REGISTRY (ticket 91): the live sessions map, active-key
// tracking, session lifecycle (start/stop/setActive/kill-all), the per-engine
// spawn (local pty or ssh), and the active-transcript watcher. Owns the state
// index.ts's remaining handlers consume via the exported accessors. The one
// renderer seam is bindSessionSender — the module never touches the window.

import * as pty from 'node-pty'
import { type Engine } from './agents'
import { getTicket, updateTicket } from './backlog'
import { appendSessionRunLog, beginSessionRun, finalizeSessionRun } from './cron-runs'
import { findSessionFile, lastAssistantText } from './data'
import { buildEngineLaunch } from './engine-launch'
import { engineInitialPromptArgs, engineSupportsLaunchSeed } from './engine-seed'
import { emitActivity } from './events'
import { registerLoopSession, unregisterLoopSession } from './loop-listener'
import { isSafeSshTarget, remoteCommandForEngine } from './remote'
import { repoForCwd, repoRootOf } from './repo'
import { createEpochRegistry } from './session-epoch'
import {
  engineDefaultModel,
  engineDefaultEffort,
  enginePath,
  openAICompatBaseUrl,
  readSettings,
  resolvedOpenAICompatKey,
  resolvedOpenRouterKey,
  type DaemonCfg,
  type RemotePlatform,
} from './settings'
import { processSpawnCwd } from './spawn-cwd'
import { statuslineSettingsArg } from './statusline'
import { obsidianRepoVault } from './ticket-provider'
import { repoStateEnv } from './repo-state'
import { configPath } from './config-dir'
import { createLocalWorkspaceDaemon, createSshWorkspaceDaemon } from './workspace-daemon'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

let send: (channel: string, ...args: unknown[]) => void = () => {}
/** Bind the renderer sender (index.ts's window-guarded send). */
export function bindSessionSender(fn: (channel: string, ...args: unknown[]) => void): void {
  send = fn
}

const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'

export const activeSessionKey = (): string => activeKey

// One window now hosts MANY sessions, each its own PTY, keyed by a renderer-
// generated tab key. Data IPC reads the *active* session; PTY IPC is routed by
// key so every (even backgrounded) terminal keeps streaming.
export type SessionEngine = Engine | 'local'
export type RemoteSession = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemotePlatform
  daemon?: DaemonCfg
}
export type Pinned = {
  sessionId: string
  cwd: string
  mode: '' | 'new' | 'resume'
  name: string
  engine: SessionEngine
  remote?: RemoteSession
}
export const sessions = new Map<string, { pty: pty.IPty; pinned: Pinned }>()
let activeKey = ''

// Deps for the paired-loop listener (always-on channel between a loop's two live
// sessions). Kept here where the pty registry + transcript lookup live.
export const loopListenerDeps = {
  writeToSession: (k: string, d: string): boolean => {
    const s = sessions.get(k)
    if (!s) return false
    s.pty.write(d)
    return true
  },
  sessionIdOf: (k: string): string | undefined => sessions.get(k)?.pinned.sessionId,
  lastAssistantText: (sid: string): string => {
    const f = findSessionFile(sid)
    return f ? lastAssistantText(f) : ''
  },
}
export const cur = (): Pinned =>
  sessions.get(activeKey)?.pinned ?? {
    sessionId: '',
    cwd: '',
    mode: '',
    name: '',
    engine: 'claude',
  }
export const curRemote = () => cur().remote
export function requestedRemote(input: unknown): RemoteSession | undefined {
  if (
    !input ||
    typeof input !== 'object' ||
    !('sshTarget' in input) ||
    typeof input.sshTarget !== 'string'
  )
    return undefined
  return input as RemoteSession
}
function sshPathBasename(cwdOrRoot: string): string {
  const rest = cwdOrRoot.replace(/^ssh:\/\//, '')
  const slash = rest.indexOf('/')
  const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
  return (
    remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() ||
    (slash >= 0 ? rest.slice(0, slash) : rest)
  )
}
export const repoLabelFor = (cwdOrRoot: string) =>
  cwdOrRoot.startsWith('ssh://')
    ? sshPathBasename(cwdOrRoot)
    : repoForCwd(cwdOrRoot)?.path || basename(repoRootOf(cwdOrRoot) || cwdOrRoot || '')

export type StartOpts = {
  mode: 'new' | 'resume'
  engine?: SessionEngine
  /** Per-session model override → passed as --model. Falls back to the engine's default. */
  model?: string
  /** Per-session reasoning-effort override. Falls back to the engine's
   *  configured default; dropped for engines without an effort control. */
  effort?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: RemoteSession
  /** Live-paired loop linkage — set on the two sessions of a paired loop. */
  loopId?: string
  loopRole?: 'driver' | 'worker'
  /** Which harness runs an `openrouter` session (default 'codex'). */
  openrouterHarness?: 'codex' | 'hermes'
  cols: number
  rows: number
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

export function displayRemoteCwd(remote: RemoteSession, cwd: string): string {
  const target = remote.label || remote.sshTarget
  const path = cwd || '~'
  return `ssh://${target}${path.startsWith('/') ? path : `/${path}`}`
}

function daemonForRemote(remote: RemoteSession, displayCwd?: string) {
  return createSshWorkspaceDaemon(remote, displayCwd || displayRemoteCwd(remote, remote.cwd || '~'))
}

export function activeDaemon() {
  const pinned = cur()
  return pinned.remote
    ? daemonForRemote(pinned.remote, pinned.cwd)
    : createLocalWorkspaceDaemon(pinned.cwd)
}

export function daemonForRequest(input: unknown) {
  const remote = requestedRemote(input)
  return remote ? daemonForRemote(remote) : activeDaemon()
}

function displaySessionName(cwd: string, fallback = 'session') {
  return repoLabelFor(cwd) || basename(cwd) || fallback
}

export function remoteFromHostId(hostId: string, cwd?: string): RemoteSession | null {
  const host = readSettings().remoteHosts.find((h) => h.id === hostId)
  if (!host) return null
  return {
    hostId: host.id,
    label: host.label,
    sshTarget: host.sshTarget,
    cwd: cwd || host.defaultCwd || host.daemon.projectsDir || '~',
    platform: host.platform,
    daemon: host.daemon,
  }
}

// Pre-accept Claude Code's workspace-trust dialog for a directory, so an
// unattended phone spawn's seeded prompt isn't swallowed by it. Claude records
// trust in ~/.claude.json under projects[dir].hasTrustDialogAccepted; choosing to
// spawn there IS the trust decision. Best-effort — on any failure the trust
// dialog simply remains (the pre-existing behavior).
function pretrustClaudeProject(dir: string): void {
  try {
    const file = join(homedir(), '.claude.json')
    if (!existsSync(file)) return
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as {
      projects?: Record<string, { hasTrustDialogAccepted?: boolean }>
    }
    if (!cfg.projects || typeof cfg.projects !== 'object') cfg.projects = {}
    const entry = cfg.projects[dir] || {}
    if (entry.hasTrustDialogAccepted === true) return // already trusted — don't churn the file
    entry.hasTrustDialogAccepted = true
    cfg.projects[dir] = entry
    // Atomic write: Claude Code also writes ~/.claude.json frequently, so write
    // a temp file and rename it into place — a rename is atomic, so a concurrent
    // reader/writer never sees a half-written config (worst case a lost update,
    // which just re-shows the trust dialog — the harmless fallback).
    const tmp = `${file}.tm-${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(cfg, null, 2))
    renameSync(tmp, file)
  } catch {
    /* best-effort */
  }
}

// Restart-under-the-same-key generation counter. `startSession` on a live key
// kills the old pty, but node-pty still delivers that pty's `onExit` — and the
// old closure captures `key`, so it fired `pty:exit` against the BRAND NEW
// session, marking a fresh terminal as exited and un-pairing it from its loop.
// Each start takes an epoch; a stale closure sees its epoch superseded and does
// nothing.
const sessionEpochs = createEpochRegistry()

export function startSession(key: string, opts: StartOpts) {
  try {
    sessions.get(key)?.pty.kill()
  } catch {
    /* already dead — the restart must still proceed */
  }
  const epoch = sessionEpochs.next(key)
  const isCurrentEpoch = () => sessionEpochs.isCurrent(key, epoch)

  const remote = opts.remote?.sshTarget ? opts.remote : undefined
  const cwd = remote ? remote.cwd || opts.cwd || '' : processSpawnCwd(opts.cwd || homedir())
  const displayCwd = remote ? displayRemoteCwd(remote, cwd) : cwd
  const engine = opts.engine || 'claude'
  // Per-session pick (opts.model) wins; else the engine's configured default.
  const defaultModel =
    engine !== 'local'
      ? opts.model ||
        remote?.daemon?.engines?.[engine]?.defaultModel ||
        (!remote ? engineDefaultModel(engine) : '')
      : ''
  // Same per-session-pick-then-engine-default ladder as the model above.
  const defaultEffort =
    engine !== 'local'
      ? opts.effort ||
        remote?.daemon?.engines?.[engine]?.defaultEffort ||
        (!remote ? engineDefaultEffort(engine) : '')
      : ''
  const { sessionId, args: launchArgs } = buildEngineLaunch({
    engine,
    mode: opts.mode,
    sessionId: opts.sessionId,
    name: opts.name,
    model: defaultModel,
    effort: defaultEffort || undefined,
    openrouterHarness: opts.openrouterHarness,
    openAICompatBaseUrl: engine === 'openai-compat' ? openAICompatBaseUrl() : undefined,
  })
  const args = [...launchArgs]
  // For interactive OpenRouter/openai-compat the binary is the harness (codex/
  // hermes), not the one-shot or-agent.
  const openrouterLaunchBin =
    engine === 'openrouter'
      ? enginePath((opts.openrouterHarness || 'codex') === 'hermes' ? 'hermes' : 'codex')
      : engine === 'openai-compat'
        ? enginePath('codex')
        : undefined
  const remoteEnginePath =
    remote && engine !== 'local' ? remote.daemon?.engines?.[engine]?.path : undefined
  const repoRoot = remote ? '' : repoRootOf(cwd)
  const repoLabel = repoLabelFor(displayCwd)
  const startedAt = Date.now()

  // Wire Claude sessions to the status-line shim (zero-API usage + context).
  if (engine === 'claude' && !remote) args.push('--settings', statuslineSettingsArg())

  // Seed the FIRST prompt as a launch argument instead of pasting it into the
  // booted TUI after a readiness heuristic (see engine-seed.ts) — deterministic,
  // conversational, and provider-agnostic. Local + new sessions only; the
  // renderer skips its paste path when `seeded` comes back true.
  let seeded = false
  if (opts.mode === 'new' && opts.initialInput && !remote && engineSupportsLaunchSeed(engine)) {
    if (engine === 'claude') pretrustClaudeProject(cwd)
    args.push(...engineInitialPromptArgs(engine, opts.initialInput, opts.openrouterHarness))
    seeded = true
  }

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: process.env.TERM_PROGRAM || 'TerMinal',
    CLICOLOR: '1',
    GT_TERMINAL_SESSION_KEY: key,
    GT_TERMINAL_SESSION_ID: sessionId,
    GT_TERMINAL_CWD: displayCwd,
  } as Record<string, string>
  delete env.NO_COLOR
  // Obsidian-provider repos: expose the vault so a session's native file tools
  // can browse tickets directly (no MCP needed). Local only.
  if (repoRoot) {
    const ov = obsidianRepoVault(repoRoot)
    if (ov) {
      env.OBSIDIAN_VAULT_PATH = ov.vaultPath
      env.OBSIDIAN_TICKETS_DIR = ov.ticketsDir
    }
    // Workflow state lives in a per-project sidecar, not the repo. Agents write
    // some artifacts by hand (a review .md, a report), so they need the resolved
    // paths — a prompt or skill that hardcodes `.TerMinal/reviews/` would put the
    // artifact back into a repo shared with collaborators.
    Object.assign(env, repoStateEnv(repoRoot))
  }
  // The same bin dir the agent runner prepends. Skills document `tm-state-dir`
  // as the fallback whenever the vars above are absent (a sub-shell, a nested
  // tool call), so that fallback has to resolve in an interactive session too —
  // it previously resolved nowhere at all.
  env.PATH = `${configPath('bin')}:${process.env.PATH || ''}`
  // OpenRouter (either harness) and Hermes bill through OpenRouter — inject the
  // sealed key so the interactive session authenticates (mirrors the agent runner).
  if (engine === 'openrouter' || engine === 'hermes') {
    const orKey = resolvedOpenRouterKey()
    if (orKey) env.OPENROUTER_API_KEY = orKey
  }
  // Self-hosted endpoint: codex reads the key via the inline provider's
  // env_key=OPENAI_API_KEY. 'none' placeholder for keyless local servers.
  if (engine === 'openai-compat') env.OPENAI_API_KEY = resolvedOpenAICompatKey() || 'none'
  // Strip inherited Claude Code session-context markers. If TerMinal itself was
  // launched from inside a Claude Code session (e.g. `claude` in the terminal
  // that ran it), its env carries CLAUDE_CODE_CHILD_SESSION=1 + the parent's
  // CLAUDE_CODE_SESSION_ID. Leaking those into a session we spawn makes the new
  // `claude` believe it's a nested child — the native binary then does NOT
  // persist a top-level transcript to ~/.claude/projects or append to
  // history.jsonl, so the session never shows up in the Resume picker (and
  // can't be --resumed). Each spawned session must be a fresh top-level session.
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_CODE_')) delete env[k]
  }
  delete env.CLAUDECODE

  if (remote && !isSafeSshTarget(remote.sshTarget)) {
    throw new Error(`refusing to ssh to unsafe target: ${JSON.stringify(remote.sshTarget)}`)
  }
  const proc = remote
    ? pty.spawn(
        'ssh',
        ['-tt', remote.sshTarget, remoteCommandForEngine(engine, args, cwd, remoteEnginePath)],
        {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd: homedir(),
          env,
        },
      )
    : engine === 'local'
      ? pty.spawn(LOGIN_SHELL, ['-l'], {
          name: 'xterm-256color',
          cols: opts.cols || 80,
          rows: opts.rows || 30,
          cwd,
          env,
        })
      : pty.spawn(
          LOGIN_SHELL,
          ['-l', '-c', [openrouterLaunchBin || enginePath(engine), ...args].map(shq).join(' ')],
          {
            name: 'xterm-256color',
            cols: opts.cols || 80,
            rows: opts.rows || 30,
            cwd,
            env,
          },
        )
  try {
    beginSessionRun({
      id: sessionId,
      source: 'session',
      agentId: opts.ticketSlug ? 'ticket-terminal' : 'terminal-session',
      agentTitle: opts.ticketSlug
        ? `Ticket terminal · ${opts.ticketSlug}`
        : opts.name || displaySessionName(displayCwd),
      engine,
      status: 'running',
      startedAt,
      repoRoot,
      repoLabel,
      branch: '',
      worktree: displayCwd,
      sessionId,
      remote: !!remote,
      ticketSlug: opts.ticketSlug,
    })
  } catch {
    /* session logs are best-effort */
  }
  if (opts.ticketSlug && repoRoot) {
    updateTicket(repoRoot, opts.ticketSlug, {
      run: {
        id: sessionId,
        source: 'session',
        sessionId,
        startedAt: new Date(startedAt).toISOString(),
        status: 'running',
      },
    })
  }

  proc.onData((d) => {
    send('pty:data', key, d)
    appendSessionRunLog(sessionId, d)
  })
  proc.onExit(({ exitCode }) => {
    // A superseded session's exit must not touch the live one that replaced it.
    if (!isCurrentEpoch()) return
    send('pty:exit', key, exitCode)
    unregisterLoopSession(key)
    const status = exitCode === 0 ? 'done' : 'failed'
    const endedAt = Date.now()
    finalizeSessionRun(sessionId, {
      status,
      endedAt,
      exitCode: exitCode ?? 0,
      error: exitCode === 0 ? undefined : `exit ${exitCode ?? 0}`,
    })
    if (opts.ticketSlug && repoRoot) {
      const t = getTicket(repoRoot, opts.ticketSlug)
      if (t?.run?.id === sessionId) {
        updateTicket(repoRoot, opts.ticketSlug, {
          run: { id: sessionId, source: 'session', sessionId, startedAt: t.run.startedAt, status },
        })
      }
    }
    emitActivity(
      {
        kind: exitCode === 0 ? 'session-end' : 'error',
        title: `${opts.name || displaySessionName(displayCwd)} · ${engine} · exited`,
        detail: `exit ${exitCode ?? 0} · ${displayCwd.replace(homedir(), '~')}`,
        repo: repoLabel,
        repoRoot,
        sessionId,
        runId: sessionId,
        runSource: 'session',
      },
      { notify: exitCode !== 0 },
    )
  })

  sessions.set(key, {
    pty: proc,
    pinned: { sessionId, cwd: displayCwd, mode: opts.mode, name: opts.name || '', engine, remote },
  })
  if (opts.loopId && (opts.loopRole === 'driver' || opts.loopRole === 'worker'))
    registerLoopSession(key, opts.loopId, opts.loopRole)
  activeKey = key
  watchSession()
  emitActivity({
    kind: 'session-start',
    title: `${opts.name || displaySessionName(displayCwd)} · ${remote ? 'remote · ' : ''}${engine} · ${opts.mode === 'resume' ? 'resumed' : 'started'}`,
    detail: displayCwd.replace(homedir(), '~'),
    repo: repoLabel,
    repoRoot,
    sessionId,
    runId: sessionId,
    runSource: 'session',
  })
  return { sessionId, cwd: displayCwd, remote, seeded }
}

/** Kill every session pty. Guarded PER SESSION: the identical call in
 *  `stopSession` was already wrapped, but this loop wasn't — so one dead pty
 *  threw and every session after it was never killed. */
export function killAllSessionPtys(): void {
  for (const s of sessions.values()) {
    try {
      s.pty.kill()
    } catch {
      /* already gone — keep going */
    }
  }
  sessions.clear()
  sessionEpochs.clear()
}

export function setActiveSession(key: string) {
  if (sessions.has(key)) {
    activeKey = key
    watchSession()
  }
}

export function stopSession(key: string) {
  const s = sessions.get(key)
  if (s) {
    try {
      s.pty.kill()
    } catch {
      /* already gone */
    }
    sessions.delete(key)
    // Retire the epoch too, so this pty's late onExit can't fire against a
    // session started under the same key a moment later.
    sessionEpochs.forget(key)
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
/** Stop the active-transcript watcher (window-all-closed teardown). */
export function stopWatchSession(): void {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
}

export function watchSession() {
  if (watchTimer) clearInterval(watchTimer)
  watchedFile = ''
  lastMtime = 0
  watchTimer = setInterval(() => {
    if (cur().remote) return
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
