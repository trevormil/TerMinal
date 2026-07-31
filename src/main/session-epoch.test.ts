import { describe, expect, test } from 'bun:test'
import { createEpochRegistry } from './session-epoch'

describe('session epoch guard', () => {
  test('a live session acts on its own exit', () => {
    const reg = createEpochRegistry()
    const epoch = reg.next('repo:1')
    expect(reg.isCurrent('repo:1', epoch)).toBe(true)
  })

  // The actual bug: restart under the same key. The OLD pty's onExit arrives
  // after the NEW session is already installed, and used to fire pty:exit /
  // finalizeSessionRun against the fresh terminal.
  test('a restart supersedes the previous generation', () => {
    const reg = createEpochRegistry()
    const stale = reg.next('repo:1')
    const fresh = reg.next('repo:1')
    expect(reg.isCurrent('repo:1', stale)).toBe(false)
    expect(reg.isCurrent('repo:1', fresh)).toBe(true)
    expect(fresh).not.toBe(stale)
  })

  test('repeated restarts only ever leave the newest generation live', () => {
    const reg = createEpochRegistry()
    const epochs = [reg.next('k'), reg.next('k'), reg.next('k')]
    expect(epochs.filter((e) => reg.isCurrent('k', e))).toEqual([epochs[2]])
  })

  test('keys are independent — restarting one session does not mute another', () => {
    const reg = createEpochRegistry()
    const a = reg.next('a')
    const b = reg.next('b')
    reg.next('b')
    expect(reg.isCurrent('a', a)).toBe(true)
    expect(reg.isCurrent('b', b)).toBe(false)
  })

  test('a stopped session cannot act — including after a same-key restart', () => {
    const reg = createEpochRegistry()
    const epoch = reg.next('k')
    reg.forget('k')
    expect(reg.isCurrent('k', epoch)).toBe(false)
    // Epochs must never be recycled: a per-key counter would reset here and hand
    // out the stale holder's number again, silently re-arming it.
    const restarted = reg.next('k')
    expect(restarted).not.toBe(epoch)
    expect(reg.isCurrent('k', epoch)).toBe(false)
    expect(reg.isCurrent('k', restarted)).toBe(true)
  })

  test('epoch values are never reused across keys either', () => {
    const reg = createEpochRegistry()
    const seen = new Set<number>()
    for (const key of ['a', 'b', 'a', 'c', 'b', 'a']) seen.add(reg.next(key))
    expect(seen.size).toBe(6)
  })

  test('clear retires every generation (app quit)', () => {
    const reg = createEpochRegistry()
    const a = reg.next('a')
    const b = reg.next('b')
    reg.clear()
    expect(reg.isCurrent('a', a)).toBe(false)
    expect(reg.isCurrent('b', b)).toBe(false)
  })
})
