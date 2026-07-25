import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic, writeJsonAtomic } from './atomic-write'

const dir = () => mkdtempSync(join(tmpdir(), 'tm-atomic-'))

describe('writeFileAtomic', () => {
  test('writes the file and leaves no temp behind', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileAtomic(f, 'hello')
    expect(readFileSync(f, 'utf8')).toBe('hello')
    expect(readdirSync(d)).toEqual(['state.json'])
  })

  test('replaces existing content wholesale', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileSync(f, 'a much longer previous value')
    writeFileAtomic(f, 'short')
    expect(readFileSync(f, 'utf8')).toBe('short')
  })

  test('creates missing parent directories', () => {
    const f = join(dir(), 'nested', 'deep', 'state.json')
    writeFileAtomic(f, 'x')
    expect(readFileSync(f, 'utf8')).toBe('x')
  })

  test('honours a restrictive mode (secrets stay owner-only)', () => {
    const f = join(dir(), 'secret.json')
    writeFileAtomic(f, 'shh', { mode: 0o600 })
    expect(statSync(f).mode & 0o077).toBe(0)
  })

  test('the previous file survives a failed write', () => {
    const d = dir()
    const f = join(d, 'state.json')
    writeFileAtomic(f, 'good')
    // A directory where the temp file must go → the write throws…
    expect(() => writeFileAtomic(join(d, 'state.json', 'nope'), 'bad')).toThrow()
    // …and the original is untouched, which is the whole point.
    expect(readFileSync(f, 'utf8')).toBe('good')
  })

  test('a temp file is not left behind after a failure', () => {
    const d = dir()
    try {
      writeFileAtomic(join(d, 'x', 'y', 'z'), 'v')
    } catch {
      /* expected on some platforms */
    }
    expect(readdirSync(d).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('writeJsonAtomic', () => {
  test('writes pretty-printed JSON with a trailing newline', () => {
    const f = join(dir(), 'state.json')
    writeJsonAtomic(f, { a: 1, b: [2, 3] })
    const raw = readFileSync(f, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual({ a: 1, b: [2, 3] })
    expect(raw).toContain('\n  "a": 1') // indented, not minified
  })

  test('round-trips an empty list (the reset case)', () => {
    const f = join(dir(), 'state.json')
    writeJsonAtomic(f, [])
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([])
    expect(existsSync(`${f}.tmp`)).toBe(false)
  })
})
