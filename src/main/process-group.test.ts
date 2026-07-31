import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  AGENT_RUN_TIMEOUT_MS,
  AGENT_TIMEOUT_EXIT,
  killProcessGroup,
  resolveRunTimeoutMs,
} from './process-group'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The P1/P2 bug, reproduced with real processes: agent runs spawn `script`,
 * which spawns a login shell, which spawns `claude`/`codex`. Signalling the
 * child's pid only ever reached the wrapper — the ENGINE survived, kept burning
 * tokens, and could still commit and push. A grandchild standing in for the
 * engine is the honest test of the fix.
 */
describe('killProcessGroup', () => {
  test('kills a grandchild that a plain child.kill() would leave running', async () => {
    // sh -c that backgrounds a long sleep (the "engine") and prints its pid,
    // then waits — mirroring the script → shell → engine chain.
    const parent = spawn('/bin/sh', ['-c', 'sleep 120 & echo $!; wait'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    })
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      parent.stdout.once('data', (d) => resolve(Number(String(d).trim())))
      parent.once('error', reject)
      setTimeout(() => reject(new Error('no pid from the test child')), 5000)
    })
    expect(Number.isInteger(grandchildPid)).toBe(true)
    expect(alive(grandchildPid)).toBe(true)

    killProcessGroup(parent, 'SIGKILL')

    // Give the kernel a moment to reap both.
    for (let i = 0; i < 40 && alive(grandchildPid); i++) await sleep(25)
    expect(alive(grandchildPid)).toBe(false)
    expect(alive(parent.pid!)).toBe(false)
  })

  test('is a no-op on an already-dead process rather than throwing', async () => {
    const p = spawn('/bin/sh', ['-c', 'exit 0'], { stdio: 'ignore', detached: true })
    await new Promise((r) => p.once('exit', r))
    expect(() => killProcessGroup(p, 'SIGKILL')).not.toThrow()
  })

  test('does not throw for a child that never spawned (no pid)', () => {
    const p = spawn('definitely-not-a-real-binary-xyz', [], { stdio: 'ignore' })
    p.on('error', () => {})
    expect(() => killProcessGroup(p, 'SIGKILL')).not.toThrow()
  })
})

describe('resolveRunTimeoutMs', () => {
  test('uses the per-run cap when one is set', () => {
    expect(resolveRunTimeoutMs(90)).toBe(90_000)
    expect(resolveRunTimeoutMs(1)).toBe(1_000)
  })

  // runSpec previously had no timeout at all: a hung engine left the run
  // 'running' forever, and the duplicate-run guard then blocked that agent
  // permanently until the app restarted. There must ALWAYS be a cap.
  test('falls back to the hard cap for missing or nonsensical values', () => {
    for (const bad of [undefined, 0, -5, NaN, Infinity, 'soon' as unknown as number]) {
      expect(resolveRunTimeoutMs(bad)).toBe(AGENT_RUN_TIMEOUT_MS)
    }
  })

  // Per STEP, not per run — it wraps each spawned child in runStep, so a
  // multi-step spec is bounded at steps x this. Named here so the docs and the
  // behaviour cannot drift apart again.
  test('matches terminal-cron: 30m default per step, exit 124 on timeout', () => {
    expect(AGENT_RUN_TIMEOUT_MS).toBe(30 * 60 * 1000)
    expect(AGENT_TIMEOUT_EXIT).toBe(124)
  })

  test('a fractional value is floored to whole seconds', () => {
    expect(resolveRunTimeoutMs(1.9)).toBe(1_000)
  })
})
