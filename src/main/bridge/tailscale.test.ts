import { describe, expect, it } from 'bun:test'
import { whoisArg } from './tailscale'

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
