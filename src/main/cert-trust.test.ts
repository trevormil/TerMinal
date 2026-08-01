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
  // bin/terminal-monitor is a standalone script that mirrors these classifiers.
  // A fix in monitors.ts that the daemon never calls would change nothing —
  // the daemon is the only thing that ever runs a probe.
  const src = readFileSync(resolve(import.meta.dir, '../../bin/terminal-monitor'), 'utf8')

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

  test('the mirrored copy is behaviourally identical to the canonical one', () => {
    // Extract the daemon's copy and run it against the same table.
    const start = src.indexOf('function classifyCertTrust')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}\n', start) + 3)
    const mirrored = new Function(`${body}; return classifyCertTrust`)() as (
      s: string,
      a: boolean,
    ) => string
    for (const state of ['ok', 'warn', 'fail'] as const) {
      for (const authorized of [true, false]) {
        expect(mirrored(state, authorized)).toBe(classifyCertTrust(state, authorized))
      }
    }
  })

  test('rejectUnauthorized stays false — reporting requires connecting', () => {
    // If a future change "hardens" this to true, the handshake fails and the
    // monitor reports nothing at all for exactly the hosts it should warn about.
    expect(src).toContain('rejectUnauthorized: false')
  })
})
