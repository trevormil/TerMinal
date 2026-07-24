import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_BRIDGE_PORT,
  ensureIdentity,
  isTailscaleIp,
  tokenMatches,
  type BridgeIdentity,
} from './identity'

// The mobile bridge: a small authenticated JSON API over the sessions that have
// REGISTERED themselves for remote control (see src/main/remote-sessions.ts).
//
// Nothing here touches a pty. A session opts in by running the remote-terminal
// skill, then posts what it wants you to see and reads what you send back — so
// the same code serves claude, codex, or anything else that can run a shell
// command, with no transcript parsing and no terminal streaming.

export { DEFAULT_BRIDGE_PORT }

/** A session that registered itself for remote control. */
export type BridgeRemoteSession = {
  id: string
  title: string
  repo: string
  branch: string
  engine: string
  /** 'working' | 'awaiting' | 'ended' */
  status: string
  /** What it is blocked on, when awaiting. */
  question?: string
  lastSeenAt: number
  /** Total messages, so the phone can show unread counts. */
  messages: number
}

export type BridgeMessage = {
  at: number
  from: 'agent' | 'user'
  text: string
  /** Filenames served from /v1/remote/:id/image/:name. */
  images?: string[]
}

/** A human-in-the-loop item — the cross-repo "something is blocked" queue. */
export type BridgeHitl = {
  id: string
  title: string
  detail?: string
  action?: string
  repo?: string
  source: string
  createdAt: number
  /** 'push' notifies; 'normal' is inbox-only. Absent ⇒ treat as 'push'. */
  severity?: string
  /** Open unless resolved — the phone can show all, filtered. */
  status?: string
  /** When first seen; absent ⇒ unread. */
  readAt?: number
}

export type BridgeDeps = {
  /** Registered sessions, most urgent first. */
  sessions(): BridgeRemoteSession[]
  /** One session's conversation. */
  messages(id: string, opts: { after?: number }): BridgeMessage[]
  /** Queue a reply for the agent to collect. False when the id is unknown. */
  reply(id: string, text: string, images?: string[]): boolean
  /** Terminate a session (mark it ended). The thread stays readable. */
  endRemote?(id: string): boolean
  /** Remove a session for good — meta, log, images. */
  deleteRemote?(id: string): boolean
  /** Store an uploaded image; returns its filename, or null. */
  saveImage?(id: string, data: Buffer, ext: string): string | null
  /** Recent raw terminal output (ANSI already stripped) for the desktop pty
   *  behind a remote session — the read-only peek. Null when no live terminal
   *  matches (headless or ended). */
  remoteTerminal?(id: string): { text: string; updatedAt: number } | null
  /** Absolute path of a stored image, for serving it back. */
  imagePath?(id: string, name: string): string | null

  /** Open HITL items. May be async: the Mac fans out to remote hosts. */
  hitl?(): BridgeHitl[] | Promise<BridgeHitl[]>
  /** Latest health-check statuses (see src/main/checks.ts). */
  checks?(): unknown[]
  /** Resolve one HITL item through the app's existing write path. */
  resolveHitl?(id: string, resolved: boolean): boolean
  /** Mark HITL items read (viewed on the phone). */
  markHitlRead?(ids: string[], read?: boolean): number
  /** Remember a phone's APNs token so alerts can reach it. */
  registerDevice?(token: string, environment: 'sandbox' | 'production'): void

  /**
   * Tailnet auto-pairing. Given the peer's address, return the pairing payload
   * (token + cert fingerprint + name) if that peer is the same tailnet user
   * that owns the Mac, else null. The bridge itself does no Tailscale work —
   * the app injects this so the bridge module stays dependency-free.
   */
  tailscalePair?(
    peerAddress: string,
  ):
    | { token: string; fp: string; name: string }
    | null
    | Promise<{ token: string; fp: string; name: string } | null>

  /** Repos the phone may start a session in — also the workspace list. */
  repos?(): BridgeRepo[]
  /** Engines available for a new session, labelled the way the desktop shows
   *  them ("Codex", not "codex"). */
  engines?(): BridgeEngine[]
  /** Read-only per-workspace data for the mobile cockpit. Each takes a repo
   *  path (from repos()). May be async — they resolve a workspace daemon. */
  workspaceTickets?(repoPath: string): Promise<BridgeTicket[]> | BridgeTicket[]
  workspacePrs?(repoPath: string): Promise<BridgePr[]> | BridgePr[]
  workspaceRuns?(repoPath: string): Promise<BridgeRun[]> | BridgeRun[]
  workspaceSchedules?(repoPath: string): Promise<BridgeSchedule[]> | BridgeSchedule[]

  /** Drill-downs — the full readable content behind a list row. */
  workspaceTicket?(
    repoPath: string,
    slug: string,
  ): Promise<BridgeTicketDetail | null> | BridgeTicketDetail | null
  workspacePr?(
    repoPath: string,
    iid: number,
  ): Promise<BridgePrDetail | null> | BridgePrDetail | null
  workspacePrDiff?(repoPath: string, iid: number): Promise<BridgeText> | BridgeText
  /** `source`/`hostId` stay on the wire for compatibility, but the Mac reads
   *  the log with ITS OWN run row for the id — never the phone's copies. */
  workspaceRunLog?(runId: string, source: string, hostId?: string): Promise<BridgeText> | BridgeText
  workspaceSchedule?(
    repoPath: string,
    id: string,
  ): Promise<BridgeScheduleDetail | null> | BridgeScheduleDetail | null
  /**
   * Start a session on the Mac, already wired to a remote thread. Returns the
   * new session's remote id so the phone can open it immediately — the thread
   * exists before the agent has finished booting.
   */
  spawn?(input: SpawnInput): { id: string } | { error: string }
}

