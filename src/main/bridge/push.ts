import { createSign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect, constants, type ClientHttp2Session } from 'node:http2'
import { join } from 'node:path'
import { BRIDGE_DIR } from './identity'

// Push notifications, sent straight from this Mac to Apple.
//
// No relay and no third-party service: the Mac is awake whenever a session
// could need you, so it can sign its own APNs JWT and post to Apple directly.
// The phone hands us its device token over the already-authenticated bridge.
//
// Configuration lives in ~/.config/TerMinal/bridge/apns.json:
//   { "keyId": "ABC1234567", "teamId": "8UWQ486J94", "bundleId": "com.trevormil.terminal" }
// alongside the private key at ~/.config/TerMinal/bridge/apns.p8
// The key is created once by a human in the Apple developer portal — there is
// no API for minting APNs auth keys.

const APNS_PROD = 'https://api.push.apple.com'
const APNS_SANDBOX = 'https://api.sandbox.push.apple.com'
/** Apple rejects tokens older than 1h; refresh well inside that. */
const JWT_TTL_MS = 45 * 60 * 1000

export type ApnsConfig = {
  keyId: string
  teamId: string
  bundleId: string
}

/** A phone that asked to be notified. */
export type PushDevice = {
  token: string
  /** Debug builds talk to APNs sandbox, TestFlight/App Store to production. */
  environment: 'sandbox' | 'production'
  registeredAt: number
}

export type PushStatus = {
  configured: boolean
  devices: number
  lastError?: string
}

const configPath = (dir: string) => join(dir, 'apns.json')
const keyPath = (dir: string) => join(dir, 'apns.p8')
const devicesPath = (dir: string) => join(dir, 'devices.json')

export function readApnsConfig(dir: string = BRIDGE_DIR): ApnsConfig | null {
  try {
    const raw = JSON.parse(readFileSync(configPath(dir), 'utf8')) as Partial<ApnsConfig>
    if (!raw.keyId || !raw.teamId || !raw.bundleId) return null
    return { keyId: raw.keyId, teamId: raw.teamId, bundleId: raw.bundleId }
  } catch {
    return null
  }
}

export function readApnsKey(dir: string = BRIDGE_DIR): string | null {
  try {
    const pem = readFileSync(keyPath(dir), 'utf8')
    return pem.includes('PRIVATE KEY') ? pem : null
  } catch {
    return null
  }
}

export function pushConfigured(dir: string = BRIDGE_DIR): boolean {
  return !!readApnsConfig(dir) && !!readApnsKey(dir)
}

// ---- device registry -------------------------------------------------------

export function readDevices(dir: string = BRIDGE_DIR): PushDevice[] {
  try {
    const raw = JSON.parse(readFileSync(devicesPath(dir), 'utf8')) as unknown
    return Array.isArray(raw) ? (raw as PushDevice[]).filter((d) => !!d?.token) : []
  } catch {
    return []
  }
}

function writeDevices(devices: PushDevice[], dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(devicesPath(dir), JSON.stringify(devices, null, 2), { mode: 0o600 })
  try {
    chmodSync(devicesPath(dir), 0o600)
  } catch {
    /* best effort */
  }
}

/** Idempotent: re-registering the same token refreshes it rather than duping. */
export function registerDevice(
  token: string,
  environment: PushDevice['environment'],
  dir: string = BRIDGE_DIR,
): PushDevice[] {
  const clean = String(token || '')
    .trim()
    .replace(/[^a-fA-F0-9]/g, '')
  if (!clean) return readDevices(dir)
  const devices = readDevices(dir).filter((d) => d.token !== clean)
  devices.push({ token: clean, environment, registeredAt: Date.now() })
  writeDevices(devices, dir)
  return devices
}

export function forgetDevice(token: string, dir: string = BRIDGE_DIR): void {
  writeDevices(
    readDevices(dir).filter((d) => d.token !== token),
    dir,
  )
}

// ---- JWT -------------------------------------------------------------------

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * APNs wants an ES256 JWT signed with the .p8. Node signs ES256 in DER by
 * default but JWS requires the raw r||s pair, hence `dsaEncoding`.
 */
export function apnsJwt(config: ApnsConfig, key: string, nowMs = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
  const payload = b64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }))
  const signer = createSign('SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(signature)}`
}

let cachedJwt: { token: string; at: number } | null = null

