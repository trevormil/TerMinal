import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

// Tailnet identity, for zero-QR pairing.
//
// A phone on the same tailnet connects to the Mac's MagicDNS name and asks for
// the token. The Mac runs `tailscale whois` on the connection to learn WHO is
// calling, and hands the token over only if it is the same tailnet user that
// owns the Mac. The tunnel is already WireGuard-encrypted and mutually
// authenticated, so this one bootstrap request needs no prior secret — the
// identity check is what gates it.
//
// Everything is best-effort: if the CLI is missing or Tailscale is down, the
// helpers return null and the caller falls back to QR pairing.

/** Locations the Tailscale CLI ships in, most specific first. */
const TAILSCALE_BINS = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  'tailscale',
]

let cachedBin: string | null | undefined

function tailscaleBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  for (const bin of TAILSCALE_BINS) {
    if (bin === 'tailscale' || existsSync(bin)) {
      cachedBin = bin
      return bin
    }
  }
  cachedBin = null
  return null
}

const execFileAsync = promisify(execFile)

const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

// Async on purpose: this runs from an unauthenticated HTTP route on the
// Electron main process — a blocking subprocess here would freeze the whole
// app for up to the timeout on every probe.
//
// Routed through a LOGIN SHELL, not a bare execFile. The GUI / Mac-App-Store
// Tailscale ships its CLI as a thin shim that reaches the backend through the
// user's login session. A Finder/dock-launched Electron app runs with a
// stripped environment where that shim fails with "The Tailscale GUI failed to
// start" (CLIError 3) — so whois returned null and EVERY tailnet peer was
// refused with 403, even though pairing worked fine under `bun run dev` (which
// inherits the shell env). `$SHELL -lc` reconstructs the login session the shim
// needs; capturing env vars alone is NOT enough — it's session context, not
// just variables.
async function run(args: string[]): Promise<string | null> {
  const bin = tailscaleBin()
  if (!bin) return null
  const cmd = [bin, ...args].map(shq).join(' ')
  try {
    const { stdout } = await execFileAsync(LOGIN_SHELL, ['-lc', cmd], { timeout: 8000 })
    return stdout.toString().trim()
  } catch {
    return null
  }
}

export type TailscaleSelf = {
  /** MagicDNS name without the trailing dot, e.g. mac.tailnet.ts.net. */
  dnsName: string
  /** Numeric tailnet user id that owns this machine. */
  userId: string
  /** Login of that user, e.g. you@github. */
  login: string
}

/** This Mac's tailnet identity, or null when Tailscale isn't usable. */
export async function tailscaleSelf(): Promise<TailscaleSelf | null> {
  const out = await run(['status', '--json'])
  if (!out) return null
  try {
    const status = JSON.parse(out) as {
      Self?: { DNSName?: string; UserID?: number }
      User?: Record<string, { LoginName?: string }>
    }
    const self = status.Self
    if (!self?.DNSName || self.UserID === undefined) return null
    const userId = String(self.UserID)
    return {
      dnsName: self.DNSName.replace(/\.$/, ''),
      userId,
      login: status.User?.[userId]?.LoginName || '',
    }
  } catch {
    return null
  }
}

export type TailscalePeer = {
  userId: string
  login: string
  node: string
}

/**
 * Format a peer address as the `host:port` `tailscale whois` demands, without
 * mangling IPv6. A raw IPv6 tailnet address (fd7a:115c:a1e0::1) is ALL colons,
 * so the old `${ip}:${port}` produced `fd7a:...::1:0` — unparseable, whois
 * returned null, and every IPv6 pairing peer was rejected as "not recognised".
 * IPv6 must be bracketed: `[fd7a:...::1]:0`. The port is a dummy — whois
 * identifies by IP, so we normalise it to `:0`. Callers pass a BARE address
 * (a raw IPv6 has no port to strip, and its own colons can't be told apart
 * from a `:port` suffix); a bracketed `[v6]:port` is also accepted.
 */
export function whoisArg(peerAddress: string): string {
  const host = peerAddress.trim()
  // Already bracketed IPv6, optionally with a port — keep just the address.
  const bracketed = host.match(/^\[([^\]]+)\]/)
  if (bracketed) return `[${bracketed[1]}]:0`
  // Bare IPv6 (2+ colons) — bracket it verbatim.
  if ((host.match(/:/g)?.length ?? 0) > 1) return `[${host}]:0`
  // IPv4, with or without a :port.
  return `${host.split(':')[0]}:0`
}

/** Identify the tailnet peer behind an address (ip, ip:port, or [ipv6]:port). */
export async function tailscaleWhois(peerAddress: string): Promise<TailscalePeer | null> {
  const out = await run(['whois', '--json', whoisArg(peerAddress)])
  if (!out) return null
  try {
    const who = JSON.parse(out) as {
      UserProfile?: { ID?: number; LoginName?: string }
      Node?: { Name?: string }
    }
    const id = who.UserProfile?.ID
    if (id === undefined) return null
    return {
      userId: String(id),
      login: who.UserProfile?.LoginName || '',
      node: (who.Node?.Name || '').replace(/\.$/, ''),
    }
  } catch {
    return null
  }
}

/**
 * Is this peer allowed to auto-pair? Only when Tailscale can identify BOTH
 * sides and the peer belongs to the same tailnet user that owns the Mac.
 *
 * Strict by construction: an unknown peer, a down tailnet, or a different user
 * all return false, so a failure is a refusal — never an accidental grant.
 */
export async function tailscalePeerAllowed(
  peerAddress: string,
): Promise<{ ok: boolean; peer?: TailscalePeer }> {
  const self = await tailscaleSelf()
  if (!self) return { ok: false }
  const peer = await tailscaleWhois(peerAddress)
  if (!peer) return { ok: false }
  return { ok: peer.userId === self.userId, peer }
}
