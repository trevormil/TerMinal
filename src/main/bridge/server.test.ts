import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import {
  KEEPALIVE_MS,
  bridgeBroadcast,
  bridgeBroadcastExit,
  bridgeSubscribe,
  bridgeSubscriberCount,
  createBridgeHandler,
  type BridgeDeps,
  type BridgeSession,
} from './server'

const TOKEN = 'test-token-value'

function session(over: Partial<BridgeSession> = {}): BridgeSession {
  return {
    key: 'sess-1',
    sessionId: 'sid-1',
    name: 'TerMinal',
    cwd: '/repo',
    repo: 'TerMinal',
    branch: 'main',
    model: 'opus',
    status: 'working',
    engine: 'claude',
    cols: 120,
    rows: 40,
    ...over,
  }
}

type Harness = {
  url: string
  written: { key: string; data: Buffer }[]
  close: () => Promise<void>
}

const servers: Server[] = []

async function harness(
  over: Partial<BridgeDeps> = {},
  token = TOKEN,
  opts: { keepaliveMs?: number } = {},
): Promise<Harness> {
  const written: { key: string; data: Buffer }[] = []
  const deps: BridgeDeps = {
    sessions: () => [session()],
    write: (key, data) => {
      if (key !== 'sess-1') return false
      written.push({ key, data })
      return true
    },
    replay: () => 'previous screen',
    ...over,
  }
  const s = createServer(createBridgeHandler(deps, () => token, opts))
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}`,
    written,
    close: () => new Promise<void>((r) => s.close(() => r())),
  }
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    s.closeAllConnections() // an open SSE stream would otherwise hold close() forever
    await new Promise<void>((r) => s.close(() => r()))
  }
})

const auth = { authorization: `Bearer ${TOKEN}` }

describe('auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects a wrong token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions`, {
      headers: { authorization: 'Bearer not-the-token' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects a token passed without the Bearer scheme', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions`, { headers: { authorization: TOKEN } })
    expect(res.status).toBe(401)
  })

  it('accepts the exact token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions`, { headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()).sessions[0].key).toBe('sess-1')
  })

  it('refuses every request when no token is provisioned', async () => {
    const h = await harness({}, '')
    expect((await fetch(`${h.url}/v1/sessions`, { headers: auth })).status).toBe(401)
    expect(
      (await fetch(`${h.url}/v1/sessions`, { headers: { authorization: 'Bearer ' } })).status,
    ).toBe(401)
  })
})

describe('GET /v1/health', () => {
  it('answers without a token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, app: 'TerMinal' })
  })

  it('leaks nothing about the sessions to an unpaired scanner', async () => {
    const h = await harness()
    const body = await (await fetch(`${h.url}/v1/health`)).text()
    expect(body).not.toContain('sess-1')
    expect(body).not.toContain('/repo')
    expect(body).not.toContain(TOKEN)
  })
})

describe('GET /v1/sessions', () => {
  it('returns the live session list', async () => {
    const h = await harness({
      sessions: () => [session(), session({ key: 'sess-2', name: 'other' })],
    })
    const body = await (await fetch(`${h.url}/v1/sessions`, { headers: auth })).json()
    expect(body.sessions.map((s: BridgeSession) => s.key)).toEqual(['sess-1', 'sess-2'])
    expect(body.sessions[0].cols).toBe(120)
  })
})

