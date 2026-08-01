import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMonitorProbe } from './monitors'

// A stand-in for bin/terminal-monitor: takes `run <id>`, sleeps, then exits with
// a code we choose. Never the real daemon, and never the real config dir.
const dir = mkdtempSync(join(tmpdir(), 'gt-monitor-probe-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeDaemon(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

const slow = fakeDaemon('slow', 'sleep 0.4; exit 0')
const failing = fakeDaemon('failing', 'exit 3')
const chatty = fakeDaemon('chatty', "head -c 2000000 /dev/zero | tr '\\0' 'x'; exit 0")

describe('runMonitorProbe', () => {
  // The property the whole fix exists for: `monitors:run` used execFileSync with
  // a 40s timeout inside an IPC handler, so one click on a hung endpoint froze
  // every window, session and timer. Reverting to a sync call would fail this.
  test('the event loop keeps running while a probe is in flight', async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 20)
    try {
      const started = Date.now()
      const r = await runMonitorProbe('any-id', { bin: slow })
      const elapsed = Date.now() - started
      expect(r.ok).toBe(true)
      // The probe genuinely took time...
      expect(elapsed).toBeGreaterThanOrEqual(300)
      // ...and the loop was live throughout, rather than starved.
      expect(ticks).toBeGreaterThan(5)
    } finally {
      clearInterval(timer)
    }
  })

  test('a probe never rejects — a failure is reported, not thrown', async () => {
    const r = await runMonitorProbe('any-id', { bin: failing })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  test('a missing daemon binary resolves rather than throwing', async () => {
    const r = await runMonitorProbe('any-id', { bin: join(dir, 'does-not-exist') })
    expect(r.ok).toBe(false)
  })

  test('a probe that outruns its timeout still settles', async () => {
    const hung = fakeDaemon('hung', 'sleep 30')
    const started = Date.now()
    const r = await runMonitorProbe('any-id', { bin: hung, timeoutMs: 200 })
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  // The old call used stdio:'ignore'; execFile buffers, and the 1 MB default
  // would SIGTERM a chatty `command` monitor with ENOBUFS — silently.
  test('a chatty monitor is not killed by the default 1MB execFile buffer', async () => {
    const r = await runMonitorProbe('any-id', { bin: chatty })
    expect(r.ok).toBe(true)
  })
})
