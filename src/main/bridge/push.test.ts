import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createVerify } from 'node:crypto'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apnsJwt,
  forgetDevice,
  pushConfigured,
  pushStatus,
  readApnsConfig,
  readDevices,
  registerDevice,
  sendPush,
} from './push'

const tmp = () => mkdtempSync(join(tmpdir(), 'gt-push-'))

/** A throwaway P-256 key in the same shape Apple issues. */
function ecKey(dir: string): string {
  const path = join(dir, 'apns.p8')
  execFileSync('openssl', ['ecparam', '-genkey', '-name', 'prime256v1', '-noout', '-out', path], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const pkcs8 = execFileSync(
    'openssl',
    ['pkcs8', '-topk8', '-nocrypt', '-in', path, '-outform', 'pem'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString()
  writeFileSync(path, pkcs8)
  return pkcs8
}

function configure(dir: string): string {
  const key = ecKey(dir)
  writeFileSync(
    join(dir, 'apns.json'),
    JSON.stringify({
      keyId: 'ABC1234567',
      teamId: 'ABCDE12345',
      bundleId: 'com.example.terminal',
    }),
  )
  return key
}

describe('apnsJwt', () => {
  it('produces a verifiable ES256 JWT with the key id in the header', () => {
    const dir = tmp()
    const key = configure(dir)
    const config = readApnsConfig(dir)!
    const jwt = apnsJwt(config, key, 1_784_000_000_000)

    const [header, payload, signature] = jwt.split('.')
    const decode = (s: string) =>
      JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'ABC1234567' })
    expect(decode(payload)).toEqual({ iss: 'ABCDE12345', iat: 1_784_000_000 })

    // Apple rejects DER signatures; JWS requires the raw r||s pair, which for
    // P-256 is exactly 64 bytes. This is the detail that silently breaks push.
    const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(raw.length).toBe(64)

    const verifier = createVerify('SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true)
  })

  it('is url-safe base64 with no padding', () => {
    const dir = tmp()
    const key = configure(dir)
    const jwt = apnsJwt(readApnsConfig(dir)!, key)
    expect(jwt).not.toMatch(/[+/=]/)
  })
})

describe('configuration', () => {
  it('reports unconfigured until both the config and the key exist', () => {
    const dir = tmp()
    expect(pushConfigured(dir)).toBe(false)

    writeFileSync(
      join(dir, 'apns.json'),
      JSON.stringify({ keyId: 'k', teamId: 't', bundleId: 'b' }),
    )
    expect(pushConfigured(dir)).toBe(false) // key still missing

    ecKey(dir)
    expect(pushConfigured(dir)).toBe(true)
  })

  it('rejects a partial config rather than half-configuring', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'apns.json'), JSON.stringify({ keyId: 'k' }))
    expect(readApnsConfig(dir)).toBeNull()
  })
})

describe('device registry', () => {
  it('registers, dedupes, and forgets', () => {
    const dir = tmp()
    registerDevice('AABB1122', 'sandbox', dir)
    registerDevice('CCDD3344', 'production', dir)
    expect(readDevices(dir)).toHaveLength(2)

    // Re-registering refreshes rather than duplicating.
    registerDevice('AABB1122', 'production', dir)
    const devices = readDevices(dir)
    expect(devices).toHaveLength(2)
    expect(devices.find((d) => d.token === 'AABB1122')?.environment).toBe('production')

    forgetDevice('AABB1122', dir)
    expect(readDevices(dir).map((d) => d.token)).toEqual(['CCDD3344'])
  })

  it('normalises a token and ignores junk', () => {
    const dir = tmp()
    // iOS hands the token over as hex; strip anything a client wrapped it in.
    registerDevice('<AABB 1122>', 'sandbox', dir)
    expect(readDevices(dir)[0].token).toBe('AABB1122')

    registerDevice('   ', 'sandbox', dir)
    expect(readDevices(dir)).toHaveLength(1)
  })

  it('keeps the device list owner-only — it is a push capability', () => {
    const dir = tmp()
    registerDevice('AABB1122', 'sandbox', dir)
    expect(statSync(join(dir, 'devices.json')).mode & 0o077).toBe(0)
  })

  it('survives a corrupt registry rather than throwing', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'devices.json'), 'not json')
    expect(readDevices(dir)).toEqual([])
  })
})

describe('sendPush', () => {
  it('is a no-op when push is not configured', async () => {
    const dir = tmp()
    registerDevice('AABB1122', 'sandbox', dir)
    expect(await sendPush({ title: 't', body: 'b' }, dir)).toEqual({
      sent: 0,
      failed: 0,
      errors: [],
    })
  })

  it('is a no-op when configured but no device has registered', async () => {
    const dir = tmp()
    configure(dir)
    expect(await sendPush({ title: 't', body: 'b' }, dir)).toEqual({
      sent: 0,
      failed: 0,
      errors: [],
    })
  })

  it('reports status for the Settings pane', () => {
    const dir = tmp()
    expect(pushStatus(dir)).toEqual({ configured: false, devices: 0 })
    configure(dir)
    registerDevice('AABB1122', 'sandbox', dir)
    expect(pushStatus(dir)).toEqual({ configured: true, devices: 1 })
  })
})
