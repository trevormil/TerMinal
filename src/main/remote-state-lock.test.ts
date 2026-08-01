import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REMOTE_SCRIPT } from './remote'

// Ticket 110. REMOTE_SCRIPT is shipped to a remote host over ssh and run with
// `node -e`. On that host it mutates the SAME hitl.json and schedules.json that
// the host's own terminal-cron and terminal-cli mutate — and both of those take
// an advisory lock. A lock only works if every writer takes it, so this script
// was quietly the writer that broke it for everyone else on that machine.
//
// This copy is CommonJS and therefore cannot be the byte-identical copy that
// bin-state-lock.test.ts pins across the two bin scripts. A third variant that
// nothing exercises is exactly how a "fixed" lock silently stops locking, so
// these tests run the real block, out of the real shipped string, in real
// concurrent processes.

/** Extract the locking block from the shipped script into a loadable module. */
function extractHelpers(): string {
  const start = REMOTE_SCRIPT.indexOf('// --- crash-safe shared-state writes')
  const end = REMOTE_SCRIPT.indexOf('\n', REMOTE_SCRIPT.indexOf('function updateJsonListShared'))
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return `const fs = require('fs')
const path = require('path')
${REMOTE_SCRIPT.slice(start, end)}
module.exports = { updateJsonListShared, withFileLockShared, writeJsonAtomicShared }
`
}

function fixture(): { dir: string; helpers: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tm-remote-lock-'))
  const helpers = join(dir, 'helpers.cjs')
  writeFileSync(helpers, extractHelpers())
  return { dir, helpers }
}

type Updater = (file: string, update: (cur: unknown[]) => unknown[] | undefined) => boolean

describe('REMOTE_SCRIPT inlines a working shared-state lock (ticket 110)', () => {
  test('four concurrent processes appending to hitl.json lose nothing', async () => {
    const { dir, helpers } = fixture()
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[]')

    const bump = join(dir, 'bump.cjs')
    writeFileSync(
      bump,
      `const { updateJsonListShared } = require(${JSON.stringify(helpers)})
const tag = process.argv[2]
for (let i = 0; i < 15; i++) {
  updateJsonListShared(${JSON.stringify(hitl)}, (cur) => {
    // A deliberate read/write gap. Unlocked, this drops most of the writes.
    Bun.sleepSync(1)
    return [{ id: tag + '-' + i }, ...cur]
  })
}
`,
    )
    const procs = ['a', 'b', 'c', 'd'].map((tag) =>
      Bun.spawn(['bun', bump, tag], { stderr: 'inherit' }),
    )
    for (const p of procs) expect(await p.exited).toBe(0)

    const list = JSON.parse(readFileSync(hitl, 'utf8')) as { id: string }[]
    expect(list.length).toBe(60)
    expect(new Set(list.map((h) => h.id)).size).toBe(60)
  }, 30_000)

  test('a torn hitl.json is quarantined, not replaced by the one item being written', async () => {
    const { dir, helpers } = fixture()
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[{"id":"real-blocker"},{"id"')

    const { updateJsonListShared } = require(helpers) as { updateJsonListShared: Updater }
    expect(() => updateJsonListShared(hitl, (cur) => [{ id: 'new' }, ...cur])).toThrow(/corrupt/)

    const quarantined = readdirSync(dir).filter((n) => n.includes('.corrupt-'))
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toContain('real-blocker')
  })

  test('an absent file is not corruption — the first write just creates it', () => {
    const { dir, helpers } = fixture()
    const { updateJsonListShared } = require(helpers) as { updateJsonListShared: Updater }
    const f = join(dir, 'hitl.json')
    expect(updateJsonListShared(f, (cur) => [{ id: 'first' }, ...cur])).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([{ id: 'first' }])
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(false)
  })

  test('a lock abandoned by a dead process does not wedge the next writer', () => {
    const { dir, helpers } = fixture()
    const f = join(dir, 'hitl.json')
    writeFileSync(f, '[]')
    // What a killed ssh invocation leaves behind.
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: 999999, at: Date.now(), token: 'dead' }))

    const { updateJsonListShared } = require(helpers) as { updateJsonListShared: Updater }
    const t0 = Date.now()
    expect(updateJsonListShared(f, (cur) => [{ id: 'x' }, ...cur])).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  test('returning undefined aborts the write, leaving the file untouched', () => {
    // hitlResolve/scheduleToggle rely on this to report "not found" without
    // rewriting the file they just read.
    const { dir, helpers } = fixture()
    const f = join(dir, 'hitl.json')
    writeFileSync(f, '[{"id":"keep"}]')
    const { updateJsonListShared } = require(helpers) as { updateJsonListShared: Updater }
    expect(updateJsonListShared(f, () => undefined)).toBe(false)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([{ id: 'keep' }])
  })
})
