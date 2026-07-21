import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { ensureIdentity } from './identity'
import { bridgeStatus, startBridge, stopBridge, type BridgeDeps } from './server'

// End-to-end over REAL TLS. The unit tests mount the router on plain http, so
// this file is the only thing proving the contract every paired phone depends
// on: the fingerprint in the QR must equal the fingerprint of the cert the
// server actually presents. If those ever drift, no device can connect.

const deps: BridgeDeps = {
  sessions: () => [
    {
      key: 'k1',
      sessionId: 's1',
      name: 'demo',
      cwd: '/repo',
      repo: 'TerMinal',
      branch: 'main',
      model: '',
      status: 'idle',
      engine: 'codex',
      cols: 80,
      rows: 24,
    },
  ],
  write: () => true,
  replay: () => '',
}

// A port unlikely to collide with anything the developer is running.
const PORT = 8987

afterEach(async () => {
  await stopBridge()
})

/** SHA-256 of the DER cert the server actually presents on the wire. */
function servedFingerprint(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate()
      sock.end()
      if (!cert?.raw) return reject(new Error('no peer certificate'))
      resolve(createHash('sha256').update(cert.raw).digest('base64'))
    })
    sock.on('error', reject)
  })
}

const get = (path: string, token?: string) =>
  fetch(`https://127.0.0.1:${PORT}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    // The client pins the fingerprint instead of validating a chain; this is
    // the test-side equivalent of the iOS URLSession delegate.
    tls: { rejectUnauthorized: false },
  } as RequestInit)

describe('startBridge over TLS', () => {
  it('serves the exact certificate whose fingerprint the QR advertises', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-tls-'))
    const identity = ensureIdentity(dir)
    const status = await startBridge(deps, { port: PORT, dir })
    expect(status.listening).toBe(true)

    expect(await servedFingerprint(PORT)).toBe(identity.fingerprint)
  })

  it('enforces the token over TLS and serves the session list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-tls-'))
    const identity = ensureIdentity(dir)
    await startBridge(deps, { port: PORT, dir })

    expect((await get('/v1/health')).status).toBe(200)
    expect((await get('/v1/sessions')).status).toBe(401)
    expect((await get('/v1/sessions', 'wrong')).status).toBe(401)

    const ok = await get('/v1/sessions', identity.token)
    expect(ok.status).toBe(200)
    expect((await ok.json()).sessions[0].key).toBe('k1')
  })

  it('releases the port on stop so nothing keeps listening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-tls-'))
    await startBridge(deps, { port: PORT, dir })
    expect(bridgeStatus().listening).toBe(true)

    await stopBridge()
    expect(bridgeStatus().listening).toBe(false)
    await expect(get('/v1/health')).rejects.toThrow()
  })

  it('reports the bind failure instead of pretending to listen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-tls-'))
    await startBridge(deps, { port: PORT, dir })

    // A second bridge on the same port cannot bind. startBridge stops the
    // previous server first, so hold the port with a raw listener instead.
    const { createServer } = await import('node:net')
    const blocker = createServer()
    await stopBridge()
    await new Promise<void>((r) => blocker.listen(PORT, '0.0.0.0', () => r()))

    const status = await startBridge(deps, { port: PORT, dir })
    expect(status.listening).toBe(false)
    // Bun and Node word the bind failure differently ("EADDRINUSE" vs "Is port
    // N in use?"); what matters is that a real reason reaches the Settings pane
    // rather than a silent no-op.
    expect(status.error).toBeTruthy()
    expect(status.error).toContain(String(PORT))
    expect(bridgeStatus().listening).toBe(false)

    await new Promise<void>((r) => blocker.close(() => r()))
  })
})
