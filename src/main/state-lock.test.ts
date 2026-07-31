import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CorruptStateError,
  isLocked,
  quarantineCorruptFile,
  readJsonState,
  updateJsonState,
  withFileLock,
} from './atomic-write'

const dir = () => mkdtempSync(join(tmpdir(), 'tm-lock-'))

describe('withFileLock', () => {
  test('runs the body and returns its value', () => {
    const f = join(dir(), 'state.json')
    expect(withFileLock(f, () => 42)).toBe(42)
  })

  test('holds the lock for the duration of the body', () => {
    const f = join(dir(), 'state.json')
    withFileLock(f, () => {
      expect(isLocked(f)).toBe(true)
    })
    expect(isLocked(f)).toBe(false)
  })

  test('releases the lock when the body throws', () => {
    const d = dir()
    const f = join(d, 'state.json')
    expect(() =>
      withFileLock(f, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(isLocked(f)).toBe(false)
    expect(readdirSync(d)).toEqual([])
  })

  test('does not deadlock behind a stale lock left by a crashed process', () => {
    const f = join(dir(), 'state.json')
    // A lock file whose owner died without releasing: unreachable pid, old stamp.
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: 999999, at: Date.now() - 60_000, token: 'x' }))
    const t0 = Date.now()
    expect(withFileLock(f, () => 'took it', { staleMs: 1000 })).toBe('took it')
    // Stolen promptly, not after the full acquire timeout.
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(isLocked(f)).toBe(false)
  })

  test('never wedges forever: a fresh lock held by a live process times out and is broken', () => {
    const f = join(dir(), 'state.json')
    // Our own pid is alive and the stamp is new, so neither staleness check
    // fires — only the acquire timeout can save us.
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: process.pid, at: Date.now(), token: 'other' }))
    const t0 = Date.now()
    expect(withFileLock(f, () => 'forced', { timeoutMs: 200, staleMs: 60_000 })).toBe('forced')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200)
    expect(isLocked(f)).toBe(false)
  })

  test('a stolen lock is not deleted by the original holder on release', () => {
    const f = join(dir(), 'state.json')
    withFileLock(
      f,
      () => {
        // Simulate a second process stealing our (apparently stale) lock while
        // we are still inside the body.
        writeFileSync(`${f}.lock`, JSON.stringify({ pid: 1, at: Date.now(), token: 'thief' }))
      },
      { timeoutMs: 200 },
    )
    // The thief's lock is still there — we must not unlink a lock we no longer own.
    expect(JSON.parse(readFileSync(`${f}.lock`, 'utf8')).token).toBe('thief')
  })

  test('serialises concurrent read-modify-write across processes (no lost update)', async () => {
    const d = dir()
    const f = join(d, 'counter.json')
    writeFileSync(f, JSON.stringify({ n: 0 }))
    const script = join(d, 'bump.ts')
    writeFileSync(
      script,
      `import { updateJsonState } from ${JSON.stringify(join(import.meta.dir, 'atomic-write.ts'))}
for (let i = 0; i < 20; i++) {
  updateJsonState(${JSON.stringify(f)}, () => ({ n: 0 }), (cur: { n: number }) => {
    // A deliberate read/write gap: without a lock this loses updates every time.
    const next = cur.n + 1
    Bun.sleepSync(1)
    return { n: next }
  })
}
`,
    )
    const procs = [0, 1, 2, 3].map(() => Bun.spawn(['bun', script], { stderr: 'inherit' }))
    for (const p of procs) expect(await p.exited).toBe(0)
    expect(JSON.parse(readFileSync(f, 'utf8')).n).toBe(80)
  }, 30_000)
})

