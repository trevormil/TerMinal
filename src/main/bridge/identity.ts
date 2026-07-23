import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Pairing material for the mobile bridge. Deliberately NOT in settings.json:
// that file seals secrets through Electron safeStorage, which DROPS the value
// entirely when OS encryption is unavailable (unsigned/dev builds) — a paired
// phone would silently stop working after a restart in dev. A 0600 file under
// the existing config root has none of that failure mode and is the same
// trust boundary as the private key it sits next to.
export const BRIDGE_DIR = join(homedir(), '.config', 'TerMinal', 'bridge')

/** Default listen port. Chosen to stay clear of common dev servers. */
export const DEFAULT_BRIDGE_PORT = 8790

export type BridgeIdentity = {
  token: string
  certPem: string
  keyPem: string
  /** base64 SHA-256 of the DER certificate — what the iOS client pins. */
  fingerprint: string
}

const p = (dir: string, name: string) => join(dir, name)

/** base64 SHA-256 of the DER form of a PEM certificate (the pinned value). */
export function certFingerprint(certPem: string): string {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '')
  return createHash('sha256').update(Buffer.from(body, 'base64')).digest('base64')
}

/** 32 random bytes, base64url — the bearer token every request must carry. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

function writeSecret(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o600 })
  try {
    chmodSync(path, 0o600) // writeFileSync only applies mode on create
  } catch {
    /* best effort */
  }
}

/**
 * Generate a self-signed cert with the system openssl. The client pins the
 * fingerprint rather than validating the chain, so the subject is cosmetic.
 *
 * EC P-256, not RSA-2048: the whole cert is ~280 bytes of DER vs ~1200, which
 * keeps the TLS server flight inside one packet on the Tailscale tunnel's
 * 1280-byte MTU. An RSA handshake spilled across two segments was being
 * black-holed over the tunnel and failing on the phone with -1200, while the
 * LAN path (1500 MTU) worked. `ec_param_enc:named_curve` is required — the
 * default explicit-parameter encoding from LibreSSL is rejected by BoringSSL
 * (Bun, and the pinning client). 800 days stays under Apple's ATS 825-day cap.
 */
function generateCert(dir: string): { certPem: string; keyPem: string } {
  const certPath = p(dir, 'cert.pem')
  const keyPath = p(dir, 'key.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-pkeyopt',
      'ec_param_enc:named_curve',
      '-nodes',
      '-days',
      '800',
      '-subj',
      '/CN=TerMinal',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  chmodSync(keyPath, 0o600)
  chmodSync(certPath, 0o600)
  return { certPem: readFileSync(certPath, 'utf8'), keyPem: readFileSync(keyPath, 'utf8') }
}

/**
 * Read the on-disk identity, generating whatever is missing. Idempotent: an
 * existing token/cert pair is reused verbatim so enabling the bridge twice
 * never invalidates a paired phone.
 */
export function ensureIdentity(dir: string = BRIDGE_DIR): BridgeIdentity {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tokenPath = p(dir, 'token')
  let token = ''
  try {
    token = readFileSync(tokenPath, 'utf8').trim()
  } catch {
    /* not generated yet */
  }
  if (!token) {
    token = newToken()
    writeSecret(tokenPath, token + '\n')
  }

  const certPath = p(dir, 'cert.pem')
  const keyPath = p(dir, 'key.pem')
  let certPem = ''
  let keyPem = ''
  if (existsSync(certPath) && existsSync(keyPath)) {
    certPem = readFileSync(certPath, 'utf8')
    keyPem = readFileSync(keyPath, 'utf8')
  }
  if (!certPem.includes('BEGIN CERTIFICATE') || !keyPem.includes('PRIVATE KEY')) {
    ;({ certPem, keyPem } = generateCert(dir))
  }
  return { token, certPem, keyPem, fingerprint: certFingerprint(certPem) }
}

/** New token — every paired phone must re-scan. Cert/key are left alone. */
export function rotateToken(dir: string = BRIDGE_DIR): BridgeIdentity {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeSecret(p(dir, 'token'), newToken() + '\n')
  return ensureIdentity(dir)
}

/** Throw away cert + key + token. Next ensureIdentity() regenerates all three. */
export function resetIdentity(dir: string = BRIDGE_DIR): void {
  for (const f of ['token', 'cert.pem', 'key.pem']) {
    try {
      rmSync(p(dir, f))
    } catch {
      /* already gone */
    }
  }
}

/** Constant-time bearer comparison. Digests first so unequal lengths are safe. */
export function tokenMatches(presented: string, expected: string): boolean {
  if (!expected) return false
  const a = createHash('sha256')
    .update(presented || '')
    .digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Is this address in 100.64.0.0/10 (CGNAT, what tailnets use)? Accepts the
 *  IPv4-mapped `::ffff:` form Node reports on dual-stack sockets. */
export const isTailscaleIp = (ip: string): boolean => {
  const [a, b] = ip
    .replace(/^::ffff:/i, '')
    .split('.')
    .map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/**
 * Candidate addresses for the QR, tailnet first: a tailnet address keeps
 * working off the home network, so the client should try it before the LAN IP.
 */
export function bridgeHosts(
  ifaces: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (!out.includes(a.address)) out.push(a.address)
    }
  }
  return out.sort((x, y) => Number(isTailscaleIp(y)) - Number(isTailscaleIp(x)))
}

export type PairingPayload = {
  v: 1
  n: string // display name, so the phone can label the Mac
  p: number // port
  h: string[] // candidate hosts, tailnet first
  t: string // bearer token
  fp: string // base64 SHA-256 of the DER cert
}

export function pairingPayload(input: {
  port: number
  identity: BridgeIdentity
  name?: string
  hosts?: string[]
}): PairingPayload {
  return {
    v: 1,
    n: input.name || hostname().replace(/\.local$/, ''),
    p: input.port,
    h: input.hosts || bridgeHosts(),
    t: input.identity.token,
    fp: input.identity.fingerprint,
  }
}