/** A repo the phone may start a session in. */
export type BridgeRepo = {
  name: string
  path: string
  /** Most recent activity in this repo (run or session), for recent-first
   *  ordering on the phone. Absent when nothing has ever run there. */
  lastUsedAt?: number
  /** The app-owned throwaway workspace — no repo attached. */
  scratch?: boolean
}

/** An engine the phone may start a session with, already display-cased. */
export type BridgeEngine = { id: string; label: string }

// Compact, read-only projections of the desktop cockpit's data — just what a
// phone list needs, so the bridge never ships a full daemon payload.
export type BridgeTicket = {
  slug: string
  id: number
  title: string
  status: string
  priority: string
  type: string
  hitl: boolean
}
export type BridgePr = {
  iid: number
  title: string
  state: string
  draft: boolean
  author: string
  url: string
  labels: string[]
  verdict?: string
  score?: number
}
export type BridgeRun = {
  id: string
  title: string
  engine: string
  status: string
  startedAt: number
  endedAt?: number
  branch: string
  /** Which on-disk log store holds this run. REQUIRED to fetch its log — it
   *  cannot be derived from the id. */
  source: string
  /** Remote host the run came from; absent for local. */
  hostId?: string
}
export type BridgeSchedule = {
  id: string
  title: string
  describe: string
  nextRun?: number
  enabled: boolean
}

// Drill-down payloads. The phone is a READER: these carry the full content
// (ticket body, PR description + review + diff, run log, schedule prompt) so
// you can read anything from your pocket. Large text is capped by the caller.
export type BridgeTicketDetail = BridgeTicket & {
  /** Full markdown body of the ticket. */
  body: string
  acceptance?: string[]
  prs?: string[]
}
export type BridgeFinding = {
  severity?: string
  title?: string
  file?: string
  line?: number
  text?: string
}
export type BridgePrDetail = BridgePr & {
  /** The PR description / body. */
  description: string
  branch?: string
  testStatus?: string
  riskTier?: string
  /** The code-review artifact's markdown, when one exists. */
  reviewNotes?: string
  findings?: BridgeFinding[]
  /** Non-blocking review suggestions — the code-review's separate list. */
  suggestions?: BridgeFinding[]
  ci?: string
}
export type BridgeScheduleDetail = BridgeSchedule & {
  engine?: string
  model?: string
  /** The agent prompt this schedule runs. */
  prompt: string
  host?: string
  runtime?: string
}
/** Big text (diff / log) plus whether it was cut short for the wire. */
export type BridgeText = { text: string; truncated: boolean }

export type SpawnInput = {
  /** Absolute repo path, chosen from `repos()`. */
  cwd: string
  engine?: string
  /** What the new agent should do first. Optional — omit for a bare session. */
  task?: string
}

export type BridgeStatus = {
  listening: boolean
  port: number
  error?: string
}

const MAX_BODY = 12 * 1024 * 1024 // room for a screenshot or two

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // Nothing here is ever loaded by a browser; make that explicit.
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