describe('readJsonState', () => {
  test('absent file yields the fallback and is not corrupt', () => {
    const r = readJsonState(join(dir(), 'nope.json'), () => [] as number[])
    expect(r).toEqual({ value: [], corrupt: false, present: false })
  })

  test('present and parseable yields the value', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, JSON.stringify([1, 2]))
    expect(readJsonState(f, () => [] as number[])).toEqual({
      value: [1, 2],
      corrupt: false,
      present: true,
    })
  })

  test('present but unparseable is reported as corrupt, and the file is left alone', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, '{"half-writ')
    const r = readJsonState(f, () => [] as number[])
    expect(r.corrupt).toBe(true)
    expect(r.value).toEqual([])
    // The bad bytes stay put until a writer quarantines them — a read must
    // never be destructive.
    expect(readFileSync(f, 'utf8')).toBe('{"half-writ')
  })

  test('a wrong-shaped value (object where a list belongs) counts as corrupt', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, '{"a":1}')
    const r = readJsonState(f, () => [] as number[], { accept: Array.isArray })
    expect(r.corrupt).toBe(true)
  })
})

describe('quarantineCorruptFile', () => {
  test('moves the file aside and returns the new path', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileSync(f, 'garbage')
    const moved = quarantineCorruptFile(f, 1700000000000)
    expect(moved).toBe(`${f}.corrupt-1700000000000`)
    expect(existsSync(f)).toBe(false)
    expect(readFileSync(moved, 'utf8')).toBe('garbage')
  })
})

describe('updateJsonState', () => {
  test('applies the update and persists it atomically', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileSync(f, JSON.stringify([1]))
    const out = updateJsonState<number[]>(
      f,
      () => [],
      (cur) => [...cur, 2],
    )
    expect(out).toEqual([1, 2])
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([1, 2])
    expect(readdirSync(d)).toEqual(['state.json'])
  })

  test('an absent file starts from the fallback', () => {
    const f = join(dir(), 'state.json')
    updateJsonState<number[]>(
      f,
      () => [],
      (cur) => [...cur, 7],
    )
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([7])
  })

  test('the update sees the CURRENT on-disk value, not a stale snapshot', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, JSON.stringify([1]))
    // Something else wrote between our read and our update — the update must
    // be handed the fresh value.
    writeFileSync(f, JSON.stringify([1, 99]))
    updateJsonState<number[]>(
      f,
      () => [],
      (cur) => [...cur, 3],
    )
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([1, 99, 3])
  })

  test('returning undefined aborts the write', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, JSON.stringify([1]))
    updateJsonState<number[]>(
      f,
      () => [],
      () => undefined,
    )
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([1])
  })

  test('REFUSES to overwrite a corrupt file, and quarantines it instead', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileSync(f, '[{"id":"a"},{"id":"b"},{"id"')
    expect(() =>
      updateJsonState<{ id: string }[]>(
        f,
        () => [],
        (cur) => [...cur, { id: 'c' }],
      ),
    ).toThrow(CorruptStateError)
    // The original bytes survive under a quarantine name — this is the whole
    // point: a torn file must never become "[]" plus one new entry.
    const quarantined = readdirSync(d).filter((n) => n.includes('.corrupt-'))
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(d, quarantined[0]), 'utf8')).toBe('[{"id":"a"},{"id":"b"},{"id"')
    expect(existsSync(f)).toBe(false)
  })

  test('a shape check failure is treated as corruption, not as an empty list', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileSync(f, '{"not":"a list"}')
    expect(() =>
      updateJsonState<number[]>(
        f,
        () => [],
        (cur) => [...cur, 1],
        { accept: Array.isArray },
      ),
    ).toThrow(CorruptStateError)
    expect(existsSync(f)).toBe(false)
    expect(readdirSync(d).some((n) => n.includes('.corrupt-'))).toBe(true)
  })

  test('the write after a quarantine succeeds (one refusal, not a permanent block)', () => {
    const f = join(dir(), 'state.json')
    writeFileSync(f, 'not json')
    expect(() =>
      updateJsonState<number[]>(
        f,
        () => [],
        (cur) => [...cur, 1],
      ),
    ).toThrow(CorruptStateError)
    updateJsonState<number[]>(
      f,
      () => [],
      (cur) => [...cur, 1],
    )
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([1])
  })
})
