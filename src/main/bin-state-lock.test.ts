import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// bin/terminal-cron and bin/terminal-cli are standalone Bun scripts — they are
// copied to remote hosts on their own (host-provision.ts) and baked into the
// agent image, so they inline the locking helper rather than importing it. That
// duplication is only safe if it is actually exercised, so these tests run the
// real helper OUT of the real script file, in real concurrent processes.
//
// Nothing here touches ~/.config/TerMinal: every path is a fresh temp dir.
const CRON = resolve(import.meta.dir, '../../bin/terminal-cron')

/**
 * Extract the inlined state-io block from a bin script into a loadable module.
 * Copying it would let the copy drift from what actually ships.
 */
function extractHelpers(script: string): string {
  const src = readFileSync(script, 'utf8')
  const start = src.indexOf('// --- crash-safe shared-state writes')
  const end = src.indexOf('\n}\n', src.indexOf('function updateJsonListShared')) + 3
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return `import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
${src.slice(start, end)}
export { updateJsonListShared, withFileLockShared, writeJsonAtomicShared }
`
}

describe('bin/terminal-cron inlined state helpers', () => {
  test('four concurrent processes appending to hitl.json lose nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-bin-lock-'))
    const helpers = join(dir, 'helpers.mjs')
    writeFileSync(helpers, extractHelpers(CRON))
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[]')

    const bump = join(dir, 'bump.mjs')
    writeFileSync(
      bump,
      `import { updateJsonListShared } from ${JSON.stringify(helpers)}
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

  test('a torn hitl.json is quarantined, not replaced by the one item being filed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-bin-corrupt-'))
    const helpers = join(dir, 'helpers.mjs')
    writeFileSync(helpers, extractHelpers(CRON))
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[{"id":"real-blocker"},{"id"')

    const { updateJsonListShared } = (await import(helpers)) as {
      updateJsonListShared: (f: string, u: (cur: unknown[]) => unknown[]) => boolean
    }
    expect(() => updateJsonListShared(hitl, (cur) => [{ id: 'new' }, ...cur])).toThrow(/corrupt/)

    const quarantined = readdirSync(dir).filter((n) => n.includes('.corrupt-'))
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toContain('real-blocker')
  })

  test('an absent file is not corruption — the first write just creates it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-bin-absent-'))
    const helpers = join(dir, 'helpers.mjs')
    writeFileSync(helpers, extractHelpers(CRON))
    const { updateJsonListShared } = (await import(helpers)) as {
      updateJsonListShared: (f: string, u: (cur: unknown[]) => unknown[]) => boolean
    }
    const f = join(dir, 'hitl.json')
    expect(updateJsonListShared(f, (cur) => [{ id: 'first' }, ...cur])).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([{ id: 'first' }])
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(false)
  })

  test('a lock abandoned by a dead process does not wedge the next writer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-bin-stale-'))
    const helpers = join(dir, 'helpers.mjs')
    writeFileSync(helpers, extractHelpers(CRON))
    const f = join(dir, 'hitl.json')
    writeFileSync(f, '[]')
    // What a killed cron run leaves behind.
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: 999999, at: Date.now(), token: 'dead' }))

    const { updateJsonListShared } = (await import(helpers)) as {
      updateJsonListShared: (f: string, u: (cur: unknown[]) => unknown[]) => boolean
    }
    const t0 = Date.now()
    expect(updateJsonListShared(f, (cur) => [{ id: 'x' }, ...cur])).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('bin/terminal-cli ships the same helper', () => {
  test('the inlined block is byte-identical to terminal-cron s', () => {
    const cli = resolve(import.meta.dir, '../../bin/terminal-cli')
    expect(extractHelpers(cli)).toBe(extractHelpers(CRON))
  })
})