/**
 * The bearer token authenticates the DEVICE; it does NOT authorize an arbitrary
 * filesystem path. Every route that takes a caller-supplied repo/cwd must be
 * fenced to the exact set the Mac advertises in repos() — otherwise a token
 * holder could spawn a session in /tmp or read any repo's tickets/PRs/runs.
 * Paths are resolved before comparison so `.../a/../b` can't slip through.
 */
function repoAllowed(deps: BridgeDeps, path: string): boolean {
  if (!path) return false
  const target = resolve(path)
  return (deps.repos?.() ?? []).some((r) => resolve(r.path) === target)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * The request handler, independent of TLS so tests can mount it on plain http.
 * Every route but /v1/health requires the bearer token.
 */
export function createBridgeHandler(
  deps: BridgeDeps,
  getToken: () => string,
  opts: { onRequest?: (method: string, path: string, status: number) => void } = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  // /v1/pair is unauthenticated, and verifying a peer shells out to the
  // Tailscale CLI — so keep it slow: one verification in flight at a time,
  // plus a small per-minute budget. In-memory is enough; pairing is rare.
  let pairInFlight = false
  let pairWindowStart = 0
  let pairAttempts = 0
  const PAIR_MAX_PER_MINUTE = 6

  return (req, res) => {
    const url = new URL(req.url || '/', 'http://bridge.invalid')
    const parts = url.pathname.split('/').filter(Boolean)

    if (opts.onRequest) {
      const method = req.method || '?'
      const path = req.url || '/'
      // Logged on ARRIVAL as well as completion — a long request is exactly the
      // one you want to see while it is still in flight.
      opts.onRequest(method, path, 0)
      res.on('close', () => opts.onRequest!(method, path, res.statusCode))
    }

    // Unauthenticated liveness probe, used to race the candidate hosts from the
    // pairing QR. Reveals nothing but "a TerMinal bridge is here".
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      json(res, 200, { ok: true, app: 'TerMinal' })
      return
    }

    // Tailnet auto-pairing. Deliberately BEFORE the token check: the caller
    // has no token yet. It is gated instead by `tailscalePair`, which only
    // succeeds when Tailscale confirms the peer is the same tailnet user that
    // owns this Mac. The request rides inside the WireGuard tunnel, so it needs
    // no prior shared secret. Everything after pairing uses the token normally.
    if (req.method === 'GET' && url.pathname === '/v1/pair') {
      if (!deps.tailscalePair) {
        json(res, 501, { error: 'tailnet pairing not available' })
        return
      }
      // The peer address the socket saw — trusted because it is the kernel's
      // view of who connected, not anything the client claimed.
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
      // Cheap fence BEFORE any subprocess work: only a tailnet (CGNAT) source
      // address can even ask, so a LAN scanner can't make the Mac shell out.
      if (!isTailscaleIp(ip)) {
        json(res, 403, { error: 'not a recognised tailnet peer' })
        return
      }
      const now = Date.now()
      if (now - pairWindowStart > 60_000) {
        pairWindowStart = now
        pairAttempts = 0
      }
      if (pairInFlight || ++pairAttempts > PAIR_MAX_PER_MINUTE) {
        json(res, 429, { error: 'too many pairing attempts' })
        return
      }
      pairInFlight = true
      // Release the flight BEFORE responding — the response is what callers
      // await, so a follow-up request must already see the slot free.
      const done = (status: number, body: unknown): void => {
        pairInFlight = false
        json(res, status, body)
      }
      Promise.resolve(deps.tailscalePair(`${ip}:${req.socket.remotePort || 0}`))
        .then((result) =>
          result ? done(200, result) : done(403, { error: 'not a recognised tailnet peer' }),
        )
        .catch((e: Error) => done(500, { error: e.message }))
      return
    }

    if (!tokenMatches(bearer(req), getToken())) {
      json(res, 401, { error: 'unauthorized' })
      return
    }

    // The home screen: registered sessions plus the blocked queue.
    if (req.method === 'GET' && url.pathname === '/v1/remote') {
      Promise.resolve(deps.hitl?.() ?? [])
        .then((hitl) => json(res, 200, { sessions: deps.sessions(), hitl }))
        .catch((e: Error) => json(res, 500, { error: e.message }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/hitl') {
      Promise.resolve(deps.hitl?.() ?? [])
        .then((items) => json(res, 200, { items }))
        .catch((e: Error) => json(res, 500, { error: e.message }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/checks') {
      try {
        json(res, 200, { checks: deps.checks?.() ?? [] })
      } catch (e) {
        json(res, 500, { error: (e as Error).message })
      }
      return
    }

    // Mark inbox items read — or unread again with read:false (viewed on the phone).
    if (req.method === 'POST' && url.pathname === '/v1/hitl/read') {
      if (!deps.markHitlRead) {
        json(res, 501, { error: 'read state not available' })
        return
      }
      readBody(req)
        .then((raw) => {
          const { ids, read } = (() => {
            try {
              const p = JSON.parse(raw || '{}') as { ids?: unknown; read?: unknown }
              return {
                ids: Array.isArray(p.ids)
                  ? p.ids.filter((x): x is string => typeof x === 'string')
                  : [],
                read: p.read !== false,
              }
            } catch {
              return { ids: [], read: true }
            }
          })()
          json(res, 200, { marked: deps.markHitlRead!(ids, read) })
        })
        .catch((e: Error) => json(res, 413, { error: e.message }))
      return
    }

    // Workspaces: the repo list, and per-repo read-only cockpit data. `repo` is
    // an absolute path from /v1/workspaces, passed as a query param so a path
    // with slashes needs no segment gymnastics.
    if (req.method === 'GET' && url.pathname === '/v1/workspaces') {
      json(res, 200, { workspaces: deps.repos?.() ?? [] })
      return
    }
    if (req.method === 'GET' && url.pathname === '/v1/engines') {
      json(res, 200, { engines: deps.engines?.() ?? [] })
      return
    }
    // Drill-downs: the full readable content behind a row. Separate from the
    // list routes because each takes its own identifier.
    if (req.method === 'GET' && url.pathname.startsWith('/v1/workspace/')) {
      const kind = url.pathname.slice('/v1/workspace/'.length)
      const repo = url.searchParams.get('repo') || ''
      // Fence every repo-scoped detail to the advertised set. run-log carries no
      // repo (opaque run id); its dep authorizes the run against allowed repos.
      if (kind !== 'run-log' && !repoAllowed(deps, repo)) {
        json(res, 403, { error: 'workspace not allowed' })
        return
      }
      const detail = (): unknown | undefined => {
        switch (kind) {
          case 'ticket': {
            const slug = url.searchParams.get('slug') || ''
            if (!deps.workspaceTicket || !repo || !slug) return undefined
            return deps.workspaceTicket(repo, slug)
          }
          case 'pr': {
            const iid = Number(url.searchParams.get('iid'))
            if (!deps.workspacePr || !repo || !Number.isFinite(iid)) return undefined
            return deps.workspacePr(repo, iid)
          }
          case 'pr-diff': {
            const iid = Number(url.searchParams.get('iid'))
            if (!deps.workspacePrDiff || !repo || !Number.isFinite(iid)) return undefined
            return deps.workspacePrDiff(repo, iid)
          }
          case 'run-log': {
            const id = url.searchParams.get('id') || ''
            const source = url.searchParams.get('source') || ''
            if (!deps.workspaceRunLog || !id || !source) return undefined
            return deps.workspaceRunLog(id, source, url.searchParams.get('host') || undefined)
          }
          case 'schedule': {
            const id = url.searchParams.get('id') || ''
            if (!deps.workspaceSchedule || !repo || !id) return undefined
            return deps.workspaceSchedule(repo, id)
          }
          default:
            return undefined
        }
      }
      const pending = detail()
      if (pending === undefined) {
        json(res, 400, { error: `bad or unavailable workspace detail: ${kind}` })
        return
      }
      Promise.resolve(pending)
        .then((value) => json(res, value ? 200 : 404, value ?? { error: 'not found' }))
        .catch((e: Error) => json(res, 500, { error: e.message }))
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/workspaces/')) {
      const kind = url.pathname.slice('/v1/workspaces/'.length)
      const repo = url.searchParams.get('repo') || ''
      const fetcher: Record<string, ((p: string) => unknown) | undefined> = {
        tickets: deps.workspaceTickets && ((p) => deps.workspaceTickets!(p)),
        prs: deps.workspacePrs && ((p) => deps.workspacePrs!(p)),
        runs: deps.workspaceRuns && ((p) => deps.workspaceRuns!(p)),
        schedules: deps.workspaceSchedules && ((p) => deps.workspaceSchedules!(p)),
      }
      const fn = fetcher[kind]
      if (!fn) {
        json(res, kind in fetcher ? 501 : 404, { error: `no workspace ${kind}` })
        return
      }
      if (!repo) {
        json(res, 400, { error: 'repo is required' })
        return
      }
      if (!repoAllowed(deps, repo)) {
        json(res, 403, { error: 'workspace not allowed' })
        return
      }
      Promise.resolve(fn(repo))
        .then((items) => json(res, 200, { [kind]: items }))
        .catch((e: Error) => json(res, 500, { error: e.message }))
      return
    }

    if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'hitl' && parts.length === 3) {
      if (!deps.resolveHitl) {
        json(res, 501, { error: 'hitl not available' })
        return
      }
      const id = decodeURIComponent(parts[2])
      readBody(req)
        .then((raw) => {
          let resolved = true
          try {
            const parsed = JSON.parse(raw || '{}') as { resolved?: unknown }
            if (typeof parsed.resolved === 'boolean') resolved = parsed.resolved
          } catch {
            /* an empty or malformed body means the default: resolved */
          }
          const ok = deps.resolveHitl!(id, resolved)
          json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'no such item' })
        })
        .catch((e: Error) => json(res, 413, { error: e.message }))
      return
    }

    // The phone hands over its APNs token here, on the already authenticated
    // bridge — no separate enrolment channel.
    if (req.method === 'POST' && url.pathname === '/v1/devices') {
      if (!deps.registerDevice) {
        json(res, 501, { error: 'push not available' })
        return
      }
      readBody(req)
        .then((raw) => {
          try {
            const parsed = JSON.parse(raw) as { token?: unknown; environment?: unknown }
            if (typeof parsed.token !== 'string' || !parsed.token) {
              throw new Error('token is required')
            }
            deps.registerDevice!(
              parsed.token,
              parsed.environment === 'production' ? 'production' : 'sandbox',
            )
            json(res, 200, { ok: true })
          } catch (e) {
            json(res, 400, { error: (e as Error).message })
          }
        })
        .catch((e: Error) => json(res, 413, { error: e.message }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/repos') {
      json(res, 200, { repos: deps.repos?.() ?? [] })
      return
    }

    // Start a session from the phone. The thread is registered before the
    // agent boots, so the phone can open it straight away.
    if (req.method === 'POST' && url.pathname === '/v1/remote/new') {
      if (!deps.spawn) {
        json(res, 501, { error: 'starting sessions not available' })
        return
      }
      readBody(req)
        .then((raw) => {
          let input: SpawnInput
          try {
            const parsed = JSON.parse(raw) as Partial<SpawnInput>
            if (typeof parsed.cwd !== 'string' || !parsed.cwd) throw new Error('cwd is required')
            input = {
              cwd: parsed.cwd,
              engine: typeof parsed.engine === 'string' ? parsed.engine : undefined,
              task: typeof parsed.task === 'string' ? parsed.task.trim() || undefined : undefined,
            }
          } catch (e) {
            json(res, 400, { error: (e as Error).message })
            return
          }
          // Spawn only into an advertised workspace — a token holder must not be
          // able to start a session in an arbitrary directory (e.g. /tmp).
          if (!repoAllowed(deps, input.cwd)) {
            json(res, 403, { error: 'workspace not allowed' })
            return
          }
          const result = deps.spawn!(input)
          json(res, 'error' in result ? 409 : 200, result)
        })
        .catch((e: Error) => json(res, 413, { error: e.message }))
      return
    }

    // DELETE /v1/remote/:id — remove a session entirely.
    if (
      req.method === 'DELETE' &&
      parts[0] === 'v1' &&
      parts[1] === 'remote' &&
      parts.length === 3
    ) {
      if (!deps.deleteRemote) {
        json(res, 501, { error: 'delete not available' })
        return
      }
      const ok = deps.deleteRemote(decodeURIComponent(parts[2]))
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'no such session' })
      return
    }

    // /v1/remote/:id/(messages|reply|image/:name|end)
    if (parts[0] === 'v1' && parts[1] === 'remote' && parts.length >= 4) {
      const id = decodeURIComponent(parts[2])
      const session = deps.sessions().find((s) => s.id === id)
      if (!session) {
        json(res, 404, { error: 'no such session' })
        return
      }

      if (req.method === 'GET' && parts[3] === 'messages') {
        const after = Number(url.searchParams.get('after') || 0)
        json(res, 200, {
          messages: deps.messages(id, { after: Number.isFinite(after) ? after : 0 }),
          status: session.status,
          question: session.question,
        })
        return
      }

      if (req.method === 'POST' && parts[3] === 'reply') {
        readBody(req)
          .then((raw) => {
            let text: string
            let images: { ext: string; data: string }[] = []
            try {
              const parsed = JSON.parse(raw) as {
                text?: unknown
                images?: { ext?: unknown; data?: unknown }[]
              }
              text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
              if (Array.isArray(parsed.images)) {
                images = parsed.images
                  .filter((i) => typeof i?.data === 'string')
                  .map((i) => ({ ext: String(i.ext || 'png'), data: String(i.data) }))
              }
              // A message must carry something.
              if (!text && images.length === 0) throw new Error('text or an image is required')
            } catch (e) {
              json(res, 400, { error: (e as Error).message })
              return
            }
            const names: string[] = []
            for (const img of images) {
              const name = deps.saveImage?.(id, Buffer.from(img.data, 'base64'), img.ext)
              if (name) names.push(name)
            }
            const ok = deps.reply(id, text, names)
            json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'gone' })
          })
          .catch((e: Error) => json(res, 413, { error: e.message }))
        return
      }

      // Read-only peek at the session's raw terminal output, for when the chat
      // goes quiet and you want to see what the pty is actually doing.
      if (req.method === 'GET' && parts[3] === 'terminal') {
        if (!deps.remoteTerminal) {
          json(res, 501, { error: 'terminal peek not available' })
          return
        }
        const tail = deps.remoteTerminal(id)
        json(res, tail ? 200 : 404, tail ?? { error: 'no terminal attached' })
        return
      }

      // Terminate a session — it stays in the list, marked ended.
      if (req.method === 'POST' && parts[3] === 'end') {
        const ok = deps.endRemote?.(id) ?? false
        json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'gone' })
        return
      }

      // Serve an attached image back to the phone.
      if (req.method === 'GET' && parts[3] === 'image' && parts.length === 5) {
        const path = deps.imagePath?.(id, decodeURIComponent(parts[4]))
        if (!path || !existsSync(path)) {
          json(res, 404, { error: 'no such image' })
          return
        }
        const ext = path.split('.').pop()?.toLowerCase() || 'png'
        const type = ext === 'jpg' ? 'jpeg' : ext
        res.writeHead(200, { 'content-type': `image/${type}`, 'cache-control': 'max-age=86400' })
        createReadStream(path).pipe(res)
        return
      }
    }

    json(res, 404, { error: 'not found' })
  }
}

