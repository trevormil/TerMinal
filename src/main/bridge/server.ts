import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_BRIDGE_PORT, ensureIdentity, tokenMatches, type BridgeIdentity } from './identity'

// The mobile bridge: a SECOND transport over the live pty sessions the desktop
// already owns, not a new backend. Terminals only — once a phone can drive a
// live agent session it can ask that session about tickets, PRs and CI itself,
// so those get no bespoke endpoints here.
//
// Downstream is SSE and upstream is a plain POST, which keeps the Mac free of a
// WebSocket dependency and lets the iOS client use URLSession.bytes directly.

export { DEFAULT_BRIDGE_PORT }

/** One live pty, as the phone sees it. */
export type BridgeSession = {
  key: string
  sessionId: string
  name: string
  cwd: string
  repo: string
  branch: string
  model: string
  status: string
  cols: number
  rows: number
}

export type BridgeDeps = {
  sessions(): BridgeSession[]
  /** Bytes → the pty's stdin. False when the key is unknown. */
  write(key: string, data: Buffer): boolean
  /** Recent output so an attaching phone lands on the current screen. */
  replay(key: string): string
}

export type BridgeStatus = {
  listening: boolean
  port: number
  error?: string
}

type Subscriber = (event: 'data' | 'exit', payload: string) => void

const subscribers = new Map<string, Set<Subscriber>>()

/** Subscribe to one session's output. Returns the unsubscribe function. */
export function bridgeSubscribe(key: string, cb: Subscriber): () => void {
  let set = subscribers.get(key)
  if (!set) subscribers.set(key, (set = new Set()))
  set.add(cb)
  return () => {
    const s = subscribers.get(key)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) subscribers.delete(key)
  }
}

export function bridgeSubscriberCount(key: string): number {
  return subscribers.get(key)?.size ?? 0
}

/** Called from the pty's onData. A no-op (one Map miss) when no phone is attached. */
export function bridgeBroadcast(key: string, chunk: string): void {
  const set = subscribers.get(key)
  if (!set?.size || !chunk) return
  const b64 = Buffer.from(chunk, 'utf8').toString('base64')
  for (const cb of [...set]) {
    try {
      cb('data', b64)
    } catch {
      /* a broken client must never take down the pty pump */
    }
  }
}

/** Called from the pty's onExit. Subscribers close themselves on receipt. */
export function bridgeBroadcastExit(key: string, code: number | null): void {
  const set = subscribers.get(key)
  if (!set?.size) return
  const payload = JSON.stringify({ code: code ?? 0 })
  for (const cb of [...set]) {
    try {
      cb('exit', payload)
    } catch {
      /* ignore */
    }
  }
}

// ---- router ----------------------------------------------------------------

const MAX_BODY = 64 * 1024
const KEEPALIVE_MS = 15_000

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

function sseFrame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/**
 * The request handler, independent of TLS so tests can mount it on plain http.
 * Every route but /v1/health requires the bearer token.
 */
export function createBridgeHandler(
  deps: BridgeDeps,
  getToken: () => string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = new URL(req.url || '/', 'http://bridge.invalid')
    const parts = url.pathname.split('/').filter(Boolean)

    // Unauthenticated liveness probe used to race the candidate hosts from the
    // QR. Answers nothing but "a TerMinal bridge is here" — no version, no
    // hostname, no session data, so an unpaired scanner learns nothing useful.
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      json(res, 200, { ok: true, app: 'TerMinal' })
      return
    }

    if (!tokenMatches(bearer(req), getToken())) {
      json(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/sessions') {
      json(res, 200, { sessions: deps.sessions() })
      return
    }

    // /v1/sessions/:key/(stream|input)
    if (parts[0] === 'v1' && parts[1] === 'sessions' && parts.length === 4) {
      const key = decodeURIComponent(parts[2])
      const session = deps.sessions().find((s) => s.key === key)
      if (!session) {
        json(res, 404, { error: 'no such session' })
        return
      }
      if (req.method === 'GET' && parts[3] === 'stream') {
        streamSession(deps, session, req, res)
        return
      }
      if (req.method === 'POST' && parts[3] === 'input') {
        readBody(req)
          .then((raw) => {
            let data: Buffer
            try {
              const parsed = JSON.parse(raw) as { data?: unknown }
              if (typeof parsed.data !== 'string') throw new Error('data must be a base64 string')
              data = Buffer.from(parsed.data, 'base64')
            } catch (e) {
              json(res, 400, { error: (e as Error).message })
              return
            }
            const ok = deps.write(key, data)
            json(res, ok ? 200 : 404, ok ? { ok: true, bytes: data.length } : { error: 'gone' })
          })
          .catch((e: Error) => json(res, 413, { error: e.message }))
        return
      }
    }

    json(res, 404, { error: 'not found' })
  }
}

function streamSession(
  deps: BridgeDeps,
  session: BridgeSession,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const write = (event: string, data: string) => {
    if (!res.writableEnded) res.write(sseFrame(event, data))
  }

  write(
    'hello',
    JSON.stringify({
      cols: session.cols,
      rows: session.rows,
      name: session.name,
      replay: Buffer.from(deps.replay(session.key), 'utf8').toString('base64'),
    }),
  )

  const unsubscribe = bridgeSubscribe(session.key, (event, payload) => {
    write(event, payload)
    if (event === 'exit') {
      cleanup()
      res.end()
    }
  })
  // Idle agent sessions emit nothing for minutes; without this the OS or an
  // intermediary quietly drops the connection and the phone looks frozen.
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n')
  }, KEEPALIVE_MS)

  let done = false
  function cleanup(): void {
    if (done) return
    done = true
    clearInterval(keepalive)
    unsubscribe()
  }
  // Listen on BOTH halves: a phone that drops off Wi-Fi mid-stream surfaces as
  // an aborted request, while a clean disconnect closes the response. Missing
  // either one leaks a subscriber (and its keepalive timer) for the life of
  // the process.
  req.on('close', cleanup)
  req.on('aborted', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)
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
  opts: { port?: number; dir?: string } = {},
): Promise<BridgeStatus> {
  await stopBridge()
  const port = opts.port || DEFAULT_BRIDGE_PORT
  try {
    identity = ensureIdentity(opts.dir)
  } catch (e) {
    status = { listening: false, port, error: `pairing setup failed: ${(e as Error).message}` }
    return bridgeStatus()
  }
  const handler = createBridgeHandler(deps, () => identity?.token || '')
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
  // Close idle keep-alives too, otherwise an attached phone holds the port open.
  s.closeAllConnections?.()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}
