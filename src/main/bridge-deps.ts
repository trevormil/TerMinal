// The bridge server's view of the app (ticket 91): every capability the phone
// can reach, assembled here instead of as a 455-line literal inside index.ts.
// The pty/session state stays in index.ts and is injected via ctx — this
// module knows how to serve the bridge, not how sessions are stored.

import { sanitizeLog } from '../shared/run-log/sanitize'
import { ensureIdentity, pairingPayload } from './bridge/identity'
import { registerDevice } from './bridge/push'
import { runLogAuthorized } from './bridge/run-auth'
import { tailscalePeerAllowed } from './bridge/tailscale'
import { listCiJobs, listCiRuns } from './ci'
import { configPath } from './config-dir'
import { describeSpec, nextRun } from './cron'
import { listAllRuns, readCronRunLog, readSessionRunLog, readSessionRunLogTail } from './cron-runs'
import { emitActivity, readActivity } from './events'
import { markHitlRead, readHitl, resolveHitl } from './hitl'
import { itemSeverity } from './hitl-severity'
import { readBgTaskLog } from './bg-tasks'
import { listRuns, readAgentRunLog } from './agent-run-store'
import { listMonitorsWithStatus } from './monitors'
import { remoteHitl, remoteRuns } from './remote'
import { collectRemoteHitl } from './remote-runs'
import {
  deleteRemoteSession,
  endRemoteSession,
  imagePath,
  listRemoteSessions,
  messageCount,
  postMessage,
  readMessages,
  readRemoteSession,
  registerRemoteSession,
  saveImage,
  stripAnsi,
} from './remote-sessions'
import { repoForCwd, repoRootOf } from './repo'
import { getSchedule, readSchedules } from './schedules'
import { readSettings, resolvedProjectsDir } from './settings'
import { commentOnRepoTicket, resolveHumanAuthor } from './ticket-provider'
import { createLocalWorkspaceDaemon } from './workspace-daemon'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type BridgeDeps, type BridgeText } from './bridge/server'
import { type RemoteSessionRef } from './remote'

export type BridgeDepsCtx = {
  /** Live desktop ptys — id/cwd for correlation, write() for reply delivery. */
  liveSessions(): { sessionId: string; cwd: string; write(data: string): void }[]
  cliSrcPath(): string
  remoteFromHostId(hostId: string): RemoteSessionRef | null
  hasWindow(): boolean
  /** Ask the renderer to open a terminal tab; false when no window exists. */
  openSessionInRenderer(payload: {
    cwd: string
    engine: string
    remoteId: string
    initialInput?: string
  }): boolean
}

