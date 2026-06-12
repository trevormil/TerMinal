import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { NewTicket, Ticket, TicketPatch } from './backlog'
import { listCiJobs, listCiRuns, fetchCiLog, type CiJobsResult, type CiListResult, type CiLogResult } from './ci'
import { listDocs, readDoc, type DocsTree } from './docs'
import { listDir, readFile, writeFile, searchRepo, createEntry, renameEntry, removeEntry, type Entry, type ReadResult, type SearchHit } from './files'
import { forgeFor, type CiInfo } from './forge'
import { listMrs, getMr, getMrDiff, getDigest, getMrCi, mergeMr, type MrDetail, type MrListResult, type DigestArtifact } from './mrs'
import { startDigest, digestStatus as readDigestStatus, type DigestRunState } from './digest-run'
import { readNotes, writeNotes, type NotesScope } from './notes'
import { repoForCwd, repoRootOf, gitStatus, type GitStatus } from './repo'
import { listProjectSessions, getProjectSession, hasSessions as repoHasSessions, type ProjectSession } from './sessions'
import { listSkills, type SkillInfo } from './skills'
import { workspaceSearch, type WorkspaceSearchKind, type WorkspaceSearchResponse } from './workspace-search'
import { hasAgents as repoHasAgents } from './agents'
import { hasProjectArea } from './project-layout'
import { createRepoTicket, getRepoTicket, listRepoTickets, repoTicketProvider, updateRepoTicket, type TicketProviderKind } from './ticket-provider'
import {
  remoteCi,
  remoteDocs,
  remoteFiles,
  remoteGitStatus,
  remoteMrs,
  remoteNotes,
  remoteProbe,
  remoteSessions,
  remoteTickets,
  remoteWorkspaceSearch,
  type RemoteProbe,
  type RemoteSessionRef,
} from './remote'

export type DaemonKind = 'local' | 'ssh'

export type DaemonContext = {
  cwd: string
  sessionId: string
  repoRoot: string
  repoPath: string
  repoHost: string
  forgeKind: 'github' | 'gitlab'
  forgeLabel: 'PR' | 'MR'
  forgeSym: '#' | '!'
  hasBacklog: boolean
  ticketProvider: TicketProviderKind
  ticketProviderLabel: string
  hasSessions: boolean
  hasAgents: boolean
  remote?: true
  remoteHostId?: string
  remoteLabel?: string
  remoteSshTarget?: string
  remotePlatform?: RemoteSessionRef['platform']
  remoteDaemon?: RemoteSessionRef['daemon']
  remoteSession?: RemoteSessionRef
  capabilities?: Record<string, boolean>
}

export type WorkspaceDaemon = {
  kind: DaemonKind
  cwd: string
  remote?: RemoteSessionRef
  repoRoot(): string
  filesRoot(): string
  repoLabel(): string
  context(sessionId: string): Promise<DaemonContext> | DaemonContext
  gitStatus(): Promise<GitStatus> | GitStatus
  docsList(): Promise<DocsTree> | DocsTree
  docsGet(relPath: string): Promise<string> | string
  sessionsList(): Promise<ProjectSession[]> | ProjectSession[]
  sessionGet(slug: string): Promise<ProjectSession | null> | ProjectSession | null
  ticketsList(): Promise<Ticket[]> | Ticket[]
  ticketGet(slug: string): Promise<Ticket | null> | Ticket | null
  ticketCreate(input: NewTicket): Promise<Ticket> | Ticket
  ticketUpdate(slug: string, patch: TicketPatch): Promise<boolean> | boolean
  skillsList(): Promise<SkillInfo[]> | SkillInfo[]
  mrsList(): Promise<MrListResult> | MrListResult
  mrGet(iid: number): Promise<MrDetail | null> | MrDetail | null
  mrDiff(iid: number): Promise<string> | string
  digestGet(iid: number, short?: string): Promise<DigestArtifact | null> | DigestArtifact | null
  digestRun(iid: number): Promise<{ ok: boolean; error?: string }>
  digestRunStatus(iid: number): DigestRunState | null
  mrCi(iid: number): Promise<CiInfo | null> | CiInfo | null
  mrMerge(iid: number): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
  ciList(limit?: number): Promise<CiListResult>
  ciJobs(runId: string): Promise<CiJobsResult>
  ciLog(jobId: string): Promise<CiLogResult>
  notesRead(scope: NotesScope): Promise<string> | string
  notesWrite(scope: NotesScope, content: string): Promise<boolean> | boolean
  filesList(rel: string): Promise<Entry[]> | Entry[]
  filesRead(rel: string): Promise<ReadResult> | ReadResult
  filesWrite(rel: string, content: string): Promise<boolean> | boolean
  filesSearch(q: string): Promise<SearchHit[]>
  filesCreate(rel: string, dir: boolean): Promise<boolean> | boolean
  filesRename(from: string, to: string): Promise<boolean> | boolean
  filesDelete(rel: string): Promise<boolean> | boolean
  search(q: string, kinds?: WorkspaceSearchKind[]): Promise<WorkspaceSearchResponse>
}

