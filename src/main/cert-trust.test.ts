import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyCert, classifyCertTrust } from './monitors'

// Ticket 67, finding F-15.
//
// The TLS probe connects with `rejectUnauthorized: false` — deliberately, so it
// can still report "expires in 3 days" on a host whose chain is already broken.
// But it then discarded the trust result, so a self-signed cert, a wrong-
// hostname cert, or an untrusted issuer all rendered as a plain green
// "88d until expiry". The monitor was not silent about the problem; it asserted
// the opposite.

describe('classifyCertTrust (ticket 67 F-15)', () => {
  test('an authorized chain is left exactly as the expiry check decided', () => {
    expect(classifyCertTrust('ok', true)).toBe('ok')
    expect(classifyCertTrust('warn', true)).toBe('warn')
    expect(classifyCertTrust('fail', true)).toBe('fail')
  })

  test('an UNTRUSTED chain can never read as ok', () => {
    // The whole finding in one assertion.
    expect(classifyCertTrust('ok', false)).toBe('warn')
  })

  test('an untrusted chain does not DOWNGRADE a worse expiry verdict', () => {
    // A cert expiring tomorrow AND untrusted is still a failure. Clamping
    // everything to `warn` would have made the fix hide a real outage.
    expect(classifyCertTrust('fail', false)).toBe('fail')
    expect(classifyCertTrust('warn', false)).toBe('warn')
  })

  test('warn rather than fail, so the check does not get muted', () => {
    // An untrusted chain is often deliberate (internal CA, staging box). A
    // monitor that hard-fails on those gets disabled, and then detects nothing.
    expect(classifyCertTrust('ok', false)).not.toBe('fail')
  })

  test('composed with the real expiry classifier end to end', () => {
    const far = classifyCert(88)
    expect(far).toBe('ok')
    expect(classifyCertTrust(far, true)).toBe('ok')
    expect(classifyCertTrust(far, false)).toBe('warn')

    const expiring = classifyCert(2)
    expect(expiring).toBe('fail')
    expect(classifyCertTrust(expiring, false)).toBe('fail')
  })
})

describe('the daemon actually uses it (ticket 67 F-15)', () => {
  // The daemon is the only thing that ever runs a probe, so a fix in the
  // classifier that the TLS probe never calls would change nothing. It used to
  // carry a hand-copy of these functions; now it IMPORTS the canonical ones
  // (src/shared/monitor-classify.ts) and is bundled to bin/terminal-monitor, so
  // what has to be pinned is the probe's use of them, not a mirror's fidelity.
  const src = readFileSync(resolve(import.meta.dir, '../monitor/probes.ts'), 'utf8')

  test('it imports the canonical classifiers rather than redefining them', () => {
    expect(src).toContain("from '../shared/monitor-classify'")
    expect(src).not.toMatch(/function\s+classifyCertTrust/)
  })

  test('it reads the trust result off the socket', () => {
    expect(src).toContain('socket.authorized')
    expect(src).toContain('socket.authorizationError')
  })

  test('it folds trust into the reported status', () => {
    expect(src).toContain('classifyCertTrust(expiry, authorized)')
  })

  test('it records trust in the metrics, so history shows WHEN it broke', () => {
    expect(src).toMatch(/authorized,/)
    expect(src).toMatch(/authorizationError/)
  })

  test('the shipped artifact carries that same code', () => {
    // The bundle is what launchd actually executes. A source fix that was never
    // rebuilt would leave the OLD daemon running — src/bin-build-sync.test.ts
    // guards staleness in general; this pins the specific fix.
    const bundle = readFileSync(resolve(import.meta.dir, '../../bin/terminal-monitor'), 'utf8')
    expect(bundle).toContain('classifyCertTrust')
    expect(bundle).toContain('rejectUnauthorized: false')
  })

  test('rejectUnauthorized stays false — reporting requires connecting', () => {
    // If a future change "hardens" this to true, the handshake fails and the
    // monitor reports nothing at all for exactly the hosts it should warn about.
    expect(src).toContain('rejectUnauthorized: false')
  })
})