// ---- lifecycle -------------------------------------------------------------

let server: HttpsServer | null = null
let status: BridgeStatus = { listening: false, port: DEFAULT_BRIDGE_PORT }
let identity: BridgeIdentity | null = null

export function bridgeStatus(): BridgeStatus {
  return { ...status }
}

export function bridgeIdentity(): BridgeIdentity | null {
  return identity
}

export async function startBridge(
  deps: BridgeDeps,
  opts: {
    port?: number
    dir?: string
    onRequest?: (method: string, path: string, status: number) => void
  } = {},
): Promise<BridgeStatus> {
  await stopBridge()
  const port = opts.port || DEFAULT_BRIDGE_PORT
  try {
    identity = ensureIdentity(opts.dir)
  } catch (e) {
    status = { listening: false, port, error: `pairing setup failed: ${(e as Error).message}` }
    return bridgeStatus()
  }
  const handler = createBridgeHandler(deps, () => identity?.token || '', {
    onRequest: opts.onRequest,
  })
  return new Promise((resolve) => {
    const s = createHttpsServer({ cert: identity!.certPem, key: identity!.keyPem }, handler)
    s.on('error', (e: Error) => {
      server = null
      status = { listening: false, port, error: e.message }
      resolve(bridgeStatus())
    })
    // 0.0.0.0 on purpose: the phone reaches the Mac over the LAN or the tailnet,
    // and the bind only happens while the user has the toggle on.
    s.listen(port, '0.0.0.0', () => {
      server = s
      status = { listening: true, port }
      resolve(bridgeStatus())
    })
  })
}

export async function stopBridge(): Promise<void> {
  const s = server
  server = null
  status = { listening: false, port: status.port }
  if (!s) return
  s.closeAllConnections?.()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}
