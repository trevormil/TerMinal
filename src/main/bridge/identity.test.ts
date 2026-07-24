import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bridgeHosts,
  certFingerprint,
  ensureIdentity,
  isTailscaleIp,
  pairingPayload,
  resetIdentity,
  rotateToken,
  tokenMatches,
} from './identity'

describe('isTailscaleIp', () => {
  it('accepts a tailnet peer on IPv4 CGNAT OR IPv6 ULA', () => {
    expect(isTailscaleIp('100.64.1.2')).toBe(true)
    expect(isTailscaleIp('100.126.73.11')).toBe(true)
    expect(isTailscaleIp('::ffff:100.100.1.2')).toBe(true)
    // A phone reaching the Mac over the tailnet may arrive on IPv6 — must pass
    // the pre-check or /v1/pair 403s it before whois runs.
    expect(isTailscaleIp('fd7a:115c:a1e0:ab12::1')).toBe(true)
    expect(isTailscaleIp('FD7A:115C:A1E0::7')).toBe(true)
  })
  it('rejects LAN / internet / loopback addresses', () => {
    expect(isTailscaleIp('192.168.1.5')).toBe(false)
    expect(isTailscaleIp('100.63.255.255')).toBe(false)
    expect(isTailscaleIp('::1')).toBe(false)
    expect(isTailscaleIp('8.8.8.8')).toBe(false)
  })
})

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
      utun4: [{ family: 'IPv4', address: '100.100.1.2', internal: false }],
    } as never)
    expect(hosts).toEqual(['100.100.1.2', '192.168.1.42'])
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
      name: 'My Mac',
      hosts: ['100.100.1.2'],
    })
    expect(payload).toEqual({
      v: 1,
      n: 'My Mac',
      p: 8790,
      h: ['100.100.1.2'],
      t: identity.token,
      fp: identity.fingerprint,
    })
    // The private key must never reach the QR.
    expect(JSON.stringify(payload)).not.toContain('PRIVATE KEY')
  })
})
