import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_BRIDGE_PORT, ensureIdentity, tokenMatches, type BridgeIdentity } from './identity'
import type { ChatTranscript } from '../chat/messages'

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
  /** 'working' while the agent is mid-turn, 'idle' when it is waiting on you. */
  status: string
  engine: string
  cols: number
  rows: number
}

/** A HITL item, as the phone sees it. Mirrors the fields the UI renders. */
export type BridgeHitl = {
  id: string
  title: string
  detail?: string
  action?: string
  repo?: string
  source: string
  createdAt: number
  sessionId?: string
  terminalKey?: string
}

export type BridgeRepo = { name: string; path: string }

export type StartSessionInput = { cwd: string; engine?: string; name?: string }

export type BridgeDeps = {
  sessions(): BridgeSession[]
  /** Bytes → the pty's stdin. False when the key is unknown. */
  write(key: string, data: Buffer): boolean
  /** Recent output so an attaching phone lands on the current screen. */
  replay(key: string): string

  // ---- chat surface (optional so the e2e harness can omit it) ----
  /** Normalized conversation for a session. */
  messages?(key: string, opts: { after?: number; limit?: number }): ChatTranscript
  /** Open human-in-the-loop items, newest first. */
  hitl?(): BridgeHitl[]
  /** Resolve one HITL item through the app's existing write path. */
  resolveHitl?(id: string, resolved: boolean): boolean
  /** Repos the phone may start a session in. */
  repos?(): BridgeRepo[]
  /** Start a session on the Mac. */
  startSession?(input: StartSessionInput): { key: string } | { error: string }
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
/**
 * How often an idle stream emits a comment frame.
 *
 * This MUST stay comfortably below the client's inactivity timeout, or an idle
 * agent session — which emits nothing for minutes — is torn down as if it had
 * failed. The iOS client allows 60s of silence on a stream
 * (BridgeClient.stream), so this leaves a 6x margin.
 */
export const KEEPALIVE_MS = 10_000

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
  opts: {
    keepaliveMs?: number
    onRequest?: (method: string, path: string, status: number) => void
  } = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const keepaliveMs = opts.keepaliveMs ?? KEEPALIVE_MS
  return (req, res) => {
    // Access hook — used by the e2e harness to show what a client actually
    // asked for. Never wired up by the app itself (no silent narration).
    if (opts.onRequest) {
      const method = req.method || '?'
      const path = req.url || '/'
      // Logged on ARRIVAL, not on close. A stream stays open for the life of
      // the session, so close-time logging hides exactly the request you most
      // want to see. Status is 0 until the handler sets it.
      opts.onRequest(method, path, 0)
      res.on('close', () => opts.onRequest!(method, path, res.statusCode))
    }
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

    // ---- chat surface -------------------------------------------------
    // The phone's primary UI. Terminals stay available underneath; these
    // routes render the SAME sessions as a conversation instead of a screen.

    if (req.method === 'GET' && url.pathname === '/v1/chats') {
      const threads = deps.sessions().map((s) => ({
        key: s.key,
        name: s.name,
        repo: s.repo,
        branch: s.branch,
        engine: s.engine,
        status: s.status,
        // 'idle' means the agent finished its turn and is waiting on a human.
        needsInput: s.status !== 'working',
        chat: !!deps.messages,
      }))
      json(res, 200, { threads, hitl: deps.hitl?.() ?? [] })
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/hitl') {
      json(res, 200, { items: deps.hitl?.() ?? [] })
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

    if (req.method === 'GET' && url.pathname === '/v1/repos') {
      json(res, 200, { repos: deps.repos?.() ?? [] })
      return
    }

    // Start a session from the phone, so the app is not merely a viewer of
    // sessions you started at the desk.
    if (req.method === 'POST' && url.pathname === '/v1/sessions') {
      if (!deps.startSession) {
        json(res, 501, { error: 'starting sessions not available' })
        return
      }
      readBody(req)
        .then((raw) => {
          let input: StartSessionInput
          try {
            const parsed = JSON.parse(raw) as Partial<StartSessionInput>
            if (typeof parsed.cwd !== 'string' || !parsed.cwd) throw new Error('cwd is required')
            input = {
              cwd: parsed.cwd,
              engine: typeof parsed.engine === 'string' ? parsed.engine : undefined,
              name: typeof parsed.name === 'string' ? parsed.name : undefined,
            }
          } catch (e) {
            json(res, 400, { error: (e as Error).message })
            return
          }
          const result = deps.startSession!(input)
          if ('error' in result) json(res, 400, result)
          else json(res, 200, result)
        })
        .catch((e: Error) => json(res, 413, { error: e.message }))
      return
    }

    // /v1/chats/:key/(messages|send|interrupt)
    if (parts[0] === 'v1' && parts[1] === 'chats' && parts.length === 4) {
      const key = decodeURIComponent(parts[2])
      const session = deps.sessions().find((s) => s.key === key)
      if (!session) {
        json(res, 404, { error: 'no such session' })
        return
      }

      if (req.method === 'GET' && parts[3] === 'messages') {
        if (!deps.messages) {
          json(res, 501, { error: 'chat not available' })
          return
        }
        const after = Number(url.searchParams.get('after') || 0)
        const limit = Number(url.searchParams.get('limit') || 0)
        json(res, 200, {
          ...deps.messages(key, {
            after: Number.isFinite(after) ? after : 0,
            limit: Number.isFinite(limit) ? limit : 0,
          }),
          status: session.status,
        })
        return
      }

      // A chat "send" is a prompt typed at the agent's prompt, so it carries
      // the newline the terminal route deliberately does not.
      if (req.method === 'POST' && parts[3] === 'send') {
        readBody(req)
          .then((raw) => {
            let text: string
            try {
              const parsed = JSON.parse(raw) as { text?: unknown }
              if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
                throw new Error('text is required')
              }
              text = parsed.text
            } catch (e) {
              json(res, 400, { error: (e as Error).message })
              return
            }
            const ok = deps.write(key, Buffer.from(text.replace(/\r?\n/g, ' ') + '\r', 'utf8'))
            json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'gone' })
          })
          .catch((e: Error) => json(res, 413, { error: e.message }))
        return
      }

      if (req.method === 'POST' && parts[3] === 'interrupt') {
        const ok = deps.write(key, Buffer.from([0x03]))
        json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'gone' })
        return
      }
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
        streamSession(deps, session, req, res, keepaliveMs)
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
  keepaliveMs: number,
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
  // Idle agent sessions emit nothing for minutes; without this the client's
  // inactivity timer fires and the phone reports a dead connection.
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n')
  }, keepaliveMs)

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
  // Close idle keep-alives too, otherwise an attached phone holds the port open.
  s.closeAllConnections?.()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}
