import { describe, expect, it } from 'bun:test'
import { parseTailnetStatus, tailscaleFleet, whoisArg } from './tailscale'

describe('whoisArg', () => {
  it('brackets a bare IPv6 tailnet address so whois can parse it', () => {
    // The pairing regression: this used to become `fd7a:...::1:0`, which whois
    // rejected, so every IPv6 tailnet peer was refused.
    expect(whoisArg('fd7a:115c:a1e0::1')).toBe('[fd7a:115c:a1e0::1]:0')
    expect(whoisArg('fd7a:115c:a1e0:ab12::7')).toBe('[fd7a:115c:a1e0:ab12::7]:0')
  })
  it('keeps just the address from an already-bracketed [v6]:port', () => {
    expect(whoisArg('[fd7a:115c:a1e0::1]:52344')).toBe('[fd7a:115c:a1e0::1]:0')
    expect(whoisArg('[fd7a:115c:a1e0::1]')).toBe('[fd7a:115c:a1e0::1]:0')
  })
  it('normalises IPv4 with or without a port to :0', () => {
    expect(whoisArg('100.100.1.2')).toBe('100.100.1.2:0')
    expect(whoisArg('100.100.1.2:41000')).toBe('100.100.1.2:0')
  })
})

const RUNNING = JSON.stringify({
  BackendState: 'Running',
  Self: { HostName: 'studio', DNSName: 'studio.tailnet.ts.net.', OS: 'macOS' },
  Peer: {
    'nodekey:a': {
      HostName: 'laptop',
      DNSName: 'laptop.tailnet.ts.net.',
      OS: 'macOS',
      Online: true,
    },
    'nodekey:b': {
      HostName: 'attic',
      DNSName: 'attic.tailnet.ts.net.',
      OS: 'linux',
      Online: false,
    },
    'nodekey:c': { HostName: 'phone', DNSName: 'phone.tailnet.ts.net.', OS: 'iOS', Online: true },
  },
})

describe('parseTailnetStatus', () => {
  it('lists self plus peers, online first then alphabetical', () => {
    const fleet = parseTailnetStatus(RUNNING)
    expect(fleet.status).toBe('ok')
    if (fleet.status !== 'ok') return
    expect(fleet.machines.map((m) => m.name)).toEqual(['laptop', 'phone', 'studio', 'attic'])
    // The trailing MagicDNS dot is stripped — the phone builds a URL from this.
    expect(fleet.machines.map((m) => m.dnsName)).toEqual([
      'laptop.tailnet.ts.net',
      'phone.tailnet.ts.net',
      'studio.tailnet.ts.net',
      'attic.tailnet.ts.net',
    ])
    expect(fleet.machines.find((m) => m.self)?.name).toBe('studio')
    // Self carries no Online flag in `status --json`, but it just answered.
    expect(fleet.machines.find((m) => m.self)?.online).toBe(true)
    expect(fleet.machines.find((m) => m.name === 'attic')?.online).toBe(false)
    expect(fleet.machines.find((m) => m.name === 'attic')?.os).toBe('linux')
  })

  it('reports a stopped or signed-out backend as unavailable, not as an empty fleet', () => {
    const stopped = parseTailnetStatus(JSON.stringify({ BackendState: 'Stopped', Self: {} }))
    expect(stopped).toEqual({
      status: 'unavailable',
      reason: 'Tailscale is not running on this Mac (Stopped).',
    })
    const out = parseTailnetStatus(JSON.stringify({ BackendState: 'NeedsLogin' }))
    expect(out).toEqual({ status: 'unavailable', reason: 'Tailscale is signed out on this Mac.' })
  })

  it('is unavailable — never a throw — on unreadable output', () => {
    expect(parseTailnetStatus('not json').status).toBe('unavailable')
  })

  it('drops a node with neither a name nor a MagicDNS name', () => {
    const fleet = parseTailnetStatus(
      JSON.stringify({ BackendState: 'Running', Peer: { 'nodekey:x': { OS: 'linux' } } }),
    )
    expect(fleet).toEqual({ status: 'ok', machines: [] })
  })
})

describe('tailscaleFleet', () => {
  it('asks the CLI for status --json and parses it', async () => {
    const calls: string[][] = []
    const fleet = await tailscaleFleet(async (args) => {
      calls.push(args)
      return RUNNING
    })
    expect(calls).toEqual([['status', '--json']])
    expect(fleet.status).toBe('ok')
  })

  it('is unavailable when the CLI is missing or does not answer', async () => {
    expect(await tailscaleFleet(async () => null)).toEqual({
      status: 'unavailable',
      reason: 'Tailscale is not installed or not responding on this Mac.',
    })
  })
})
