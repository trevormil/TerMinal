import { test, expect, describe } from 'bun:test'
import { classifySshError } from './host-health'

describe('classifySshError', () => {
  test('connection timeout → the tailscale/VPN/asleep case with a reauth hint', () => {
    const r = classifySshError('ssh: connect to host tm port 22: Operation timed out')
    expect(r.reason).toBe('timeout')
    expect(r.hint.toLowerCase()).toMatch(/tailscale|vpn|reauth|asleep|connection/)
  })
  test('ConnectTimeout expiry also classifies as timeout', () => {
    expect(
      classifySshError('ssh: connect to host 100.64.0.1 port 22: Connection timed out').reason,
    ).toBe('timeout')
  })
  test('permission denied → auth', () => {
    expect(classifySshError('git@tm: Permission denied (publickey).').reason).toBe('auth')
  })
  test('host key verification failed → auth', () => {
    expect(classifySshError('Host key verification failed.').reason).toBe('auth')
  })
  test('cannot resolve hostname → dns', () => {
    expect(
      classifySshError('ssh: Could not resolve hostname tm: Name or service not known').reason,
    ).toBe('dns')
  })
  test('connection refused → refused', () => {
    expect(classifySshError('ssh: connect to host tm port 22: Connection refused').reason).toBe(
      'refused',
    )
  })
  test('unrecognized text → unknown, but still carries a hint', () => {
    const r = classifySshError('some weird failure')
    expect(r.reason).toBe('unknown')
    expect(r.hint.length).toBeGreaterThan(0)
  })
  test('every reason carries a non-empty actionable hint', () => {
    for (const s of [
      'timed out',
      'Permission denied',
      'could not resolve',
      'connection refused',
      'xyz',
    ]) {
      expect(classifySshError(s).hint.length).toBeGreaterThan(0)
    }
  })
})
