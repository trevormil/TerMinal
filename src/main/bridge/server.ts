import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
  reply(id: string, text: string): boolean

  /** Open HITL items. May be async: the Mac fans out to remote hosts. */
  hitl?(): BridgeHitl[] | Promise<BridgeHitl[]>
  /** Resolve one HITL item through the app's existing write path. */
  resolveHitl?(id: string, resolved: boolean): boolean
  /** Remember a phone's APNs token so alerts can reach it. */
  registerDevice?(token: string, environment: 'sandbox' | 'production'): void
}

export type BridgeStatus = {
  listening: boolean
  port: number
  error?: string
}

const MAX_BODY = 64 * 1024

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

    // /v1/remote/:id/(messages|reply)
    if (parts[0] === 'v1' && parts[1] === 'remote' && parts.length === 4) {
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
            try {
              const parsed = JSON.parse(raw) as { text?: unknown }
              if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
                throw new Error('text is required')
              }
              text = parsed.text.trim()
            } catch (e) {
              json(res, 400, { error: (e as Error).message })
              return
            }
            const ok = deps.reply(id, text)
            json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'gone' })
          })
          .catch((e: Error) => json(res, 413, { error: e.message }))
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