export function createBridgeDeps(ctx: BridgeDepsCtx): BridgeDeps {
  // ---- mobile bridge (TerMinal Remote for iOS) --------------------------------
  // A second transport over the SAME live ptys the desktop drives — never a
  // parallel session store. Terminals only: a phone attached to a live agent can
  // ask it about tickets/PRs/CI itself, so the bridge grows no bespoke endpoints.
  /**
   * The first thing a phone-started session is told. It has to do three jobs:
   * adopt the thread that is already waiting for it, learn the reporting
   * contract, and get on with the work — with no human at the keyboard to
   * correct it.
   */
  /** Cap oversized text for the wire. Logs keep the TAIL (where failures are);
   *  diffs keep the head. */
  function capText(s: string, max: number, opts: { keepTail?: boolean } = {}): BridgeText {
    if (s.length <= max) return { text: s, truncated: false }
    return {
      text: opts.keepTail ? s.slice(s.length - max) : s.slice(0, max),
      truncated: true,
    }
  }

  /**
   * One run's log, routed the same way the runs:log IPC does — EXCEPT it never
   * falls back to the focused session's remote. A phone request carries its own
   * host on the run row; inheriting whatever terminal happens to be focused would
   * silently read a different machine's log.
   */
  /** The repo NAMES the bridge advertises (immediate subdirs of the projects dir).
   *  Used to authorize an opaque run id against the workspace boundary — the same
   *  set repos() exposes and workspaceRuns() filters by. */
  function advertisedRepoNames(): Set<string> {
    try {
      return new Set(readdirSync(resolvedProjectsDir()).filter((n) => !n.startsWith('.')))
    } catch {
      return new Set()
    }
  }

  function readRunLogFor(source: string, runId: string, hostId?: string): string | Promise<string> {
    const remote = hostId ? ctx.remoteFromHostId(hostId) : null
    if (remote) return remoteRuns.log(remote, runId).catch(() => '')
    if (source === 'cron') return readCronRunLog(runId)
    if (source === 'session') return readSessionRunLog(runId)
    if (source === 'bg') return readBgTaskLog(runId)
    return listRuns().find((r) => r.id === runId)?.output || readAgentRunLog(runId)
  }

  function spawnPrompt(remoteId: string, task?: string): string {
    // Absolute path to THIS app's terminal-cli, which always has the `remote`
    // subcommand. Bare `terminal-cli` isn't on an interactive session's PATH, and
    // the repo's own bin/ may be on a branch that predates `remote` — the agent
    // otherwise burns several turns guessing. Quote it in case the path has spaces.
    const cli = `"${ctx.cliSrcPath()}"`
    const lines = [
      `You were started from TerMinal Remote on a phone. There is no one at this Mac —`,
      `report through the phone, not the terminal.`,
      ``,
      `A remote thread is already registered for you. Adopt it, then use it`,
      `(use this exact path — bare terminal-cli is not on PATH):`,
      ``,
      `    ${cli} remote register --id ${remoteId} "<short title>"`,
      `    ${cli} remote post --id ${remoteId} "<update>"`,
      `    ${cli} remote ask  --id ${remoteId} "<question>"   # blocks for a reply`,
      ``,
      `Follow the remote-terminal skill for when to post vs ask. Post at real`,
      `checkpoints, not every command. Ask only at a genuine fork; otherwise pick`,
      `the safe default and say so in a post.`,
      ``,
      `This session stays live between turns. When you finish a task, post the result`,
      `and just stop — the human's next phone message is handed to you automatically`,
      `as your next instruction, so you do NOT need to keep an ask open to stay`,
      `reachable.`,
    ]
    if (task) lines.push(``, `Your task:`, ``, task)
    else
      lines.push(
        ``,
        `No task was given — post that you are ready and stop; wait for the first message.`,
      )
    return lines.join('\n')
  }

  // Harness-agnostic listener. Claude keeps its remote-check.sh Stop hook, which
  // parks INSIDE a turn and hands the phone message back as the block reason — but
  // that hook is Claude-only, so Codex/cursor/hermes finish a turn, idle at their
  // prompt, and never see the queued reply. For those engines the APP pushes the
  // reply straight into the live pty (bracketed paste + Enter) so the idle agent
  // receives it as its next instruction. Best-effort: no live pty → the reply
  // still sits in the log for a `terminal-cli remote` collect.
  function deliverReplyToPty(remoteId: string, text: string, images: string[]): void {
    try {
      const remote = readRemoteSession(remoteId)
      if (!remote || remote.engine === 'claude') return // claude: the Stop hook delivers
      const live = ctx.liveSessions()
      // Exact match on the app's own session id (agentSessionId === pinned.sessionId,
      // set for every engine now). cwd is ambiguous — two sessions can share a repo —
      // so only fall back to it when it resolves to EXACTLY one live session; never
      // guess and inject into the wrong one.
      let match = remote.agentSessionId
        ? live.find((s) => s.sessionId === remote.agentSessionId)
        : undefined
      if (!match && remote.cwd) {
        const inCwd = live.filter((s) => s.cwd === remote.cwd)
        if (inCwd.length === 1) match = inCwd[0]
      }
      if (!match) return
      const imageNote = images.length
        ? `\n\n[${images.length} image(s) attached — read them with: terminal-cli remote messages --id ${remoteId}]`
        : ''
      // A short reminder so the agent treats this as a phone message AND posts its
      // reply back — otherwise its answer only shows in the terminal, never on the
      // phone (the phone thread shows posts, not raw terminal output).
      const body =
        `[Phone message via TerMinal Remote — reply by posting: ` +
        `terminal-cli remote post --id ${remoteId} "<your reply>"]\n\n${text}${imageNote}`
      match.write(`\x1b[200~${body}\x1b[201~`)
      setTimeout(() => match.write('\r'), 80)
    } catch {
      /* best-effort — the log-collect path remains */
    }
  }

  return {
    // Only sessions that opted in via the remote-terminal skill. Nothing is
    // scraped from a pty, so this is identical for every engine.
    sessions: () =>
      listRemoteSessions().map((s) => ({
        id: s.id,
        title: s.title,
        repo: s.repo,
        branch: s.branch,
        engine: s.engine,
        status: s.status,
        question: s.question,
        lastSeenAt: s.lastSeenAt,
        messages: messageCount(s.id),
      })),
    messages: (id, opts) => readMessages(id, opts),
    // Always log the reply (phone history + the collect cursor). For engines
    // without a Claude-style Stop hook, ALSO push it into the live pty so the idle
    // agent actually receives it — otherwise Codex/cursor "don't listen".
    reply: (id, text, images) => {
      const ok = !!postMessage(id, 'user', text, images ?? [])
      if (ok) deliverReplyToPty(id, text, images ?? [])
      return ok
    },
    endRemote: (id) => !!endRemoteSession(id),
    deleteRemote: (id) => deleteRemoteSession(id),
    saveImage: (id, data, ext) => saveImage(id, data, ext),
    imagePath: (id, name) => imagePath(id, name),

    // Read-only terminal peek. Correlate the remote thread to a live desktop pty
    // the same way the desktop's "on phone" indicator does — engine session id
    // first, cwd as a fallback — then serve the tail of that pty's output log.
    remoteTerminal: (id) => {
      const remote = readRemoteSession(id)
      if (!remote) return null
      const live = ctx.liveSessions()
      const match =
        (remote.agentSessionId
          ? live.find((s) => s.sessionId === remote.agentSessionId)
          : undefined) ?? (remote.cwd ? live.find((s) => s.cwd === remote.cwd) : undefined)
      if (!match) return null
      const tail = readSessionRunLogTail(match.sessionId)
      return tail ? { text: stripAnsi(tail.text), updatedAt: tail.updatedAt } : null
    },

    // Local items plus every configured host's. An agent blocked on `tm` pages
    // nobody otherwise, which defeats the whole point of an AFK remote.
    hitl: async () => {
      // ALL local items (open + resolved), so the phone can show read/unread and
      // filter — capped newest-first so a long resolved history stays wire-cheap.
      const local = readHitl()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 200)
        .map((h) => ({
          id: h.id,
          title: h.title,
          detail: h.detail,
          action: h.action,
          repo: h.repo,
          source: h.source,
          createdAt: h.createdAt,
          severity: itemSeverity(h),
          status: h.status,
          readAt: h.readAt,
        }))
      const hosts = readSettings().remoteHosts.map((h) => ({ id: h.id, label: h.label }))
      if (!hosts.length) return local
      // Best-effort: an unreachable host contributes nothing, never a failure.
      const remote = await collectRemoteHitl(hosts, async (h) => {
        const ref = ctx.remoteFromHostId(h.id)
        return ref ? remoteHitl.list(ref) : []
      }).catch(() => null)
      const mapped = (remote?.items ?? [])
        .filter((h) => h.status === 'open')
        .map((h) => ({
          id: h.id,
          title: h.title,
          detail: h.detail,
          action: h.action,
          // Label which machine is blocked, or the queue is ambiguous.
          repo: h.hostLabel ? `${h.hostLabel} · ${h.repo || ''}`.trim() : h.repo,
          source: h.source,
          createdAt: h.createdAt,
          // Host blocks are always "look at me"; host read-state isn't tracked here.
          severity: itemSeverity(h),
          status: h.status ?? 'open',
          readAt: h.readAt,
        }))
      return [...local, ...mapped].sort((a, b) => b.createdAt - a.createdAt)
    },
    resolveHitl: (id, resolved) => resolveHitl(id, resolved),
    markHitlRead: (ids, read) => markHitlRead(ids, read),
    repos: () => {
      // Most recent activity per repo, so the phone can surface what you actually
      // work in instead of an alphabetical wall. Desktop pins/recents live in
      // renderer localStorage, which main can't read — this is derived from data
      // main owns (runs + registered sessions) and is honest on any machine.
      const lastUsed = new Map<string, number>()
      const bump = (root: string, at: number) => {
        if (!root) return
        if ((lastUsed.get(root) ?? 0) < at) lastUsed.set(root, at)
      }
      try {
        for (const r of listAllRuns()) bump(r.repoRoot, r.startedAt)
      } catch {
        /* runs unreadable — ordering just degrades to alphabetical */
      }
      try {
        for (const s of listRemoteSessions()) bump(repoRootOf(s.cwd) || s.cwd, s.lastSeenAt)
      } catch {
        /* same */
      }

      const base = resolvedProjectsDir()
      // Cheap CI-configured probe (no git call): the phone shows a CI tab only
      // when workflow files exist.
      const forgeOf = (p: string): string | undefined => {
        try {
          if (existsSync(join(p, '.github', 'workflows'))) return 'github'
          if (existsSync(join(p, '.gitlab-ci.yml'))) return 'gitlab'
        } catch {
          /* ignore */
        }
        return undefined
      }
      let repos: {
        name: string
        path: string
        lastUsedAt?: number
        scratch?: boolean
        forge?: string
      }[] = []
      try {
        repos = readdirSync(base)
          .filter((n) => !n.startsWith('.'))
          .map((n) => ({ name: n, path: join(base, n) }))
          .filter((d) => {
            try {
              return statSync(d.path).isDirectory()
            } catch {
              return false
            }
          })
          .map((d) => ({ ...d, lastUsedAt: lastUsed.get(d.path), forge: forgeOf(d.path) }))
          // Recently used first; everything else alphabetical behind it.
          .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
      } catch {
        repos = []
      }
      // The throwaway workspace always rides along, so a repo-less session is
      // one tap away exactly like the desktop's Scratch panel.
      const scratch = configPath('scratch')
      return [
        { name: 'Scratch', path: scratch, scratch: true, lastUsedAt: lastUsed.get(scratch) },
        ...repos,
      ]
    },

    // Monitors + latest state for the phone's Monitoring surface.
    monitors: () => listMonitorsWithStatus(),
    activity: () => readActivity(200),

    // Every engine the desktop can launch, labelled the way the desktop labels
    // them — the phone should never render a bare lowercase "codex". The Mac's
    // configured default leads because the phone preselects the first entry.
    engines: () => {
      const all = [
        { id: 'claude', label: 'Claude' },
        { id: 'codex', label: 'Codex' },
        { id: 'cursor', label: 'Cursor' },
        { id: 'openrouter', label: 'OpenRouter' },
        { id: 'hermes', label: 'Hermes' },
        { id: 'openai-compat', label: 'Self-hosted' },
        { id: 'local', label: 'Local' },
      ]
      const def = readSettings().defaultEngine
      return all.sort((a, b) => Number(b.id === def) - Number(a.id === def))
    },

    // Per-workspace read-only cockpit data. Each resolves a local daemon for the
    // requested repo path (the same machinery the desktop tabs use), then projects
    // to the compact shape the phone lists. Best-effort: a repo without tickets/a
    // gh auth issue returns an empty list rather than failing the request.
    workspaceTickets: async (repoPath) => {
      try {
        const tickets = await createLocalWorkspaceDaemon(repoPath).ticketsList()
        return tickets.map((t) => ({
          slug: t.slug,
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          type: t.type,
          hitl: t.hitl,
        }))
      } catch {
        return []
      }
    },
    workspacePrs: async (repoPath) => {
      try {
        const { mrs } = await createLocalWorkspaceDaemon(repoPath).mrsList()
        return mrs.map((m) => ({
          iid: m.iid,
          title: m.title,
          state: m.state,
          draft: m.draft,
          author: m.author,
          url: m.webUrl,
          labels: m.labels,
          verdict: m.review?.verdict,
          score: m.review?.overall ?? undefined,
        }))
      } catch {
        return []
      }
    },
    workspaceRuns: (repoPath) => {
      const root = repoRootOf(repoPath) || repoPath
      return listAllRuns()
        .filter((r) => r.repoRoot === root || r.repoLabel === basename(repoPath))
        .slice(0, 60)
        .map((r) => ({
          id: r.id,
          title: r.agentTitle,
          engine: r.engine,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          branch: r.branch,
          // Required to fetch the log — the store can't be derived from the id.
          source: r.source,
          hostId: r.hostId,
          // The outcome side-car listAllRuns() already joined. Without this the
          // phone's run-summary half renders nothing.
          summary: r.summary,
        }))
    },

    // ---- drill-downs: the full readable content behind a row ----------------
    workspaceTicket: async (repoPath, slug) => {
      try {
        const t = await createLocalWorkspaceDaemon(repoPath).ticketGet(slug)
        if (!t) return null
        return {
          slug: t.slug,
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          type: t.type,
          hitl: t.hitl,
          // The whole markdown body, plus acceptance criteria — which live
          // OUTSIDE the body and would otherwise be invisible on the phone.
          body: t.body || '',
          acceptance: t.acceptance,
          prs: t.prs,
          comments: t.comments,
        }
      } catch {
        return null
      }
    },
    // The phone's one ticket write: leave a note on a ticket an agent is
    // working, without opening the Mac.
    commentOnTicket: async (repoPath, slug, body) => {
      try {
        return await commentOnRepoTicket(repoPath, slug, {
          author: await resolveHumanAuthor(repoPath),
          kind: 'human',
          body,
        })
      } catch {
        return false
      }
    },
    workspacePr: async (repoPath, iid) => {
      try {
        const daemon = createLocalWorkspaceDaemon(repoPath)
        const [d, ci] = await Promise.all([
          daemon.mrGet(iid),
          Promise.resolve(daemon.mrCi(iid)).catch(() => null),
        ])
        if (!d) return null
        return {
          iid: d.iid,
          title: d.title,
          state: d.state,
          draft: d.draft,
          author: d.author,
          url: d.webUrl,
          // MrDetail carries no labels — those are a list-row field.
          labels: [],
          verdict: d.reviewMeta?.verdict,
          score: d.reviewMeta?.overall ?? undefined,
          description: d.description || '',
          branch: d.sourceBranch,
          testStatus: d.reviewMeta?.testStatus,
          riskTier: d.reviewMeta?.riskTier,
          reviewNotes: capText(d.reviewMd || '', 120_000).text,
          findings: (d.findings || []).slice(0, 60).map((f) => ({
            severity: f.severity,
            title: f.title,
            file: f.file,
            line: f.line,
            text: f.text || f.body,
          })),
          suggestions: (d.suggestions || []).slice(0, 60).map((f) => ({
            severity: f.severity,
            title: f.title,
            file: f.file,
            line: f.line,
            text: f.text || f.body,
          })),
          // Overall status plus any failing job names — the part worth reading
          // on a phone when CI is red.
          ci: ci
            ? [ci.status, ...ci.jobs.filter((j) => /fail|error/i.test(j.status)).map((j) => j.name)]
                .filter(Boolean)
                .join(' · ') || undefined
            : undefined,
        }
      } catch {
        return null
      }
    },
    workspacePrDiff: async (repoPath, iid) => {
      try {
        return capText(await createLocalWorkspaceDaemon(repoPath).mrDiff(iid), 400_000)
      } catch {
        return { text: '', truncated: false }
      }
    },
    // Logs come back whole and ANSI-laden with no pagination, so cap + strip here
    // rather than shipping megabytes of escape codes to a phone. Keep the TAIL —
    // that is where a failure is.
    workspaceRunLog: async (runId) => {
      try {
        // Authorize POSITIVELY: only serve when we can see the run AND it's a host
        // run or its repo is advertised. An id we can't find — aged out of the run
        // window or guessed — is refused, never a fall-through to the raw readers.
        const run = listAllRuns().find((r) => r.id === runId)
        if (!run || !runLogAuthorized(run, advertisedRepoNames())) {
          return { text: '', truncated: false }
        }
        // Read with the AUTHORIZED row's own store/host — never the phone's copy,
        // which could point the readers at a different log than we authorized.
        const raw = await Promise.resolve(readRunLogFor(run.source, runId, run.hostId))
        return capText(sanitizeLog(raw || ''), 200_000, { keepTail: true })
      } catch {
        return { text: '', truncated: false }
      }
    },
    workspaceSchedule: (repoPath, id) => {
      const s = getSchedule(id)
      const root = repoRootOf(repoPath) || repoPath
      // server.ts already fenced repoPath to the advertised set; also require the
      // schedule to actually belong to it, so one allowed repo's token can't read
      // another repo's schedule prompt by guessing its id.
      if (!s || !(s.repoRoot === root || s.repoLabel === basename(repoPath))) return null
      const now = Date.now()
      return {
        id: s.id,
        title: s.agentTitle,
        describe: describeSpec(s.spec),
        nextRun: nextRun(s.spec, now) ?? undefined,
        enabled: s.enabled,
        engine: s.engine,
        model: s.model,
        // The snapshot of the agent prompt this schedule actually runs — the
        // thing you'd want to read from your phone.
        prompt: s.prompt || '',
        host: s.host,
        runtime: s.runtime,
      }
    },
    workspaceSchedules: (repoPath) => {
      const root = repoRootOf(repoPath) || repoPath
      const now = Date.now()
      return readSchedules(now)
        .filter((s) => s.repoRoot === root || s.repoLabel === basename(repoPath))
        .map((s) => ({
          id: s.id,
          title: s.agentTitle,
          describe: describeSpec(s.spec),
          nextRun: nextRun(s.spec, now) ?? undefined,
          enabled: s.enabled,
        }))
    },
    // Native CI for the phone's per-workspace CI tab — the same run/job data the
    // desktop CI tab's Runs view uses.
    workspaceCi: (repoPath) => listCiRuns(repoRootOf(repoPath) || repoPath, 40),
    workspaceCiJobs: (repoPath, runId) => listCiJobs(repoRootOf(repoPath) || repoPath, runId),

    // Start a session from the phone. The remote thread is registered up front so
    // the phone can open it immediately, then the RENDERER is asked to open the
    // terminal — spawning the pty from main directly would leave an orphan with
    // no tab on the desktop, and would skip initialInput delivery entirely.
    spawn: ({ cwd, engine, task }) => {
      if (!ctx.hasWindow()) return { error: 'TerMinal is not running' }
      // The scratch workspace is app-owned and may not exist yet on a fresh
      // machine — create it on demand, exactly like the scratch:dir handler.
      if (cwd === configPath('scratch')) {
        try {
          mkdirSync(cwd, { recursive: true })
        } catch {
          /* already exists / race */
        }
      }
      const repo = repoForCwd(cwd)?.path || basename(repoRootOf(cwd) || cwd)
      const session = registerRemoteSession({
        title: task ? task.slice(0, 60) : `${repo} · from phone`,
        repo,
        cwd,
        engine: engine || readSettings().defaultEngine,
        origin: 'phone',
      })
      postMessage(
        session.id,
        'agent',
        `Starting a ${engine || readSettings().defaultEngine} session in ${repo}…`,
      )
      ctx.openSessionInRenderer({
        cwd,
        engine: engine || readSettings().defaultEngine,
        remoteId: session.id,
        initialInput: spawnPrompt(session.id, task),
      })
      return { id: session.id }
    },

    registerDevice: (token, environment) => {
      registerDevice(token, environment)
      emitActivity({
        kind: 'info',
        title: 'Phone registered for notifications',
        detail: `${environment} · alerts will now reach TerMinal Remote`,
      })
    },

    // Hand the pairing payload to a verified same-user tailnet peer. The identity
    // check is in tailscale.ts; here we just turn a yes into the token.
    tailscalePair: async (peerAddress) => {
      const { ok, peer } = await tailscalePeerAllowed(peerAddress)
      if (!ok) return null
      const identity = ensureIdentity()
      const payload = pairingPayload({ port: readSettings().bridge.port, identity })
      emitActivity({
        kind: 'info',
        title: 'Phone paired over Tailscale',
        detail: peer?.node || peer?.login || 'tailnet peer',
      })
      return { token: payload.t, fp: payload.fp, name: payload.n }
    },
  }
}
