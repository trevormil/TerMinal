import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The daemon is the only process that ever runs a probe, so the hardening has
// to be proven against bin/terminal-monitor itself rather than a mirror of it —
// same stance as monitor-confirm.test.ts.
//
// Every monitor here is a `command` monitor: it needs no network, so the tests
// are deterministic AND the local-connectivity gate cannot interfere (a local
// command failure never votes for "our uplink is down").

const DAEMON = resolve(import.meta.dir, '../../bin/terminal-monitor')

type Opts = { minConsecutiveFailures?: number; intervalSec?: number }

function sandbox(target: string, opts: Opts = {}): { cfg: string; stateFile: string } {
  const cfg = mkdtempSync(join(tmpdir(), 'tm-monitor-threshold-'))
  mkdirSync(join(cfg, 'monitor-state'), { recursive: true })
  writeFileSync(
    join(cfg, 'monitors.json'),
    JSON.stringify([
      {
        id: 'threshold-under-test',
        name: 'threshold under test',
        type: 'command',
        target,
        intervalSec: opts.intervalSec ?? 0,
        enabled: true,
        ...(opts.minConsecutiveFailures === undefined
          ? {}
          : { minConsecutiveFailures: opts.minConsecutiveFailures }),
        notify: { onFailure: 'urgent', onRecovery: true, renotifyAfterSec: 0 },
        config: { confirmDelayMs: 0 },
      },
    ]),
  )
  return { cfg, stateFile: join(cfg, 'monitor-state', 'threshold-under-test.json') }
}

function runDaemon(cfg: string, args: string[] = ['run', 'threshold-under-test']): void {
  execFileSync('bun', [DAEMON, ...args], {
    env: { ...process.env, TERMINAL_CONFIG_DIR: cfg },
    stdio: 'ignore',
    timeout: 30_000,
  })
}

const readState = (f: string): Record<string, unknown> => JSON.parse(readFileSync(f, 'utf8'))

describe('consecutive-failure threshold in bin/terminal-monitor', () => {
  test('one failure does not take the monitor down; the second does', () => {
    const { cfg, stateFile } = sandbox('exit 1')

    runDaemon(cfg)
    const first = readState(stateFile)
    expect(first.status).toBe('ok')
    expect(first.consecutiveFailures).toBe(1)
    // The raw verdict is kept so the UI can show the blip rather than a
    // clean bill of health.
    expect(first.observed).toBe('fail')
    expect(first.lastTransition).toBeNull()

    runDaemon(cfg)
    const second = readState(stateFile)
    expect(second.status).toBe('fail')
    expect(second.consecutiveFailures).toBe(2)
    expect(second.lastTransition).toEqual(expect.objectContaining({ from: 'ok', to: 'fail' }))
  })

  test('an existing monitor with no threshold field gets the default of 2', () => {
    // Migration: nothing in the operator's monitors.json carries the field.
    const { cfg, stateFile } = sandbox('exit 1', { minConsecutiveFailures: undefined })
    runDaemon(cfg)
    expect(readState(stateFile).status).toBe('ok')
    runDaemon(cfg)
    expect(readState(stateFile).status).toBe('fail')
  })

  test('a blip followed by a success clears the counter, and the run starts over', () => {
    const { cfg, stateFile } = sandbox(
      'if [ -e "$TERMINAL_CONFIG_DIR/pass" ]; then exit 0; else exit 1; fi',
    )
    runDaemon(cfg)
    expect(readState(stateFile).consecutiveFailures).toBe(1)

    writeFileSync(join(cfg, 'pass'), '')
    runDaemon(cfg)
    const recovered = readState(stateFile)
    expect(recovered.status).toBe('ok')
    expect(recovered.consecutiveFailures).toBe(0)
    // Never published as down ⇒ never "recovered" ⇒ no transition, no items.
    expect(recovered.lastTransition).toBeNull()
  })

  test('threshold 1 keeps the old alert-on-first-failure behaviour', () => {
    const { cfg, stateFile } = sandbox('exit 1', { minConsecutiveFailures: 1 })
    runDaemon(cfg)
    expect(readState(stateFile).status).toBe('fail')
  })

  test('a real recovery from a published failure transitions on the first success', () => {
    const { cfg, stateFile } = sandbox('exit 0')
    writeFileSync(
      stateFile,
      JSON.stringify({
        id: 'threshold-under-test',
        status: 'fail',
        consecutiveFailures: 6,
        history: [],
      }),
    )
    runDaemon(cfg)
    const state = readState(stateFile)
    expect(state.status).toBe('ok')
    expect(state.consecutiveFailures).toBe(0)
    expect(state.lastTransition).toEqual(expect.objectContaining({ from: 'fail', to: 'ok' }))
  })

  test('a failing command carries its category through to the state file', () => {
    const { cfg, stateFile } = sandbox('exit 1', { minConsecutiveFailures: 1 })
    runDaemon(cfg)
    expect(readState(stateFile).category).toBe('command')
  })
})

describe('tick never overlaps itself', () => {
  test('a held, fresh lock makes the tick a no-op', () => {
    const { cfg, stateFile } = sandbox('exit 0', { minConsecutiveFailures: 1 })
    writeFileSync(
      join(cfg, 'monitor-tick.lock'),
      JSON.stringify({ pid: process.pid, at: Date.now() }),
    )
    runDaemon(cfg, ['tick'])
    // A second cycle writing the same state files interleaves transitions, so
    // the overlapping run must do nothing at all.
    expect(existsSync(stateFile)).toBe(false)
  })

  test('a stale lock is taken over rather than deadlocking the daemon forever', () => {
    const { cfg, stateFile } = sandbox('exit 0', { minConsecutiveFailures: 1 })
    writeFileSync(
      join(cfg, 'monitor-tick.lock'),
      JSON.stringify({ pid: 999999, at: Date.now() - 60 * 60_000 }),
    )
    runDaemon(cfg, ['tick'])
    expect(readState(stateFile).status).toBe('ok')
    // The lock is released on the way out, not left for the next tick to trip.
    expect(existsSync(join(cfg, 'monitor-tick.lock'))).toBe(false)
  })
})
