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

/** One machine on the tailnet, as the phone's fleet picker shows it. */
export type TailnetMachine = {
  /** Short host name, e.g. "studio". */
  name: string
  /** MagicDNS name without the trailing dot — what the phone connects to. */
  dnsName: string
  os: string
  online: boolean
  /** True for the Mac answering the request; it can't switch to itself. */
  self: boolean
}

/**
 * The tailnet as the bridge can see it. `unavailable` is a first-class answer,
 * not an error: Tailscale being stopped or absent is an ordinary state the
 * phone must render, so it never surfaces as a failed request.
 */
export type TailnetFleet =
  { status: 'ok'; machines: TailnetMachine[] } | { status: 'unavailable'; reason: string }

type StatusNode = {
  HostName?: string
  DNSName?: string
  OS?: string
  Online?: boolean
}

function machine(node: StatusNode, self: boolean): TailnetMachine | null {
  const dnsName = (node.DNSName || '').replace(/\.$/, '')
  const name = node.HostName || dnsName.split('.')[0]
  if (!dnsName && !name) return null
  return {
    name: name || dnsName,
    dnsName,
    os: node.OS || '',
    // The Mac itself is by definition reachable — it just answered this
    // request — and `status --json` does not always mark Self online.
    online: self ? true : node.Online === true,
    self,
  }
}

/**
 * Turn `tailscale status --json` into the fleet list, online first then by
 * name. Pure, so the interesting cases (stopped backend, no peers, a machine
 * with no MagicDNS name) are unit-testable without a tailnet.
 */
export function parseTailnetStatus(raw: string): TailnetFleet {
  let status: {
    BackendState?: string
    Self?: StatusNode
    Peer?: Record<string, StatusNode>
  }
  try {
    status = JSON.parse(raw)
  } catch {
    return { status: 'unavailable', reason: 'Tailscale returned something unreadable.' }
  }
  const state = status.BackendState || ''
  if (state && state !== 'Running') {
    return {
      status: 'unavailable',
      reason:
        state === 'NeedsLogin'
          ? 'Tailscale is signed out on this Mac.'
          : `Tailscale is not running on this Mac (${state}).`,
    }
  }
  const machines: TailnetMachine[] = []
  const self = status.Self ? machine(status.Self, true) : null
  if (self) machines.push(self)
  for (const node of Object.values(status.Peer ?? {})) {
    const m = machine(node, false)
    if (m) machines.push(m)
  }
  machines.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { status: 'ok', machines }
}

/**
 * The tailnet's machines. `runner` is the exec seam — the default shells out to
 * the Tailscale CLI; tests pass their own.
 */
export async function tailscaleFleet(
  runner: (args: string[]) => Promise<string | null> = run,
): Promise<TailnetFleet> {
  const out = await runner(['status', '--json'])
  if (!out) {
    return {
      status: 'unavailable',
      reason: 'Tailscale is not installed or not responding on this Mac.',
    }
  }
  return parseTailnetStatus(out)
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