function currentJwt(config: ApnsConfig, key: string): string {
  if (cachedJwt && Date.now() - cachedJwt.at < JWT_TTL_MS) return cachedJwt.token
  const token = apnsJwt(config, key)
  cachedJwt = { token, at: Date.now() }
  return token
}

/** Test seam: forget the cached JWT. */
export function resetJwtCache(): void {
  cachedJwt = null
}

// ---- sending ---------------------------------------------------------------

export type PushPayload = {
  title: string
  body: string
  /** Deep-link target: the chat thread this notification is about. */
  threadKey?: string
  /** Badge count for the app icon; omit to leave it alone. */
  badge?: number
}

function apnsBody(payload: PushPayload): string {
  return JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      ...(payload.badge === undefined ? {} : { badge: payload.badge }),
      'interruption-level': 'time-sensitive',
    },
    threadKey: payload.threadKey,
  })
}

function post(
  origin: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    let session: ClientHttp2Session
    try {
      session = connect(origin)
    } catch (e) {
      resolve({ status: 0, reason: (e as Error).message })
      return
    }
    const done = (r: { status: number; reason?: string }) => {
      try {
        session.close()
      } catch {
        /* already gone */
      }
      resolve(r)
    }
    session.on('error', (e: Error) => done({ status: 0, reason: e.message }))

    const req = session.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    })
    let status = 0
    let text = ''
    req.on('response', (h) => {
      status = Number(h[constants.HTTP2_HEADER_STATUS] || 0)
    })
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      text += c
    })
    req.on('error', (e: Error) => done({ status: 0, reason: e.message }))
    req.on('end', () => {
      let reason: string | undefined
      try {
        reason = (JSON.parse(text || '{}') as { reason?: string }).reason
      } catch {
        reason = text || undefined
      }
      done({ status, reason })
    })
    req.end(body)
  })
}

export type PushResult = { sent: number; failed: number; errors: string[] }

/**
 * Notify every registered device. Best-effort by design: a push failure must
 * never take down whatever agent event triggered it.
 *
 * Devices Apple reports as gone (410, or 400/BadDeviceToken) are dropped, so a
 * reinstalled app doesn't leave a dead token being retried forever.
 */
export async function sendPush(
  payload: PushPayload,
  dir: string = BRIDGE_DIR,
): Promise<PushResult> {
  const config = readApnsConfig(dir)
  const key = readApnsKey(dir)
  const devices = readDevices(dir)
  if (!config || !key || devices.length === 0) {
    return { sent: 0, failed: 0, errors: [] }
  }

  const jwt = currentJwt(config, key)
  const body = apnsBody(payload)
  const result: PushResult = { sent: 0, failed: 0, errors: [] }

  for (const device of devices) {
    const origin = device.environment === 'sandbox' ? APNS_SANDBOX : APNS_PROD
    const r = await post(
      origin,
      `/3/device/${device.token}`,
      {
        authorization: `bearer ${jwt}`,
        'apns-topic': config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body,
    )
    if (r.status === 200) {
      result.sent++
      continue
    }
    result.failed++
    if (r.reason) result.errors.push(`${r.status} ${r.reason}`)
    if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
      forgetDevice(device.token, dir)
    }
  }
  return result
}

/**
 * Open HITL count, for the app-icon badge.
 *
 * Reads hitl.json directly rather than importing hitl.ts: that module imports
 * emitActivity from events.ts, and events.ts is where the push channel is
 * registered — going through it would create an import cycle.
 */
export function openHitlCount(): number {
  try {
    const raw = JSON.parse(readFileSync(join(BRIDGE_DIR, '..', 'hitl.json'), 'utf8')) as unknown
    if (!Array.isArray(raw)) return 0
    // The app badge should nag about what you HAVEN'T SEEN, not everything open —
    // a read-but-unresolved item shouldn't keep the red dot burning.
    return raw.filter(
      (h) => (h as { status?: string })?.status === 'open' && !(h as { readAt?: number })?.readAt,
    ).length
  } catch {
    return 0
  }
}

export function pushStatus(dir: string = BRIDGE_DIR): PushStatus {
  return { configured: pushConfigured(dir), devices: readDevices(dir).length }
}

/** Where a human drops the APNs key — surfaced in Settings so it's discoverable. */
export function apnsPaths(dir: string = BRIDGE_DIR): { config: string; key: string } {
  return { config: configPath(dir), key: keyPath(dir) }
}

export function apnsConfigured(dir: string = BRIDGE_DIR): boolean {
  return existsSync(configPath(dir)) && existsSync(keyPath(dir))
}
