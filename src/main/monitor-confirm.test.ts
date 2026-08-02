import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { needsConfirmation } from './monitors'

// Monitor flap suppression.
//
// Every "is down" Inbox item filed over the last week traced to a single blown
// probe — "no response" on one check, HTTP 200 on the very next one. One
// timed-out fetch from a laptop (sleep/wake, Wi-Fi blip) flipped the state file
// to fail, filed an urgent item, then filed the recovery a couple of minutes
// later. The fix: a probe that would move a monitor to a WORSE state is
// re-probed once before the transition is believed. A real outage still fails
// the second probe and alerts within seconds of the first; a blip never
// transitions, so it never notifies.

describe('needsConfirmation', () => {
  test('worsening transitions require a second opinion', () => {
    expect(needsConfirmation('ok', 'fail')).toBe(true)
    expect(needsConfirmation('ok', 'warn')).toBe(true)
    expect(needsConfirmation('warn', 'fail')).toBe(true)
  })

  test('steady state and recoveries are believed immediately', () => {
    // Recovery must never be delayed — a late "it's back" helps nobody, and a
    // flap that clears on the confirm probe should read as unbroken ok.
    expect(needsConfirmation('ok', 'ok')).toBe(false)
    expect(needsConfirmation('fail', 'ok')).toBe(false)
    expect(needsConfirmation('fail', 'warn')).toBe(false)
    expect(needsConfirmation('warn', 'warn')).toBe(false)
    expect(needsConfirmation('fail', 'fail')).toBe(false)
  })
})

// The daemon is the only process that ever runs a probe, so the behavior has to
// be proven against bin/terminal-monitor itself, not a mirror of it.
const DAEMON = resolve(import.meta.dir, '../../bin/terminal-monitor')

function sandbox(target: string): { cfg: string; stateFile: string } {
  const cfg = mkdtempSync(join(tmpdir(), 'tm-monitor-confirm-'))
  mkdirSync(join(cfg, 'monitor-state'), { recursive: true })
  writeFileSync(
    join(cfg, 'monitors.json'),
    JSON.stringify([
      {
        id: 'probe-under-test',
        name: 'probe under test',
        type: 'command',
        target,
        intervalSec: 60,
        enabled: true,
        notify: { onFailure: 'urgent', onRecovery: true, renotifyAfterSec: 0 },
        config: { confirmDelayMs: 0 },
      },
    ]),
  )
  return { cfg, stateFile: join(cfg, 'monitor-state', 'probe-under-test.json') }
}

function runDaemon(cfg: string): void {
  execFileSync('bun', [DAEMON, 'run', 'probe-under-test'], {
    env: { ...process.env, TERMINAL_CONFIG_DIR: cfg },
    stdio: 'ignore',
    timeout: 30_000,
  })
}

describe('bin/terminal-monitor confirms a worsening probe before believing it', () => {
  test('a fail that passes on re-probe never leaves ok', () => {
    // First invocation of the check fails (the blip), every later one passes.
    const { cfg, stateFile } = sandbox(
      'if [ -e "$TERMINAL_CONFIG_DIR/blip" ]; then exit 0; else touch "$TERMINAL_CONFIG_DIR/blip"; exit 1; fi',
    )
    runDaemon(cfg)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    expect(state.status).toBe('ok')
    // No transition means nothing was filed and nothing will "recover" later.
    expect(state.lastTransition).toBeNull()
  })

  test('a real failure still fails after confirmation', () => {
    const { cfg, stateFile } = sandbox('exit 1')
    runDaemon(cfg)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    expect(state.status).toBe('fail')
  })

  test('a recovery is believed without a confirm probe', () => {
    const { cfg, stateFile } = sandbox('exit 0')
    // Seed a failing state; the passing probe must flip it back in one run.
    writeFileSync(
      stateFile,
      JSON.stringify({ id: 'probe-under-test', status: 'fail', history: [] }),
    )
    runDaemon(cfg)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    expect(state.status).toBe('ok')
    expect(state.lastTransition).toEqual(
      expect.objectContaining({ from: 'fail', to: 'ok' }),
    )
  })
})
