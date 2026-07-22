import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridgeHandler, type BridgeDeps, type BridgeRemoteSession } from './server'

const TOKEN = 'test-token-value'

function session(over: Partial<BridgeRemoteSession> = {}): BridgeRemoteSession {
  return {
    id: 'sess-1',
    title: 'ship the PR',
    repo: 'TerMinal',
    branch: 'main',
    engine: 'claude',
    status: 'working',
    lastSeenAt: 100,
    messages: 2,
    ...over,
  }
}

type Harness = {
  url: string
  replies: { id: string; text: string }[]
  close: () => Promise<void>
}

const servers: Server[] = []

async function harness(over: Partial<BridgeDeps> = {}, token = TOKEN): Promise<Harness> {
  const replies: { id: string; text: string }[] = []
  const deps: BridgeDeps = {
    sessions: () => [session()],
    messages: (_id, opts) =>
      [
        { at: 1, from: 'agent' as const, text: 'tests green' },
        { at: 2, from: 'user' as const, text: 'merge it' },
      ].slice(opts.after ?? 0),
    reply: (id, text) => {
      if (id !== 'sess-1') return false
      replies.push({ id, text })
      return true
    },
    hitl: () => [
      { id: 'h1', title: 'Approve deploy', source: 'agent', createdAt: 5, repo: 'TerMinal' },
    ],
    resolveHitl: () => true,
    registerDevice: () => {},
    ...over,
  }
  const s = createServer(createBridgeHandler(deps, () => token))
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}`,
    replies,
    close: () => new Promise<void>((r) => s.close(() => r())),
  }
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
})

const auth = { authorization: `Bearer ${TOKEN}` }

describe('auth', () => {
  it('rejects a missing, malformed, or wrong token', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/remote`)).status).toBe(401)
    expect((await fetch(`${h.url}/v1/remote`, { headers: { authorization: TOKEN } })).status).toBe(
      401,
    )
    expect(
      (await fetch(`${h.url}/v1/remote`, { headers: { authorization: 'Bearer nope' } })).status,
    ).toBe(401)
  })

  it('accepts the exact token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/remote`, { headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()).sessions[0].id).toBe('sess-1')
  })

  it('refuses everything when no token is provisioned', async () => {
    const h = await harness({}, '')
    expect((await fetch(`${h.url}/v1/remote`, { headers: auth })).status).toBe(401)
  })

  it('requires a token on every route', async () => {
    const h = await harness()
    for (const [path, init] of [
      ['/v1/remote', {}],
      ['/v1/hitl', {}],
      ['/v1/remote/sess-1/messages', {}],
      ['/v1/remote/sess-1/reply', { method: 'POST', body: '{"text":"x"}' }],
      ['/v1/hitl/h1', { method: 'POST' }],
      ['/v1/devices', { method: 'POST', body: '{"token":"a"}' }],
    ] as const) {
      expect((await fetch(`${h.url}${path}`, init as RequestInit)).status).toBe(401)
    }
    expect(h.replies).toHaveLength(0)
  })
})

describe('GET /v1/health', () => {
  it('answers without a token and leaks nothing', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/health`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({ ok: true, app: 'TerMinal' })
    expect(body).not.toContain('sess-1')
    expect(body).not.toContain(TOKEN)
  })
})

describe('GET /v1/remote', () => {
  it('returns registered sessions and the blocked queue together', async () => {
    const h = await harness()
    const body = await (await fetch(`${h.url}/v1/remote`, { headers: auth })).json()
    expect(body.sessions[0].title).toBe('ship the PR')
    expect(body.hitl[0].id).toBe('h1')
  })

  it('surfaces what an awaiting session is blocked on', async () => {
    const h = await harness({
      sessions: () => [session({ status: 'awaiting', question: 'merge it?' })],
    })
    const body = await (await fetch(`${h.url}/v1/remote`, { headers: auth })).json()
    expect(body.sessions[0].status).toBe('awaiting')
    expect(body.sessions[0].question).toBe('merge it?')
  })

  it('awaits an async hitl source, so remote hosts can be folded in', async () => {
    const h = await harness({
      hitl: async () => [{ id: 'tm-1', title: 'creds needed', source: 'agent', createdAt: 1 }],
    })
    const body = await (await fetch(`${h.url}/v1/remote`, { headers: auth })).json()
    expect(body.hitl[0].id).toBe('tm-1')
  })
})

describe('GET /v1/remote/:id/messages', () => {
  it('returns the conversation with the session status', async () => {
    const h = await harness()
    const body = await (await fetch(`${h.url}/v1/remote/sess-1/messages`, { headers: auth })).json()
    expect(body.messages.map((m: { from: string }) => m.from)).toEqual(['agent', 'user'])
    expect(body.status).toBe('working')
  })

  it('paginates with after, so the phone fetches only what is new', async () => {
    const h = await harness()
    const body = await (
      await fetch(`${h.url}/v1/remote/sess-1/messages?after=1`, { headers: auth })
    ).json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].text).toBe('merge it')
  })

  it('404s an unregistered session', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/remote/ghost/messages`, { headers: auth })).status).toBe(404)
  })
})

