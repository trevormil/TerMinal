import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import {
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

async function harness(over: Partial<BridgeDeps> = {}, token = TOKEN): Promise<Harness> {
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
  const s = createServer(createBridgeHandler(deps, () => token))
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

describe('unknown routes', () => {
  it('404s', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/tickets`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${h.url}/`, { headers: auth })).status).toBe(404)
  })
})