function sshPathBasename(cwdOrRoot: string): string {
  const rest = cwdOrRoot.replace(/^ssh:\/\//, '')
  const slash = rest.indexOf('/')
  const remotePath = slash >= 0 ? rest.slice(slash + 1) : ''
  return remotePath.replace(/\/$/, '').split('/').filter(Boolean).pop() || (slash >= 0 ? rest.slice(0, slash) : rest)
}

export function repoLabelForDaemonPath(cwdOrRoot: string): string {
  return cwdOrRoot.startsWith('ssh://') ? sshPathBasename(cwdOrRoot) : repoForCwd(cwdOrRoot)?.path || basename(repoRootOf(cwdOrRoot) || cwdOrRoot || '')
}

function remoteCapabilities(): Record<string, boolean> {
  return {
    terminal: true,
    tickets: true,
    mrs: true,
    agents: true,
    runs: true,
    schedules: true,
    ci: true,
    files: true,
    docs: true,
    sessions: true,
    notes: true,
    reports: true,
    browser: true,
    activity: true,
    help: true,
  }
}

export function createLocalWorkspaceDaemon(cwd: string): WorkspaceDaemon {
  const currentCwd = cwd || homedir()
  const root = () => repoRootOf(currentCwd)
  const fileRoot = () => root() || currentCwd || homedir()
  return {
    kind: 'local',
    cwd: currentCwd,
    repoRoot: root,
    filesRoot: fileRoot,
    repoLabel: () => repoLabelForDaemonPath(root() || currentCwd),
    context: (sessionId: string) => {
      const repoRoot = root()
      const repo = repoForCwd(currentCwd)
      const forge = forgeFor(repoRoot)
      const ticketProvider = repoTicketProvider(repoRoot)
      return {
        cwd: currentCwd,
        sessionId,
        repoRoot,
        repoPath: repo?.path || '',
        repoHost: repo?.host || '',
        forgeKind: forge.kind,
        forgeLabel: forge.label,
        forgeSym: forge.sym,
        hasBacklog: !!repoRoot && (hasProjectArea(repoRoot, 'backlog') || ticketProvider.kind !== 'local'),
        ticketProvider: ticketProvider.kind,
        ticketProviderLabel: ticketProvider.label,
        hasSessions: repoHasSessions(repoRoot),
        hasAgents: repoHasAgents(repoRoot),
      } as DaemonContext
    },
    gitStatus: () => gitStatus(currentCwd),
    docsList: () => listDocs(root() || ''),
    docsGet: (relPath: string) => readDoc(root() || '', relPath),
    sessionsList: () => listProjectSessions(root()),
    sessionGet: (slug: string) => getProjectSession(root(), slug),
    ticketsList: () => listRepoTickets(root()),
    ticketGet: (slug: string) => getRepoTicket(root(), slug),
    ticketCreate: (input: NewTicket) => createRepoTicket(root(), input),
    ticketUpdate: (slug: string, patch: TicketPatch) => updateRepoTicket(root(), slug, patch),
    skillsList: () => listSkills(root()),
    mrsList: () => listMrs(root()),
    mrGet: (iid: number) => getMr(root(), iid),
    mrDiff: (iid: number) => getMrDiff(root(), iid),
    digestGet: (iid: number, short?: string) => getDigest(root(), iid, short),
    digestRun: (iid: number) => startDigest(root(), iid),
    digestRunStatus: (iid: number) => readDigestStatus(root(), iid),
    mrCi: (iid: number) => getMrCi(root(), iid),
    mrMerge: (iid: number) => mergeMr(root(), iid),
    ciList: (limit?: number) => listCiRuns(root(), limit),
    ciJobs: (runId: string) => listCiJobs(root(), runId),
    ciLog: (jobId: string) => fetchCiLog(root(), jobId),
    notesRead: (scope: NotesScope) => readNotes(scope, root()),
    notesWrite: (scope: NotesScope, content: string) => writeNotes(scope, content, root()),
    filesList: (rel: string) => listDir(fileRoot(), rel || ''),
    filesRead: (rel: string) => readFile(fileRoot(), rel),
    filesWrite: (rel: string, content: string) => writeFile(fileRoot(), rel, content),
    filesSearch: (q: string) => searchRepo(fileRoot(), q),
    filesCreate: (rel: string, dir: boolean) => createEntry(fileRoot(), rel, dir),
    filesRename: (from: string, to: string) => renameEntry(fileRoot(), from, to),
    filesDelete: (rel: string) => removeEntry(fileRoot(), rel),
    search: (q: string, kinds?: WorkspaceSearchKind[]) => workspaceSearch(fileRoot(), q, kinds),
  }
}

export function createSshWorkspaceDaemon(remote: RemoteSessionRef, displayCwd: string): WorkspaceDaemon {
  const cwd = displayCwd || remote.cwd || ''
  const probe = () => remoteProbe(remote).catch(() => null)
  return {
    kind: 'ssh',
    cwd,
    remote,
    repoRoot: () => '',
    filesRoot: () => '',
    repoLabel: () => repoLabelForDaemonPath(cwd || remote.cwd || remote.sshTarget),
    context: async (sessionId: string) => {
      const p: RemoteProbe | null = await probe()
      return {
        cwd,
        sessionId,
        remote: true,
        remoteHostId: remote.hostId,
        remoteLabel: remote.label,
        remoteSshTarget: remote.sshTarget,
        remotePlatform: remote.platform,
        remoteDaemon: remote.daemon,
        remoteSession: remote,
        repoRoot: p?.repoRoot || '',
        repoPath: repoLabelForDaemonPath(cwd || remote.cwd || remote.sshTarget),
        repoHost: p?.repoHost || remote.sshTarget,
        forgeKind: p?.forgeKind || 'github',
        forgeLabel: p?.forgeLabel || 'PR',
        forgeSym: p?.forgeSym || '#',
        hasBacklog: !!p?.hasBacklog,
        ticketProvider: 'local',
        ticketProviderLabel: 'Local backlog',
        hasSessions: !!p?.hasSessions,
        hasAgents: true,
        capabilities: remoteCapabilities(),
      }
    },
    gitStatus: () => remoteGitStatus(remote),
    docsList: () => remoteDocs.list(remote),
    docsGet: (relPath: string) => remoteDocs.get(remote, relPath),
    sessionsList: () => remoteSessions.list(remote).catch(() => []),
    sessionGet: (slug: string) => remoteSessions.get(remote, slug).catch(() => null),
    ticketsList: () => remoteTickets.list(remote),
    ticketGet: (slug: string) => remoteTickets.get(remote, slug),
    ticketCreate: (input: NewTicket) => remoteTickets.create(remote, input),
    ticketUpdate: (slug: string, patch: TicketPatch) => remoteTickets.update(remote, slug, patch),
    skillsList: () => [],
    mrsList: () => remoteMrs.list(remote),
    mrGet: (iid: number) => remoteMrs.get(remote, iid),
    mrDiff: (iid: number) => remoteMrs.diff(remote, iid),
    digestGet: () => null, // digest reads local artifact files; not wired over ssh yet
    digestRun: () => Promise.resolve({ ok: false, error: 'digest not supported on remote workspaces yet' }),
    digestRunStatus: () => null,

    mrCi: (iid: number) => remoteMrs.ci(remote, iid),
    mrMerge: (iid: number) => remoteMrs.merge(remote, iid),
    ciList: (limit?: number) => remoteCi.list(remote, limit),
    ciJobs: (runId: string) => remoteCi.jobs(remote, runId),
    ciLog: (jobId: string) => remoteCi.log(remote, jobId),
    notesRead: (scope: NotesScope) => remoteNotes.read(remote, scope).catch(() => ''),
    notesWrite: (scope: NotesScope, content: string) => remoteNotes.write(remote, scope, content).catch(() => false),
    filesList: (rel: string) => remoteFiles.list(remote, rel || ''),
    filesRead: (rel: string) => remoteFiles.read(remote, rel),
    filesWrite: (rel: string, content: string) => remoteFiles.write(remote, rel, content),
    filesSearch: (q: string) => remoteFiles.search(remote, q),
    filesCreate: (rel: string, dir: boolean) => remoteFiles.create(remote, rel, dir),
    filesRename: (from: string, to: string) => remoteFiles.rename(remote, from, to),
    filesDelete: (rel: string) => remoteFiles.del(remote, rel),
    search: (q: string, kinds?: WorkspaceSearchKind[]) => remoteWorkspaceSearch(remote, q, kinds),
  }
}