describe('images', () => {
  it('accepts a base64 image on reply and stores it', async () => {
    const saved: { id: string; ext: string; bytes: number }[] = []
    const replies: { id: string; text: string; images?: string[] }[] = []
    const h = await harness({
      saveImage: (id, data, ext) => {
        saved.push({ id, ext, bytes: data.length })
        return `stored.${ext}`
      },
      reply: (id, text, images) => {
        replies.push({ id, text, images })
        return id === 'sess-1'
      },
    })
    const res = await fetch(`${h.url}/v1/remote/sess-1/reply`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        text: 'look',
        images: [{ ext: 'png', data: Buffer.from([1, 2, 3]).toString('base64') }],
      }),
    })
    expect(res.status).toBe(200)
    expect(saved).toEqual([{ id: 'sess-1', ext: 'png', bytes: 3 }])
    expect(replies[0].images).toEqual(['stored.png'])
  })

  it('allows an image-only reply', async () => {
    const replies: { images?: string[] }[] = []
    const h = await harness({
      saveImage: () => 'x.png',
      reply: (_id, _text, images) => {
        replies.push({ images })
        return true
      },
    })
    const res = await fetch(`${h.url}/v1/remote/sess-1/reply`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ images: [{ ext: 'png', data: 'AQID' }] }),
    })
    expect(res.status).toBe(200)
    expect(replies[0].images).toEqual(['x.png'])
  })

  it('serves a stored image with an image content-type', async () => {
    const tmpImg = mkdtempSync(join(tmpdir(), 'gt-img-'))
    const file = join(tmpImg, 'a.png')
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const h = await harness({ imagePath: () => file })
    const res = await fetch(`${h.url}/v1/remote/sess-1/image/a.png`, { headers: auth })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89)
  })

  it('404s an image the session does not have', async () => {
    const h = await harness({ imagePath: () => null })
    expect(
      (await fetch(`${h.url}/v1/remote/sess-1/image/none.png`, { headers: auth })).status,
    ).toBe(404)
  })
})

describe('POST /v1/remote/:id/reply', () => {
  it('queues a reply for the agent to collect', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/remote/sess-1/reply`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'yes, but squash' }),
    })
    expect(res.status).toBe(200)
    expect(h.replies).toEqual([{ id: 'sess-1', text: 'yes, but squash' }])
  })

  it('trims and rejects an empty reply rather than queueing noise', async () => {
    const h = await harness()
    for (const body of ['{}', '{"text":""}', '{"text":"   "}', 'nonsense']) {
      const res = await fetch(`${h.url}/v1/remote/sess-1/reply`, {
        method: 'POST',
        headers: auth,
        body,
      })
      expect(res.status).toBe(400)
    }
    expect(h.replies).toHaveLength(0)
  })

  it('404s an unregistered session instead of dropping the message silently', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/remote/ghost/reply`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ text: 'hello?' }),
    })
    expect(res.status).toBe(404)
    expect(h.replies).toHaveLength(0)
  })
})

describe('hitl + devices', () => {
  it('resolves an item through the app write path', async () => {
    const seen: { args?: [string, boolean] } = {}
    const h = await harness({
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

  it('defaults a resolve with no body to resolved', async () => {
    const seen: { resolved?: boolean } = {}
    const h = await harness({
      resolveHitl: (_id, resolved) => {
        seen.resolved = resolved
        return true
      },
    })
    await fetch(`${h.url}/v1/hitl/h1`, { method: 'POST', headers: auth })
    expect(seen.resolved).toBe(true)
  })

  it('registers a push token, defaulting to the sandbox environment', async () => {
    const seen: { args?: [string, string] } = {}
    const h = await harness({
      registerDevice: (token, environment) => {
        seen.args = [token, environment]
      },
    })
    await fetch(`${h.url}/v1/devices`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ token: 'AABB' }),
    })
    expect(seen.args).toEqual(['AABB', 'sandbox'])

    await fetch(`${h.url}/v1/devices`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ token: 'CCDD', environment: 'production' }),
    })
    expect(seen.args).toEqual(['CCDD', 'production'])
  })

  it('rejects a device registration with no token', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/devices`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('spawning sessions from the phone', () => {
  it('lists repos the phone may start a session in', async () => {
    const h = await harness({
      repos: () => [
        { name: 'alpha', path: '/repos/alpha' },
        { name: 'beta', path: '/repos/beta' },
      ],
    })
    const body = await (await fetch(`${h.url}/v1/repos`, { headers: auth })).json()
    expect(body.repos.map((r: { name: string }) => r.name)).toEqual(['alpha', 'beta'])
  })

  it('spawns a session and returns the remote thread id', async () => {
    const seen: unknown[] = []
    const h = await harness({
      spawn: (input) => {
        seen.push(input)
        return { id: 'thread-1' }
      },
    })
    const res = await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ cwd: '/repos/alpha', engine: 'claude', task: 'fix the tests' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('thread-1')
    expect(seen).toEqual([{ cwd: '/repos/alpha', engine: 'claude', task: 'fix the tests' }])
  })

  it('requires a cwd and rejects a blank task down to undefined', async () => {
    const seen: unknown[] = []
    const h = await harness({
      spawn: (input) => {
        seen.push(input)
        return { id: 'x' }
      },
    })
    const bad = await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ engine: 'claude' }),
    })
    expect(bad.status).toBe(400)

    await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ cwd: '/repos/alpha', task: '   ' }),
    })
    expect(seen).toEqual([{ cwd: '/repos/alpha', engine: undefined, task: undefined }])
  })

  it('surfaces a spawn failure as an error, not a fake id', async () => {
    const h = await harness({ spawn: () => ({ error: 'TerMinal is not running' }) })
    const res = await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ cwd: '/repos/alpha' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('TerMinal is not running')
  })

  it('501s when spawning is not wired, and requires a token', async () => {
    const h = await harness()
    expect(
      (
        await fetch(`${h.url}/v1/remote/new`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ cwd: '/x' }),
        })
      ).status,
    ).toBe(501)
    expect(
      (
        await fetch(`${h.url}/v1/remote/new`, {
          method: 'POST',
          body: JSON.stringify({ cwd: '/x' }),
        })
      ).status,
    ).toBe(401)
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/sessions`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${h.url}/`, { headers: auth })).status).toBe(404)
  })
})
