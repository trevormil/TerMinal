import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bridgeHosts,
  certFingerprint,
  ensureIdentity,
  pairingPayload,
  resetIdentity,
  rotateToken,
  tokenMatches,
} from './identity'

const tmp = () => mkdtempSync(join(tmpdir(), 'gt-bridge-'))

describe('ensureIdentity', () => {
  it('generates a token and a self-signed cert, then reuses both verbatim', () => {
    const dir = tmp()
    const a = ensureIdentity(dir)
    expect(a.token.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
    expect(a.certPem).toContain('BEGIN CERTIFICATE')
    expect(a.keyPem).toContain('PRIVATE KEY')
    expect(a.fingerprint).toMatch(/^[A-Za-z0-9+/]{43}=$/) // base64 sha256

    // Re-enabling the bridge must not invalidate an already-paired phone.
    const b = ensureIdentity(dir)
    expect(b.token).toBe(a.token)
    expect(b.certPem).toBe(a.certPem)
    expect(b.fingerprint).toBe(a.fingerprint)
  })

  it('writes the token and private key owner-only', () => {
    const dir = tmp()
    ensureIdentity(dir)
    for (const f of ['token', 'key.pem']) {
      expect(statSync(join(dir, f)).mode & 0o077).toBe(0)
    }
  })

  it('regenerates a corrupt cert instead of serving it', () => {
    const dir = tmp()
    ensureIdentity(dir)
    writeFileSync(join(dir, 'cert.pem'), 'not a certificate')
    const fixed = ensureIdentity(dir)
    expect(fixed.certPem).toContain('BEGIN CERTIFICATE')
    expect(readFileSync(join(dir, 'cert.pem'), 'utf8')).toContain('BEGIN CERTIFICATE')
  })

  it('fingerprint tracks the cert on disk', () => {
    const dir = tmp()
    const id = ensureIdentity(dir)
    expect(certFingerprint(readFileSync(join(dir, 'cert.pem'), 'utf8'))).toBe(id.fingerprint)
  })
})

describe('rotateToken', () => {
  it('changes the token but keeps the pinned cert', () => {
    const dir = tmp()
    const before = ensureIdentity(dir)
    const after = rotateToken(dir)
    expect(after.token).not.toBe(before.token)
    expect(after.fingerprint).toBe(before.fingerprint)
  })
})

describe('resetIdentity', () => {
  it('forces a brand new token and cert', () => {
    const dir = tmp()
    const before = ensureIdentity(dir)
    resetIdentity(dir)
    const after = ensureIdentity(dir)
    expect(after.token).not.toBe(before.token)
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })
})

describe('tokenMatches', () => {
  it('accepts the exact token and nothing else', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abd', 'abc')).toBe(false)
    // A prefix must not pass — the length difference is handled by digesting.
    expect(tokenMatches('ab', 'abc')).toBe(false)
    expect(tokenMatches('abcd', 'abc')).toBe(false)
  })

  it('never authenticates against an empty expected token', () => {
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches('anything', '')).toBe(false)
  })
})

describe('bridgeHosts', () => {
  it('puts the tailnet address first so off-LAN pairing works', () => {
    const hosts = bridgeHosts({
      en0: [
        { family: 'IPv4', address: '192.168.1.42', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false },
      ],
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      utun4: [{ family: 'IPv4', address: '100.126.73.11', internal: false }],
    } as never)
    expect(hosts).toEqual(['100.126.73.11', '192.168.1.42'])
  })

  it('drops loopback and dedupes', () => {
    const hosts = bridgeHosts({
      en0: [{ family: 'IPv4', address: '10.0.0.7', internal: false }],
      en1: [{ family: 'IPv4', address: '10.0.0.7', internal: false }],
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    } as never)
    expect(hosts).toEqual(['10.0.0.7'])
  })
})

describe('pairingPayload', () => {
  it('carries everything the phone needs and nothing it does not', () => {
    const dir = tmp()
    const identity = ensureIdentity(dir)
    const payload = pairingPayload({
      port: 8790,
      identity,
      name: "Trevor's MacBook",
      hosts: ['100.126.73.11'],
    })
    expect(payload).toEqual({
      v: 1,
      n: "Trevor's MacBook",
      p: 8790,
      h: ['100.126.73.11'],
      t: identity.token,
      fp: identity.fingerprint,
    })
    // The private key must never reach the QR.
    expect(JSON.stringify(payload)).not.toContain('PRIVATE KEY')
  })
})
