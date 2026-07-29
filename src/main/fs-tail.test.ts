import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileTail } from './fs-tail'

const roots: string[] = []
function tmpFile(content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'tm-tail-'))
  roots.push(d)
  const f = join(d, 'log.txt')
  writeFileSync(f, content)
  return f
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('readFileTail', () => {
  test('returns the whole file when smaller than maxBytes', () => {
    const f = tmpFile('hello')
    expect(readFileTail(f, 100)).toEqual({ text: 'hello', size: 5 })
  })

  test('returns only the last maxBytes of a larger file', () => {
    const f = tmpFile('0123456789')
    expect(readFileTail(f, 4)).toEqual({ text: '6789', size: 10 })
  })

  test('empty file → empty text', () => {
    const f = tmpFile('')
    expect(readFileTail(f, 4)).toEqual({ text: '', size: 0 })
  })

  test('throws on a missing file (fs semantics preserved)', () => {
    expect(() => readFileTail('/nonexistent/nope.log', 10)).toThrow()
  })
})
