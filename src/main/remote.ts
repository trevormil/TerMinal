import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readSettings, type RemoteHost } from './settings'
import type { Ticket, NewTicket, TicketPatch } from './backlog'
import type { NewTicketComment } from './ticket-provider'
import type { MrDetail, MrListResult } from './mrs'
import type { Entry, ReadResult, SearchHit, SearchOptions } from './files'
import type { DocsTree } from './docs'
import type { GitStatus } from './repo'
import type { CiInfo } from './forge'
import type { WorkspaceSearchKind, WorkspaceSearchResponse } from './workspace-search'
import type { Agent, AgentRun } from './agents'
import type { Schedule } from './schedules'
import type { HitlItem } from './hitl'
import type { CronRun, UnifiedRun } from './cron-runs'
import type { ProjectSession } from './sessions'
import type { NotesScope } from './notes'
import type { Engine } from './agents'

export type RemoteSessionRef = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemoteHost['platform']
  daemon?: RemoteHost['daemon']
}
export type RemoteRunStartInput = {
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
  steps: { label: string; prompt: string }[]
  inPlace?: boolean
  prRef?: { iid: number; sourceBranch: string }
  worktreesDir?: string
  enginePath?: string
  scheduleId?: string
  contextPreamble?: boolean
}
export type RemoteDirEntry = { name: string; path: string; dir: true }
export type RemoteDirList = {
  cwd: string
  parent: string
  entries: RemoteDirEntry[]
  error?: string
}
export type RemoteScaffoldResult = { ok: boolean; path?: string; error?: string }
export type RemoteProjectsDirValidation =
  | { ok: true; dir: string }
  | {
      ok: false
      reason: 'is-repo' | 'error'
      dir: string
      suggestedParent?: string
      message: string
    }
export type RemoteBootstrapStatus = {
  state: 'full' | 'partial' | 'none'
  bootstrapped: boolean
  missing: string[]
  message: string
}

export type RemoteProbe = {
  cwd: string
  repoRoot: string
  repoPath: string
  repoHost: string
  forgeKind: 'github' | 'gitlab'
  forgeLabel: 'PR' | 'MR'
  forgeSym: '#' | '!'
  hasBacklog: boolean
  hasDocs: boolean
  hasSessions: boolean
  hasAgents: boolean
  engines: Record<string, string>
  tools: Record<string, string>
}

export const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

// An ssh destination is passed as a bare positional argv element to `ssh`. Any
// value beginning with `-` is parsed as an ssh OPTION (e.g. `-oProxyCommand=…`,
// which ssh executes LOCALLY via /bin/sh at connect time — arbitrary local RCE).
// Reject leading-dash, empty/whitespace-only, and control-char targets before
// they ever reach an ssh argv position. Mirrors the leading-dash guards the repo
// already applies to git refs (validTemplateRepo, template.ts).
export function isSafeSshTarget(target: unknown): target is string {
  if (typeof target !== 'string') return false
  const t = target.trim()
  return t.length > 0 && !t.startsWith('-') && !/[\0\r\n]/.test(target)
}

// The host-side helper script. It used to live here as a 260-line String.raw
// literal shipped via node -e — real code that eslint and prettier never saw,
// reimplementing tested local modules and then drifting untested (ticket 91).
// It is now a real lintable .cjs file; the new URL(..., import.meta.url)
// pattern makes Vite emit it as a build asset, and bun test reads it straight
// from the source tree.
export const REMOTE_SCRIPT = readFileSync(
  fileURLToPath(new URL('./remote-host-script.cjs', import.meta.url)),
  'utf8',
)

function remoteEnvCommand(inner: string, cwd?: string): string {
  const path =
    'export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"; ' +
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; '
  const cd =
    cwd?.trim() && cwd.trim() !== '~'
      ? `cd -- ${cwd.trim().startsWith('~/') ? `~/${shq(cwd.trim().slice(2))}` : shq(cwd.trim())}; `
      : ''
  return `bash -lc ${shq(path + cd + inner)}`
}

export function remoteCommandForEngine(
  engine: string,
  args: string[],
  cwd?: string,
  overridePath?: string,
): string {
  const bin =
    engine === 'local'
      ? '"${SHELL:-/bin/bash}"'
      : overridePath?.trim() || (engine === 'cursor' ? 'cursor-agent' : engine)
  const renderedBin = bin.startsWith('~/') ? `"$HOME"/${shq(bin.slice(2))}` : shq(bin)
  const cmd =
    engine === 'local' ? `exec ${bin} -l` : `exec ${[renderedBin, ...args.map(shq)].join(' ')}`
  return remoteEnvCommand('export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1; ' + cmd, cwd)
}