describe('POST /v1/sessions/:key/input', () => {
  it('writes exactly the decoded bytes to the pty', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/sess-1/input`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ data: Buffer.from('ls -la\r').toString('base64') }),
    })
    expect(res.status).toBe(200)
    expect(h.written).toHaveLength(1)
    expect(h.written[0].data.toString('utf8')).toBe('ls -la\r')
  })

  it('round-trips control bytes so Ctrl-C actually interrupts', async () => {
    const h = await harness()
    await fetch(`${h.url}/v1/sessions/sess-1/input`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ data: Buffer.from([0x03]).toString('base64') }),
    })
    expect([...h.written[0].data]).toEqual([0x03])
  })

  it('404s an unknown session instead of writing anywhere', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/nope/input`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ data: 'aGk=' }),
    })
    expect(res.status).toBe(404)
    expect(h.written).toHaveLength(0)
  })

  it('rejects a body that is not a base64 string', async () => {
    const h = await harness()
    for (const body of ['{"data":123}', '{}', 'not json']) {
      const res = await fetch(`${h.url}/v1/sessions/sess-1/input`, {
        method: 'POST',
        headers: auth,
        body,
      })
      expect(res.status).toBe(400)
    }
    expect(h.written).toHaveLength(0)
  })

  it('requires a token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/sess-1/input`, {
      method: 'POST',
      body: JSON.stringify({ data: 'aGk=' }),
    })
    expect(res.status).toBe(401)
    expect(h.written).toHaveLength(0)
  })
})

describe('GET /v1/sessions/:key/stream', () => {
  it('opens with the geometry and a replay of the current screen', async () => {
    const h = await harness({ replay: () => 'hello screen' })
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, { headers: auth })
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: hello')
    const payload = JSON.parse(first.split('data: ')[1].trim())
    expect(payload.cols).toBe(120)
    expect(payload.rows).toBe(40)
    expect(Buffer.from(payload.replay, 'base64').toString('utf8')).toBe('hello screen')
    await reader.cancel()
  })

  it('delivers live output to an attached client', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, { headers: auth })
    const reader = res.body!.getReader()
    await reader.read() // hello

    // Wait for the subscription to land before broadcasting.
    while (bridgeSubscriberCount('sess-1') === 0) await Bun.sleep(5)
    bridgeBroadcast('sess-1', 'agent output\r\n')

    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('event: data')
    const b64 = frame.split('data: ')[1].trim()
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('agent output\r\n')
    await reader.cancel()
  })

  it('does not deliver another session’s output', async () => {
    const h = await harness({
      sessions: () => [session(), session({ key: 'sess-2' })],
    })
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, { headers: auth })
    const reader = res.body!.getReader()
    await reader.read() // hello
    while (bridgeSubscriberCount('sess-1') === 0) await Bun.sleep(5)

    bridgeBroadcast('sess-2', 'SECRET FROM OTHER SESSION')
    bridgeBroadcast('sess-1', 'mine')

    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).not.toContain(Buffer.from('SECRET FROM OTHER SESSION').toString('base64'))
    expect(Buffer.from(frame.split('data: ')[1].trim(), 'base64').toString()).toBe('mine')
    await reader.cancel()
  })

  it('ends the stream when the pty exits', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, { headers: auth })
    const reader = res.body!.getReader()
    await reader.read()
    while (bridgeSubscriberCount('sess-1') === 0) await Bun.sleep(5)

    bridgeBroadcastExit('sess-1', 1)
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('event: exit')
    expect(JSON.parse(frame.split('data: ')[1].trim())).toEqual({ code: 1 })
    expect((await reader.read()).done).toBe(true)
  })

  it('unsubscribes when the client disconnects, so subscribers never leak', async () => {
    const h = await harness()
    // abort(), not reader.cancel(): only aborting actually tears down the TCP
    // socket, which is what a phone dropping off Wi-Fi looks like to the server.
    const ac = new AbortController()
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, {
      headers: auth,
      signal: ac.signal,
    })
    const reader = res.body!.getReader()
    await reader.read()
    while (bridgeSubscriberCount('sess-1') === 0) await Bun.sleep(5)

    ac.abort()
    const deadline = Date.now() + 2000
    while (bridgeSubscriberCount('sess-1') > 0 && Date.now() < deadline) await Bun.sleep(10)
    expect(bridgeSubscriberCount('sess-1')).toBe(0)
  })

  it('404s an unknown session', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/sessions/ghost/stream`, { headers: auth })
    expect(res.status).toBe(404)
  })

  it('keeps an idle stream alive with comment frames', async () => {
    // Regression: an idle agent emits nothing for minutes. The client's
    // inactivity timer kills the connection unless the server speaks first, so
    // a silent stream must still produce traffic.
    const h = await harness({}, TOKEN, { keepaliveMs: 60 })
    const res = await fetch(`${h.url}/v1/sessions/sess-1/stream`, { headers: auth })
    const reader = res.body!.getReader()
    await reader.read() // hello

    // Nothing is broadcast — the only thing that can arrive is a keepalive.
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain(': keepalive')
    await reader.cancel()
  })

  it("keeps the keepalive well inside the client's inactivity budget", () => {
    // The iOS client allows 60s of silence (BridgeClient.stream sets
    // timeoutInterval = 60). Raising this constant past that budget silently
    // breaks every idle session, which is exactly the bug this pins.
    const CLIENT_INACTIVITY_BUDGET_MS = 60_000
    expect(KEEPALIVE_MS).toBeLessThanOrEqual(CLIENT_INACTIVITY_BUDGET_MS / 4)
  })

  it('requires a token', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/sessions/sess-1/stream`)).status).toBe(401)
  })
})

