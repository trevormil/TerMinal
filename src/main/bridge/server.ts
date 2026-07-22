import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { DEFAULT_BRIDGE_PORT, ensureIdentity, tokenMatches, type BridgeIdentity } from './identity'

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
  /** Absolute path of a stored image, for serving it back. */
  imagePath?(id: string, name: string): string | null

  /** Open HITL items. May be async: the Mac fans out to remote hosts. */
  hitl?(): BridgeHitl[] | Promise<BridgeHitl[]>
  /** Resolve one HITL item through the app's existing write path. */
  resolveHitl?(id: string, resolved: boolean): boolean
  /** Remember a phone's APNs token so alerts can reach it. */
  registerDevice?(token: string, environment: 'sandbox' | 'production'): void

  /**
   * Tailnet auto-pairing. Given the peer's address, return the pairing payload
   * (token + cert fingerprint + name) if that peer is the same tailnet user
   * that owns the Mac, else null. The bridge itself does no Tailscale work —
   * the app injects this so the bridge module stays dependency-free.
   */
  tailscalePair?(peerAddress: string): { token: string; fp: string; name: string } | null

  /** Repos the phone may start a session in. */
  repos?(): BridgeRepo[]
  /**
   * Start a session on the Mac, already wired to a remote thread. Returns the
   * new session's remote id so the phone can open it immediately — the thread
   * exists before the agent has finished booting.
   */
  spawn?(input: SpawnInput): { id: string } | { error: string }
}

/** A repo the phone may start a session in. */
export type BridgeRepo = { name: string; path: string }

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
      const peer =
        (req.socket.remoteAddress || '').replace(/^::ffff:/, '') +
        ':' +
        (req.socket.remotePort || 0)
      const result = deps.tailscalePair(peer)
      if (!result) {
        json(res, 403, { error: 'not a recognised tailnet peer' })
        return
      }
      json(res, 200, result)
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
