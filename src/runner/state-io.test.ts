import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateJsonListShared, withFileLockShared } from './state-io'

// `withFileLockShared` is the reason the desktop app and this out-of-process
// runner can both read-modify-write hitl.json / schedules.json. It is only
// worth anything if it is exercised for real, so these drive actual concurrent
// PROCESSES and a real torn file — never a mocked fs.
//
// Nothing here touches ~/.config/TerMinal: every path is a fresh temp dir.
const MODULE = join(import.meta.dir, 'state-io.ts')

describe('runner state-io', () => {
  test('four concurrent processes appending to hitl.json lose nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-lock-'))
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[]')

    const bump = join(dir, 'bump.ts')
    writeFileSync(
      bump,
      `import { updateJsonListShared } from ${JSON.stringify(MODULE)}
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

  test('a torn hitl.json is quarantined, not replaced by the one item being filed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-corrupt-'))
    const hitl = join(dir, 'hitl.json')
    writeFileSync(hitl, '[{"id":"real-blocker"},{"id"')

    expect(() => updateJsonListShared(hitl, (cur) => [{ id: 'new' }, ...cur])).toThrow(/corrupt/)

    const quarantined = readdirSync(dir).filter((n) => n.includes('.corrupt-'))
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toContain('real-blocker')
  })

  test('an absent file is not corruption — the first write just creates it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-absent-'))
    const f = join(dir, 'hitl.json')
    expect(updateJsonListShared(f, (cur) => [{ id: 'first' }, ...cur])).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([{ id: 'first' }])
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(false)
  })

  test('a lock abandoned by a dead process does not wedge the next writer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-stale-'))
    const f = join(dir, 'hitl.json')
    writeFileSync(f, '[]')
    // What a killed cron run leaves behind.
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: 999999, at: Date.now(), token: 'dead' }))

    const t0 = Date.now()
    expect(updateJsonListShared(f, (cur) => [{ id: 'x' }, ...cur])).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  test('an update returning undefined writes nothing at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-noop-'))
    const f = join(dir, 'hitl.json')
    writeFileSync(f, '[{"id":"keep"}]')
    expect(updateJsonListShared(f, () => undefined)).toBe(false)
    expect(readFileSync(f, 'utf8')).toBe('[{"id":"keep"}]')
  })

  test('the lock is released even when the critical section throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-runner-throw-'))
    const f = join(dir, 'x.json')
    expect(() =>
      withFileLockShared(f, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    // A leaked lock file would make the NEXT writer wait out the stale timeout.
    const t0 = Date.now()
    withFileLockShared(f, () => undefined)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
