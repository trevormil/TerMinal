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
    // The paths the workspace/spawn tests exercise are "advertised" by default,
    // so those tests pass the path-authorization gate. Tests about the gate
    // itself override `repos` with a narrower set.
    repos: () => [
      { name: 'x', path: '/x' },
      { name: 'rx', path: '/r/x' },
      { name: 'alpha', path: '/repos/alpha' },
      { name: 'beta', path: '/repos/beta' },
    ],
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

describe('GET /v1/pair (tailnet)', () => {
  // Pairing is fenced to tailnet (CGNAT) source addresses, which a loopback
  // test socket can never present — so drive the handler directly with a fake
  // socket instead of a real connection.
  type PairResult = { status: number; body: Record<string, unknown> }
  function pairHandler(over: Partial<BridgeDeps> = {}) {
    const deps: BridgeDeps = {
      sessions: () => [],
      messages: () => [],
      reply: () => false,
      ...over,
    }
    return createBridgeHandler(deps, () => TOKEN)
  }
  function pair(
    handler: ReturnType<typeof createBridgeHandler>,
    remoteAddress = '100.64.1.2',
  ): Promise<PairResult> {
    return new Promise((resolve) => {
      const req = {
        method: 'GET',
        url: '/v1/pair',
        headers: {},
        socket: { remoteAddress, remotePort: 4242 },
      }
      const res = {
        statusCode: 0,
        writeHead(status: number) {
          this.statusCode = status
          return this
        },
        end(payload: unknown) {
          resolve({ status: this.statusCode, body: JSON.parse(String(payload)) })
        },
        on() {},
      }
      handler(req as never, res as never)
    })
  }

  it('hands the payload to a verified peer without a token', async () => {
    const seen: string[] = []
    const h = pairHandler({
      tailscalePair: (peer) => {
        seen.push(peer)
        return { token: 'tok', fp: 'fp', name: 'MacBook' }
      },
    })
    // No Authorization header — pairing runs before the phone has a token.
    const res = await pair(h, '100.64.1.2')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ token: 'tok', fp: 'fp', name: 'MacBook' })
    // The peer address came from the socket, not the client.
    expect(seen[0]).toBe('100.64.1.2:4242')
  })

  it('strips the IPv4-mapped prefix a dual-stack socket reports', async () => {
    const seen: string[] = []
    const h = pairHandler({
      tailscalePair: (peer) => {
        seen.push(peer)
        return { token: 'tok', fp: 'fp', name: 'MacBook' }
      },
    })
    expect((await pair(h, '::ffff:100.64.1.2')).status).toBe(200)
    expect(seen[0]).toBe('100.64.1.2:4242')
  })

  it('403s a peer the tailnet does not vouch for', async () => {
    const h = pairHandler({ tailscalePair: () => null })
    expect((await pair(h)).status).toBe(403)
  })

  it('rejects a non-tailnet source address without ever calling the dep', async () => {
    let calls = 0
    const h = pairHandler({
      tailscalePair: () => {
        calls++
        return { token: 'tok', fp: 'fp', name: 'MacBook' }
      },
    })
    for (const addr of ['127.0.0.1', '192.168.1.9', '10.0.0.4', '8.8.8.8', '::1', '']) {
      expect((await pair(h, addr)).status).toBe(403)
    }
    expect(calls).toBe(0)
  })

  it('rate-limits rapid pairing attempts', async () => {
    const h = pairHandler({ tailscalePair: () => null })
    for (let i = 0; i < 6; i++) expect((await pair(h)).status).toBe(403)
    expect((await pair(h)).status).toBe(429)
  })

  it('single-flights concurrent pairing attempts', async () => {
    let release: (v: null) => void = () => {}
    const h = pairHandler({
      tailscalePair: () => new Promise<null>((r) => (release = r)),
    })
    const first = pair(h)
    // While the first verification is still in flight, a second is refused.
    expect((await pair(h)).status).toBe(429)
    release(null)
    expect((await first).status).toBe(403)
  })

  it('501s when tailnet pairing is not wired', async () => {
    const h = pairHandler()
    expect((await pair(h)).status).toBe(501)
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

describe('terminate and delete', () => {
  it('POST /:id/end terminates via endRemote', async () => {
    const ended: string[] = []
    const h = await harness({ endRemote: (id) => (ended.push(id), true) })
    const res = await fetch(`${h.url}/v1/remote/sess-1/end`, { method: 'POST', headers: auth })
    expect(res.status).toBe(200)
    expect(ended).toEqual(['sess-1'])
  })

  it('POST /:id/end 404s for an unknown session', async () => {
    const h = await harness({ endRemote: () => true })
    const res = await fetch(`${h.url}/v1/remote/ghost/end`, { method: 'POST', headers: auth })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id removes via deleteRemote', async () => {
    const deleted: string[] = []
    const h = await harness({ deleteRemote: (id) => (deleted.push(id), true) })
    const res = await fetch(`${h.url}/v1/remote/sess-1`, { method: 'DELETE', headers: auth })
    expect(res.status).toBe(200)
    expect(deleted).toEqual(['sess-1'])
  })

  it('DELETE /:id 404s when nothing was removed', async () => {
    const h = await harness({ deleteRemote: () => false })
    const res = await fetch(`${h.url}/v1/remote/sess-1`, { method: 'DELETE', headers: auth })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id 501s when the dep is absent', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/remote/sess-1`, { method: 'DELETE', headers: auth })
    expect(res.status).toBe(501)
  })

  it('end and delete require auth', async () => {
    const h = await harness({ endRemote: () => true, deleteRemote: () => true })
    expect((await fetch(`${h.url}/v1/remote/sess-1/end`, { method: 'POST' })).status).toBe(401)
    expect((await fetch(`${h.url}/v1/remote/sess-1`, { method: 'DELETE' })).status).toBe(401)
  })
})

describe('workspaces', () => {
  it('lists workspaces from repos()', async () => {
    const h = await harness({ repos: () => [{ name: 'TerMinal', path: '/r/TerMinal' }] })
    const body = await (await fetch(`${h.url}/v1/workspaces`, { headers: auth })).json()
    expect(body.workspaces).toEqual([{ name: 'TerMinal', path: '/r/TerMinal' }])
  })

  it('returns per-workspace tickets for the requested repo', async () => {
    const seen: string[] = []
    const h = await harness({
      workspaceTickets: (repo) => {
        seen.push(repo)
        return [
          {
            slug: 's',
            id: 1,
            title: 't',
            status: 'todo',
            priority: 'high',
            type: 'bug',
            hitl: false,
          },
        ]
      },
    })
    const res = await fetch(`${h.url}/v1/workspaces/tickets?repo=${encodeURIComponent('/r/x')}`, {
      headers: auth,
    })
    const body = await res.json()
    expect(seen).toEqual(['/r/x'])
    expect(body.tickets).toHaveLength(1)
  })

  it('400s without a repo, 501 when the dep is absent, 404 for an unknown kind', async () => {
    const h = await harness({ workspacePrs: () => [] })
    expect((await fetch(`${h.url}/v1/workspaces/prs`, { headers: auth })).status).toBe(400)
    // runs dep absent → 501
    expect((await fetch(`${h.url}/v1/workspaces/runs?repo=/r/x`, { headers: auth })).status).toBe(
      501,
    )
    // unknown kind → 404
    expect((await fetch(`${h.url}/v1/workspaces/nope?repo=/r/x`, { headers: auth })).status).toBe(
      404,
    )
  })

  it('requires auth', async () => {
    const h = await harness({ repos: () => [] })
    expect((await fetch(`${h.url}/v1/workspaces`)).status).toBe(401)
    expect((await fetch(`${h.url}/v1/workspaces/tickets?repo=/r/x`)).status).toBe(401)
  })
})

describe('inbox read-state', () => {
  it('POST /v1/hitl/read marks the given ids and returns the count', async () => {
    const seen: string[][] = []
    const h = await harness({
      markHitlRead: (ids) => {
        seen.push(ids)
        return ids.length
      },
    })
    const res = await fetch(`${h.url}/v1/hitl/read`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['a', 'b'] }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).marked).toBe(2)
    expect(seen).toEqual([['a', 'b']])
  })

  it('501s when read-state is unavailable, and requires auth', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/hitl/read`, { method: 'POST', headers: auth })).status).toBe(
      501,
    )
    expect((await fetch(`${h.url}/v1/hitl/read`, { method: 'POST' })).status).toBe(401)
  })
})

describe('checks', () => {
  it('GET /v1/checks returns the latest statuses and requires auth', async () => {
    const h = await harness({
      checks: () => [{ kind: 'fleet-health', status: 'warn', summary: '1 pod issue' }],
    })
    expect((await fetch(`${h.url}/v1/checks`)).status).toBe(401)
    const res = await fetch(`${h.url}/v1/checks`, { headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()).checks).toEqual([
      { kind: 'fleet-health', status: 'warn', summary: '1 pod issue' },
    ])
  })

  it('empty when no checks dep is wired', async () => {
    const h = await harness()
    const res = await fetch(`${h.url}/v1/checks`, { headers: auth })
    expect((await res.json()).checks).toEqual([])
  })
})

describe('workspace path authorization', () => {
  // The bearer token authenticates the device; it must NOT authorize an
  // arbitrary path. Every repo/cwd route is fenced to the advertised repos().
  const onlyAlpha = { repos: () => [{ name: 'alpha', path: '/repos/alpha' }] }

  it('refuses spawn into an unadvertised cwd, without calling spawn', async () => {
    let spawned = false
    const h = await harness({
      ...onlyAlpha,
      spawn: () => {
        spawned = true
        return { id: 'x' }
      },
    })
    const res = await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp', engine: 'codex', task: 'pwd' }),
    })
    expect(res.status).toBe(403)
    expect(spawned).toBe(false)
  })

  it('allows spawn into an advertised cwd', async () => {
    let seen = ''
    const h = await harness({
      ...onlyAlpha,
      spawn: (i) => {
        seen = i.cwd
        return { id: 'ok' }
      },
    })
    const res = await fetch(`${h.url}/v1/remote/new`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/repos/alpha' }),
    })
    expect(res.status).toBe(200)
    expect(seen).toBe('/repos/alpha')
  })

  it('refuses list + detail routes for an unadvertised repo, untouched deps', async () => {
    let touched = false
    const h = await harness({
      ...onlyAlpha,
      workspaceTickets: () => {
        touched = true
        return []
      },
      workspaceTicket: () => {
        touched = true
        return null
      },
      workspaceSchedule: () => {
        touched = true
        return null
      },
    })
    const tmp = encodeURIComponent('/tmp')
    for (const path of [
      `/v1/workspaces/tickets?repo=${tmp}`,
      `/v1/workspace/ticket?repo=${tmp}&slug=x`,
      `/v1/workspace/schedule?repo=${tmp}&id=s1`,
    ]) {
      const res = await fetch(`${h.url}${path}`, { headers: auth })
      expect(res.status).toBe(403)
    }
    expect(touched).toBe(false)
  })

  it('rejects a path that resolves outside the set via ..', async () => {
    const h = await harness({ ...onlyAlpha, workspaceTickets: () => [] })
    const sneaky = encodeURIComponent('/repos/alpha/../beta')
    expect(
      (await fetch(`${h.url}/v1/workspaces/tickets?repo=${sneaky}`, { headers: auth })).status,
    ).toBe(403)
  })
})

describe('workspace drill-downs', () => {
  it('returns a ticket detail for the requested repo+slug', async () => {
    const seen: string[] = []
    const h = await harness({
      workspaceTicket: (repo, slug) => {
        seen.push(`${repo}|${slug}`)
        return {
          slug,
          id: 7,
          title: 'ship it',
          status: 'todo',
          priority: 'high',
          type: 'feature',
          hitl: false,
          body: '# Full body\n\nwith markdown',
          acceptance: ['tests pass'],
        }
      },
    })
    const res = await fetch(
      `${h.url}/v1/workspace/ticket?repo=${encodeURIComponent('/r/x')}&slug=0007-ship`,
      { headers: auth },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(seen).toEqual(['/r/x|0007-ship'])
    expect(body.body).toContain('Full body')
    expect(body.acceptance).toEqual(['tests pass'])
  })

  it('passes the numeric iid through for a PR and its diff', async () => {
    const iids: number[] = []
    const h = await harness({
      workspacePr: (_r, iid) => {
        iids.push(iid)
        return {
          iid,
          title: 'feat',
          state: 'open',
          draft: false,
          author: 'me',
          url: 'u',
          labels: [],
          description: 'body',
          findings: [{ severity: 'high', title: 'bug', file: 'a.ts', line: 3 }],
        }
      },
      workspacePrDiff: (_r, iid) => ({ text: `diff for ${iid}`, truncated: false }),
    })
    const d = await (
      await fetch(`${h.url}/v1/workspace/pr?repo=/r/x&iid=120`, { headers: auth })
    ).json()
    expect(d.findings[0].file).toBe('a.ts')
    const diff = await (
      await fetch(`${h.url}/v1/workspace/pr-diff?repo=/r/x&iid=120`, { headers: auth })
    ).json()
    expect(diff.text).toBe('diff for 120')
    expect(iids).toEqual([120])
  })

  it('requires the run source, since it cannot be derived from the id', async () => {
    const calls: string[] = []
    const h = await harness({
      workspaceRunLog: (id, source, host) => {
        calls.push(`${id}|${source}|${host ?? '-'}`)
        return { text: 'log tail', truncated: true }
      },
    })
    // No source → refused rather than guessing the wrong log store.
    expect((await fetch(`${h.url}/v1/workspace/run-log?id=r1`, { headers: auth })).status).toBe(400)
    const ok = await (
      await fetch(`${h.url}/v1/workspace/run-log?id=r1&source=cron&host=tm`, { headers: auth })
    ).json()
    expect(ok.truncated).toBe(true)
    expect(calls).toEqual(['r1|cron|tm'])
  })

  it('404s a missing detail and 400s an unwired one', async () => {
    const h = await harness({ workspaceTicket: () => null })
    expect(
      (await fetch(`${h.url}/v1/workspace/ticket?repo=/r/x&slug=nope`, { headers: auth })).status,
    ).toBe(404)
    // schedule dep absent
    expect(
      (await fetch(`${h.url}/v1/workspace/schedule?repo=/r/x&id=s1`, { headers: auth })).status,
    ).toBe(400)
  })

  it('requires auth', async () => {
    const h = await harness({ workspaceTicket: () => null })
    expect((await fetch(`${h.url}/v1/workspace/ticket?repo=/r/x&slug=a`)).status).toBe(401)
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const h = await harness()
    expect((await fetch(`${h.url}/v1/sessions`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${h.url}/`, { headers: auth })).status).toBe(404)
  })
})