function remoteJson<T>(remote: RemoteSessionRef, input: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!isSafeSshTarget(remote.sshTarget)) {
      return reject(
        new Error(`refusing to ssh to unsafe target: ${JSON.stringify(remote.sshTarget)}`),
      )
    }
    const payload = JSON.stringify({ cwd: remote.cwd || '~', ...input })
    const inner = `node -e ${shq(REMOTE_SCRIPT)} ${shq(payload)}`
    execFile(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        remote.sshTarget,
        remoteEnvCommand(inner, remote.cwd),
      ],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || 'ssh failed').trim()))
        try {
          const parsed = JSON.parse(stdout || 'null')
          if (parsed?._remoteError) return reject(new Error(parsed._remoteError))
          resolve(parsed as T)
        } catch {
          reject(new Error(`remote returned non-JSON: ${(stdout || stderr || '').slice(0, 300)}`))
        }
      },
    )
  })
}

export const remoteProbe = (remote: RemoteSessionRef) =>
  remoteJson<RemoteProbe>(remote, { op: 'probe' })
export const remoteGitStatus = (remote: RemoteSessionRef) =>
  remoteJson<GitStatus>(remote, { op: 'gitStatus' })
export const remoteTickets = {
  list: (remote: RemoteSessionRef) => remoteJson<Ticket[]>(remote, { op: 'tickets.list' }),
  get: (remote: RemoteSessionRef, slug: string) =>
    remoteJson<Ticket | null>(remote, { op: 'tickets.get', slug }),
  create: (remote: RemoteSessionRef, ticket: NewTicket) =>
    remoteJson<Ticket>(remote, { op: 'tickets.create', ticket }),
  update: (remote: RemoteSessionRef, slug: string, patch: TicketPatch) =>
    remoteJson<boolean>(remote, { op: 'tickets.update', slug, patch }),
  comment: (remote: RemoteSessionRef, slug: string, comment: NewTicketComment) =>
    remoteJson<boolean>(remote, { op: 'tickets.comment', slug, comment }),
}
export const remoteMrs = {
  list: (remote: RemoteSessionRef) => remoteJson<MrListResult>(remote, { op: 'mrs.list' }),
  get: (remote: RemoteSessionRef, iid: number) =>
    remoteJson<MrDetail | null>(remote, { op: 'mrs.get', iid }),
  diff: (remote: RemoteSessionRef, iid: number) =>
    remoteJson<string>(remote, { op: 'mrs.diff', iid }),
  ci: (remote: RemoteSessionRef, iid: number) =>
    remoteJson<CiInfo | null>(remote, { op: 'mrs.ci', iid }),
  merge: (remote: RemoteSessionRef, iid: number) =>
    remoteJson<{ ok: boolean; error?: string }>(remote, { op: 'mrs.merge', iid }),
}
export const remoteFiles = {
  list: (remote: RemoteSessionRef, rel: string) =>
    remoteJson<Entry[]>(remote, { op: 'files.list', rel }),
  read: (remote: RemoteSessionRef, rel: string) =>
    remoteJson<ReadResult>(remote, { op: 'files.read', rel }),
  write: (remote: RemoteSessionRef, rel: string, content: string) =>
    remoteJson<boolean>(remote, { op: 'files.write', rel, content }),
  search: (remote: RemoteSessionRef, q: string, opts?: SearchOptions) =>
    remoteJson<SearchHit[]>(remote, { op: 'files.search', q, opts }),
  create: (remote: RemoteSessionRef, rel: string, dir: boolean) =>
    remoteJson<boolean>(remote, { op: 'files.create', rel, dir }),
  rename: (remote: RemoteSessionRef, from: string, to: string) =>
    remoteJson<boolean>(remote, { op: 'files.rename', from, to }),
  del: (remote: RemoteSessionRef, rel: string) =>
    remoteJson<boolean>(remote, { op: 'files.delete', rel }),
}
export const remoteDocs = {
  list: (remote: RemoteSessionRef) => remoteJson<DocsTree>(remote, { op: 'docs.list' }),
  get: (remote: RemoteSessionRef, relPath: string) =>
    remoteJson<string>(remote, { op: 'docs.get', relPath }),
}
export const remoteAgents = {
  list: (remote: RemoteSessionRef) => remoteJson<Agent[]>(remote, { op: 'agents.list' }),
  script: (remote: RemoteSessionRef, id: string) =>
    remoteJson<{ path: string; body: string } | null>(remote, { op: 'agents.script', id }),
}
export const remoteSchedules = {
  list: (remote: RemoteSessionRef) => remoteJson<Schedule[]>(remote, { op: 'schedules.list' }),
  save: (remote: RemoteSessionRef, schedule: Schedule) =>
    remoteJson<{ ok: true; id: string }>(remote, { op: 'schedules.save', schedule }),
  remove: (remote: RemoteSessionRef, id: string) =>
    remoteJson<boolean>(remote, { op: 'schedules.remove', id }),
  toggle: (remote: RemoteSessionRef, id: string, enabled: boolean) =>
    remoteJson<boolean>(remote, { op: 'schedules.toggle', id, enabled }),
  runNow: (
    remote: RemoteSessionRef,
    id: string,
    opts?: { enginePath?: string; worktreesDir?: string },
  ) =>
    remoteJson<AgentRun | { error: string }>(remote, {
      op: 'schedules.runNow',
      id,
      worktreesDir: opts?.worktreesDir ?? remote.daemon?.worktreesDir,
      enginePath: opts?.enginePath,
    }),
  runs: (remote: RemoteSessionRef, id?: string) =>
    remoteJson<CronRun[]>(remote, { op: 'schedules.runs', id }),
  runLog: (remote: RemoteSessionRef, runId: string) =>
    remoteJson<string>(remote, { op: 'schedules.runLog', runId }),
}
export const remoteHitl = {
  list: (remote: RemoteSessionRef) => remoteJson<HitlItem[]>(remote, { op: 'hitl.list' }),
  resolve: (remote: RemoteSessionRef, id: string, resolved: boolean) =>
    remoteJson<boolean>(remote, { op: 'hitl.resolve', id, resolved }),
  remove: (remote: RemoteSessionRef, id: string) =>
    remoteJson<boolean>(remote, { op: 'hitl.remove', id }),
  markRead: (remote: RemoteSessionRef, ids: string[], read = true) =>
    remoteJson<number>(remote, { op: 'hitl.markRead', ids, read }),
}
export const remoteRuns = {
  all: (remote: RemoteSessionRef) => remoteJson<UnifiedRun[]>(remote, { op: 'runs.all' }),
  log: (remote: RemoteSessionRef, runId: string) =>
    remoteJson<string>(remote, { op: 'runs.log', runId }),
  cancel: (remote: RemoteSessionRef, id: string) =>
    remoteJson<boolean>(remote, { op: 'runs.cancel', id }),
  start: (remote: RemoteSessionRef, run: RemoteRunStartInput) =>
    remoteJson<AgentRun | { error: string }>(remote, {
      op: 'runs.start',
      run: {
        ...run,
        worktreesDir: run.worktreesDir ?? remote.daemon?.worktreesDir,
        enginePath: run.enginePath ?? remote.daemon?.engines?.[run.engine]?.path,
        contextPreamble: run.contextPreamble ?? readSettings().inbox.agentContextPreamble,
      },
    }),
}
export const remoteSessions = {
  list: (remote: RemoteSessionRef) => remoteJson<ProjectSession[]>(remote, { op: 'sessions.list' }),
  get: (remote: RemoteSessionRef, slug: string) =>
    remoteJson<ProjectSession | null>(remote, { op: 'sessions.get', slug }),
}
export const remoteNotes = {
  read: (remote: RemoteSessionRef, scope: NotesScope) =>
    remoteJson<string>(remote, { op: 'notes.read', scope }),
  write: (remote: RemoteSessionRef, scope: NotesScope, content: string) =>
    remoteJson<boolean>(remote, { op: 'notes.write', scope, content }),
}
export const remoteDirs = {
  list: (remote: RemoteSessionRef, path?: string) =>
    remoteJson<RemoteDirList>(remote, { op: 'dirs.list', path }),
}
export const remoteSettings = {
  validateProjectsDir: (remote: RemoteSessionRef, dir: string) =>
    remoteJson<RemoteProjectsDirValidation>(remote, { op: 'settings.validateProjectsDir', dir }),
}
export const remoteProject = {
  scaffold: (remote: RemoteSessionRef, name: string, parentDir: string, templateRepo?: string) =>
    remoteJson<RemoteScaffoldResult>(remote, {
      op: 'project.scaffold',
      name,
      parentDir,
      templateRepo,
    }),
  bootstrapStatus: (remote: RemoteSessionRef) =>
    remoteJson<RemoteBootstrapStatus>(remote, { op: 'workspace.bootstrapStatus' }),
  bootstrap: (remote: RemoteSessionRef, templateRepo?: string) =>
    remoteJson<{ ok: true } | { error: string }>(remote, {
      op: 'workspace.bootstrap',
      templateRepo,
    }),
}
export const remoteWorkspaceSearch = (
  remote: RemoteSessionRef,
  q: string,
  kinds?: WorkspaceSearchKind[],
) => remoteJson<WorkspaceSearchResponse>(remote, { op: 'workspace.search', q, kinds })