describe('bridgeBroadcast', () => {
  it('is a no-op with no subscribers and survives a throwing one', () => {
    expect(() => bridgeBroadcast('nobody-home', 'x')).not.toThrow()
    const off = bridgeSubscribe('boom', () => {
      throw new Error('client blew up')
    })
    const seen: string[] = []
    const off2 = bridgeSubscribe('boom', (_e, p) => seen.push(p))
    expect(() => bridgeBroadcast('boom', 'hi')).not.toThrow()
    // A broken subscriber must not stop a healthy one from receiving output.
    expect(Buffer.from(seen[0], 'base64').toString()).toBe('hi')
    off()
    off2()
    expect(bridgeSubscriberCount('boom')).toBe(0)
  })
})

describe('chat surface', () => {
  const chatDeps = (over: Partial<BridgeDeps> = {}): Partial<BridgeDeps> => ({
    messages: () => ({
      messages: [
        { kind: 'user', at: 1, text: 'run the tests' },
        { kind: 'assistant', at: 2, text: 'All green.' },
        { kind: 'tool', at: 3, name: 'Bash', summary: 'bun test', status: 'ok' },
      ],
      unsupported: false,
      total: 3,
    }),
    hitl: () => [
      {
        id: 'h1',
        title: 'Approve deploy',
        source: 'agent',
        createdAt: 100,
        repo: 'TerMinal',
      },
    ],
    resolveHitl: () => true,
    repos: () => [{ name: 'TerMinal', path: '/repos/TerMinal' }],
    startSession: (input) => ({ key: `phone-${input.cwd.length}` }),
    ...over,
  })

  it('lists threads with a needs-you flag derived from session status', async () => {
    const h = await harness({
      ...chatDeps(),
      sessions: () => [session({ status: 'working' }), session({ key: 'b', status: 'idle' })],
    })
    const body = await (await fetch(`${h.url}/v1/chats`, { headers: auth })).json()
    expect(body.threads.map((t: { needsInput: boolean }) => t.needsInput)).toEqual([false, true])
    expect(body.threads[0].chat).toBe(true)
    expect(body.hitl[0].id).toBe('h1')
  })

  it('serves the normalized conversation for a session', async () => {
    const h = await harness(chatDeps())
    const body = await (await fetch(`${h.url}/v1/chats/sess-1/messages`, { headers: auth })).json()
    expect(body.messages.map((m: { kind: string }) => m.kind)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
    expect(body.total).toBe(3)
    expect(body.status).toBe('working')
  })

  it('404s messages for an unknown session', async () => {
    const h = await harness(chatDeps())
    expect((await fetch(`${h.url}/v1/chats/ghost/messages`, { headers: auth })).status).toBe(404)
  })

  it('reports 501 rather than pretending when an engine has no chat', async () => {
    const h = await harness({ ...chatDeps(), messages: undefined })
    expect((await fetch(`${h.url}/v1/chats/sess-1/messages`, { headers: auth })).status).toBe(501)
  })

  it('send appends a carriage return so the agent actually receives the prompt', async () => {
    const h = await harness(chatDeps())
    const res = await fetch(`${h.url}/v1/chats/sess-1/send`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'ship it' }),
    })
    expect(res.status).toBe(200)
    expect(h.written[0].data.toString('utf8')).toBe('ship it\r')
  })

  it('flattens newlines so a multi-line draft cannot submit early', async () => {
    // Each newline would otherwise be a separate Enter, firing the first line
    // as a prompt and leaving the rest as stray input.
    const h = await harness(chatDeps())
    await fetch(`${h.url}/v1/chats/sess-1/send`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'line one\nline two' }),
    })
    expect(h.written[0].data.toString('utf8')).toBe('line one line two\r')
  })

  it('rejects an empty or missing send body', async () => {
    const h = await harness(chatDeps())
    for (const body of ['{}', '{"text":""}', '{"text":"   "}', 'nonsense']) {
      const res = await fetch(`${h.url}/v1/chats/sess-1/send`, {
        method: 'POST',
        headers: auth,
        body,
      })
      expect(res.status).toBe(400)
    }
    expect(h.written).toHaveLength(0)
  })

  it('interrupt sends a real Ctrl-C byte', async () => {
    const h = await harness(chatDeps())
    const res = await fetch(`${h.url}/v1/chats/sess-1/interrupt`, { method: 'POST', headers: auth })
    expect(res.status).toBe(200)
    expect([...h.written[0].data]).toEqual([0x03])
  })

  it('resolves a HITL item through the app write path', async () => {
    // Object holder: control-flow analysis narrows a null-initialised `let` to
    // `null` when it is only assigned inside a closure.
    const seen: { args?: [string, boolean] } = {}
    const h = await harness({
      ...chatDeps(),
      resolveHitl: (id, resolved) => {
        seen.args = [id, resolved]
        return true
      },
    })
    const res = await fetch(`${h.url}/v1/hitl/h1`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ resolved: false }),
    })
    expect(res.status).toBe(200)
    expect(seen.args).toEqual(['h1', false])
  })

  it('defaults a HITL resolve with no body to resolved', async () => {
    const seen: { resolved?: boolean } = {}
    const h = await harness({
      ...chatDeps(),
      resolveHitl: (_id, resolved) => {
        seen.resolved = resolved
        return true
      },
    })
    await fetch(`${h.url}/v1/hitl/h1`, { method: 'POST', headers: auth })
    expect(seen.resolved).toBe(true)
  })

  it('starts a session from the phone', async () => {
    const h = await harness(chatDeps())
    const res = await fetch(`${h.url}/v1/sessions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ cwd: '/repos/TerMinal', engine: 'codex' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).key).toMatch(/^phone-/)
  })

  it('refuses to start a session with no cwd', async () => {
    const h = await harness(chatDeps())
    const res = await fetch(`${h.url}/v1/sessions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ engine: 'codex' }),
    })
    expect(res.status).toBe(400)
  })

  it('requires a token on every chat route', async () => {
    const h = await harness(chatDeps())
    for (const [path, init] of [
      ['/v1/chats', {}],
      ['/v1/hitl', {}],
      ['/v1/repos', {}],
      ['/v1/chats/sess-1/messages', {}],
      ['/v1/chats/sess-1/send', { method: 'POST', body: '{"text":"x"}' }],
      ['/v1/chats/sess-1/interrupt', { method: 'POST' }],
      ['/v1/sessions', { method: 'POST', body: '{"cwd":"/x"}' }],
    ] as const) {
      expect((await fetch(`${h.url}${path}`, init as RequestInit)).status).toBe(401)
    }
    expect(h.written).toHaveLength(0)
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/tickets`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${h.url}/`, { headers: auth })).status).toBe(404)
  })
})
