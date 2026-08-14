import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The local-connectivity gate, proven against bin/terminal-monitor itself — the
// only process that ever runs a probe. A unit test of the pure predicates
// (src/shared/monitor-flap.test.ts) cannot show that the daemon actually gates
// the cycle on them, which is the whole feature.
//
// No real network is required, and none is used:
//   * a `.invalid` hostname is guaranteed never to resolve (RFC 6761), so it
//     fails as `dns` — a NETWORK-LAYER failure, the only kind that may vote for
//     "our uplink is gone";
//   * a reference URL on `.invalid` therefore reads as unreachable ⇒ offline;
//   * a reference URL on 127.0.0.1:1 is REFUSED, which proves a packet made the
//     round trip ⇒ online.
// TERMINAL_MONITOR_REFERENCE_URLS exists precisely so this is expressible
// without unplugging the machine.

const DAEMON = resolve(import.meta.dir, '../../bin/terminal-monitor')

const UNRESOLVABLE = 'no-such-host.terminal-monitor-test.invalid'
const REFS_DOWN = 'http://no-such-reference.terminal-monitor-test.invalid/'
const REFS_UP = 'http://127.0.0.1:1/'

type Opts = { type?: string; target?: string; minConsecutiveFailures?: number }

function sandbox(opts: Opts = {}): { cfg: string; stateFile: string } {
  const cfg = mkdtempSync(join(tmpdir(), 'tm-monitor-conn-'))
  mkdirSync(join(cfg, 'monitor-state'), { recursive: true })
  writeFileSync(
    join(cfg, 'monitors.json'),
    JSON.stringify([
      {
        id: 'gate-under-test',
        name: 'gate under test',
        type: opts.type ?? 'dns',
        target: opts.target ?? UNRESOLVABLE,
        intervalSec: 0,
        enabled: true,
        minConsecutiveFailures: opts.minConsecutiveFailures ?? 1,
        notify: { onFailure: 'urgent', onRecovery: true, renotifyAfterSec: 0 },
        config: { confirmDelayMs: 0 },
      },
    ]),
  )
  return { cfg, stateFile: join(cfg, 'monitor-state', 'gate-under-test.json') }
}

// `run <id>` rather than `tick`: the gate is identical on both paths, and a
// tick would additionally have to satisfy the due-interval check, which the
// threshold suite already covers.
function runDaemon(cfg: string, refs: string): void {
  execFileSync('bun', [DAEMON, 'run', 'gate-under-test'], {
    env: { ...process.env, TERMINAL_CONFIG_DIR: cfg, TERMINAL_MONITOR_REFERENCE_URLS: refs },
    stdio: 'ignore',
    timeout: 60_000,
  })
}

const readJson = (f: string): Record<string, unknown> => JSON.parse(readFileSync(f, 'utf8'))
const connectivity = (cfg: string): Record<string, unknown> =>
  readJson(join(cfg, 'monitor-connectivity.json'))

describe('local-connectivity gate', () => {
  test('all-network-fail plus unreachable references pauses the cycle', () => {
    const { cfg, stateFile } = sandbox()
    runDaemon(cfg, REFS_DOWN)

    const state = readJson(stateFile)
    // The check is DISCARDED, not recorded: no transition, no counter, and the
    // monitor keeps whatever health it last legitimately had.
    expect(state.paused).toBe(true)
    expect(state.status).toBe('ok')
    expect(state.consecutiveFailures).toBe(0)
    expect(state.lastTransition ?? null).toBeNull()
    expect(typeof state.pausedSince).toBe('number')

    expect(connectivity(cfg).offline).toBe(true)
  })

  test('a monitor already published as down is not faked back to healthy', () => {
    const { cfg, stateFile } = sandbox()
    writeFileSync(
      stateFile,
      JSON.stringify({
        id: 'gate-under-test',
        status: 'fail',
        summary: 'was already down',
        consecutiveFailures: 4,
        history: [],
      }),
    )
    runDaemon(cfg, REFS_DOWN)

    const state = readJson(stateFile)
    expect(state.status).toBe('fail')
    expect(state.paused).toBe(true)
  })

  test('connectivity returning auto-resumes: checks count again and pause clears', () => {
    const { cfg, stateFile } = sandbox()
    runDaemon(cfg, REFS_DOWN)
    expect(readJson(stateFile).paused).toBe(true)

    runDaemon(cfg, REFS_UP)
    const state = readJson(stateFile)
    expect(state.paused).toBe(false)
    // Threshold 1 ⇒ the first counted failure after resuming is published.
    expect(state.status).toBe('fail')
    expect(state.consecutiveFailures).toBe(1)
    expect(state.category).toBe('dns')
    expect(connectivity(cfg).offline).toBe(false)
  })

  test('failures accumulated across a pause cannot add up to an alert', () => {
    // One failure before the outage plus one after must not complete a run of
    // two: the counter does not survive the pause, so the post-outage run
    // starts from zero and a genuinely-down target re-earns its alert.
    const { cfg, stateFile } = sandbox({ minConsecutiveFailures: 2 })
    runDaemon(cfg, REFS_UP)
    expect(readJson(stateFile).consecutiveFailures).toBe(1)

    runDaemon(cfg, REFS_DOWN)
    expect(readJson(stateFile).consecutiveFailures).toBe(0)

    runDaemon(cfg, REFS_UP)
    const state = readJson(stateFile)
    expect(state.consecutiveFailures).toBe(1)
    expect(state.status).toBe('ok')
    expect(state.lastTransition ?? null).toBeNull()
  })

  test('an HTTP probe still tells DNS from refused, which Bun itself does not', () => {
    // Bun collapses both into one opaque "Unable to connect" with no cause. If
    // the daemon took that at face value every HTTP failure would land as
    // `unknown`, the gate would never see a network-layer failure, and the
    // pause could not fire for an all-HTTP setup — i.e. every real one.
    const unresolvable = sandbox({ type: 'http', target: `http://${UNRESOLVABLE}/` })
    runDaemon(unresolvable.cfg, REFS_UP)
    expect(readJson(unresolvable.stateFile).category).toBe('dns')

    const refused = sandbox({ type: 'http', target: REFS_UP })
    runDaemon(refused.cfg, REFS_UP)
    expect(readJson(refused.stateFile).category).toBe('refused')
  })

  test('a failure that proves connectivity never pauses, however dead the references look', () => {
    // Port 1 on loopback is refused — their end answered. That single fact
    // settles the cycle as "their problem" before a reference probe is even
    // considered, which is what stops the gate from muting a real outage.
    const { cfg, stateFile } = sandbox({ type: 'tcp', target: '127.0.0.1:1' })
    runDaemon(cfg, REFS_DOWN)

    const state = readJson(stateFile)
    expect(state.paused).toBe(false)
    expect(state.status).toBe('fail')
    expect(state.category).toBe('refused')
    // Never suspected ⇒ the verdict file records us as online.
    expect(existsSync(join(cfg, 'monitor-connectivity.json'))).toBe(false)
  })
})
