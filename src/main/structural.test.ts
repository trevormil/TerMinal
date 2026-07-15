import { test, expect, describe } from 'bun:test'
import { looksBinary, structuralDiffFromContent } from './structural'
import { getWorkingStructuralDiff } from './local-structural'

const NUL = String.fromCharCode(0)

describe('structural primitive', () => {
  test('looksBinary flags NUL bytes, not plain text', () => {
    expect(looksBinary(`hello${NUL}world`)).toBe(true)
    expect(looksBinary('normal text\nwith newlines')).toBe(false)
    expect(looksBinary(null)).toBe(false)
  })

  test('both sides absent → fetch-failed (no difft run)', async () => {
    const r = await structuralDiffFromContent(null, null, 160, 'x')
    expect(r).toEqual({ ok: false, reason: 'fetch-failed' })
  })

  test('binary content short-circuits to binary (no difft run)', async () => {
    const r = await structuralDiffFromContent(`a${NUL}b`, 'plain', 160, 'x')
    expect(r).toEqual({ ok: false, reason: 'binary' })
  })
})

describe('getWorkingStructuralDiff', () => {
  test('rejects path traversal without touching git/difft', async () => {
    const r = await getWorkingStructuralDiff('/tmp', '../etc/passwd', 160)
    expect(r).toEqual({ ok: false, reason: 'error', message: 'invalid path' })
  })

  test('empty repo/path → error', async () => {
    expect(await getWorkingStructuralDiff('', 'a.ts', 160)).toMatchObject({
      ok: false,
      reason: 'error',
    })
  })
})
