import { describe, expect, test } from 'bun:test'
import { REMOTE_ENABLED_REJECTION, remoteMutation, teardownWarning } from './schedule-honesty'

// These three helpers exist because every one of them replaced a swallowed
// failure: `.catch(() => {})` on the old-host teardown, `.catch(() => false)` on
// remote remove/toggle, and a remote-attached save that installed no timer while
// the row rendered enabled. The assertions below pin the DISTINCTIONS, not the
// prose: a warning names the host it could not reach, and "the host said no" is
// a different shape from "we never reached the host".

describe('teardownWarning', () => {
  test('names the host whose old timer is still installed', () => {
    const w = teardownWarning(
      { host: 'tm', runtime: 'bare' },
      'Remote desktop',
      'ssh: connect to host tm port 22: Operation timed out',
    )
    expect(w).toContain('Remote desktop')
    expect(w).toContain('Operation timed out')
    // The operator has to know the OLD trigger still fires — that is the whole
    // point of surfacing this instead of dropping it.
    expect(w.toLowerCase()).toContain('still')
  })

  test('falls back to the host id when the label is unknown', () => {
    expect(teardownWarning({ host: 'tm' }, undefined, 'boom')).toContain('tm')
  })

  test('describes the local launchd trigger when the previous layer was local', () => {
    const w = teardownWarning({ host: undefined }, undefined, 'launchctl failed')
    expect(w.toLowerCase()).toContain('launchd')
    expect(w).toContain('launchctl failed')
  })
})

describe('remoteMutation', () => {
  test('true from the host is a success', async () => {
    expect(await remoteMutation('tm', async () => true)).toEqual({ ok: true })
  })

  test('false from the host is a refusal — not a network failure', async () => {
    const r = await remoteMutation('tm', async () => false)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('refused')
    expect(r.error).toContain('tm')
  })

  test('a thrown SSH error is unreachable — carrying the ssh message', async () => {
    const r = await remoteMutation('tm', async () => {
      throw new Error('ssh: Could not resolve hostname tm')
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('unreachable')
    expect(r.error).toContain('Could not resolve hostname')
  })

  test('refused and unreachable are distinguishable — the bug this fixes', async () => {
    const refused = await remoteMutation('tm', async () => false)
    const down = await remoteMutation('tm', async () => {
      throw new Error('timeout')
    })
    expect(refused).not.toEqual(down)
  })
})

describe('REMOTE_ENABLED_REJECTION', () => {
  test('explains that Run Now still works, so the message is actionable', () => {
    expect(REMOTE_ENABLED_REJECTION.toLowerCase()).toContain('run now')
    expect(REMOTE_ENABLED_REJECTION.toLowerCase()).toContain('paused')
  })
})
