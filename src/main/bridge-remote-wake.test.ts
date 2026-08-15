import { describe, expect, it, mock } from 'bun:test'

mock.module('electron', () => ({
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
  shell: { openExternal: () => {} },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
}))

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridgeDepsCtx } from './bridge-deps'
import type { RemoteSession } from './remote-sessions'

const { createBridgeDeps } = await import('./bridge-deps')
const { REMOTE_DIR, readRemoteSession, registerRemoteSession, takeReplies } = await import(
  './remote-sessions'
)

// Ticket 129. A phone-spawned Claude session used to park in the Stop hook
// forever, spending one model turn per window on a heartbeat. It now sleeps
// after a long idle — which only works if the APP takes over the wake. These
// tests pin both halves of that handover.

function patch(id: string, fields: Partial<RemoteSession>): void {
  const file = join(REMOTE_DIR(), `${id}.json`)
  const s = JSON.parse(readFileSync(file, 'utf8')) as RemoteSession
  writeFileSync(file, JSON.stringify({ ...s, ...fields }))
}

function ctxWith(writes: string[]): BridgeDepsCtx {
  return {
    liveSessions: () => [
      { sessionId: 'agent-1', cwd: '/tmp/repo', write: (d: string) => writes.push(d) },
    ],
    cliSrcPath: () => '/tmp/bin/terminal-cli',
    remoteFromHostId: () => null,
    hasWindow: () => true,
    openSessionInRenderer: () => true,
  }
}

describe('waking a dormant Claude session', () => {
  it('does NOT inject while the session is parked — the Stop hook delivers', () => {
    const writes: string[] = []
    const deps = createBridgeDeps(ctxWith(writes))
    const s = registerRemoteSession({
      title: 'parked',
      engine: 'claude',
      cwd: '/tmp/repo',
      origin: 'phone',
    })
    patch(s.id, { agentSessionId: 'agent-1' })

    expect(deps.reply!(s.id, 'do the thing')).toBe(true)
    expect(writes).toHaveLength(0)
    // Still queued for the hook to hand over.
    expect(takeReplies(s.id)).toEqual(['do the thing'])
  })

  it('injects into the live pty once the session has gone dormant', () => {
    const writes: string[] = []
    const deps = createBridgeDeps(ctxWith(writes))
    const s = registerRemoteSession({
      title: 'asleep',
      engine: 'claude',
      cwd: '/tmp/repo',
      origin: 'phone',
    })
    patch(s.id, { agentSessionId: 'agent-1', dormantAt: Date.now() })

    expect(deps.reply!(s.id, 'wake up')).toBe(true)
    expect(writes.join('')).toContain('wake up')
  })

  it('advances the delivery cursor on wake, so the next park cannot replay it', () => {
    const writes: string[] = []
    const deps = createBridgeDeps(ctxWith(writes))
    const s = registerRemoteSession({
      title: 'asleep',
      engine: 'claude',
      cwd: '/tmp/repo',
      origin: 'phone',
    })
    patch(s.id, { agentSessionId: 'agent-1', dormantAt: Date.now() })

    deps.reply!(s.id, 'only once')
    expect(takeReplies(s.id)).toEqual([])
    expect(readRemoteSession(s.id)?.status).toBe('working')
  })

  it('leaves a dormant session with no live pty alone instead of guessing', () => {
    const writes: string[] = []
    const deps = createBridgeDeps(ctxWith(writes))
    const s = registerRemoteSession({
      title: 'no tab',
      engine: 'claude',
      cwd: '/tmp/elsewhere',
      origin: 'phone',
    })
    patch(s.id, { agentSessionId: 'someone-else', dormantAt: Date.now() })

    deps.reply!(s.id, 'anyone there?')
    expect(writes).toHaveLength(0)
    // The message is still queued, so nothing is lost.
    expect(takeReplies(s.id)).toEqual(['anyone there?'])
  })
})
