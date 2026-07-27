import { describe, expect, test } from 'bun:test'
import { buildRevisionPrompt, reanchorLine } from './review-comments'

describe('reanchorLine', () => {
  const lines = ['alpha', 'beta', 'gamma', 'beta', 'delta']

  test('finds the same text at its new position', () => {
    expect(reanchorLine({ line: 1, text: 'gamma' }, lines)).toBe(3)
  })

  test('prefers the occurrence nearest the original line', () => {
    expect(reanchorLine({ line: 5, text: 'beta' }, lines)).toBe(4)
    expect(reanchorLine({ line: 1, text: 'beta' }, lines)).toBe(2)
  })

  test('ignores surrounding whitespace changes', () => {
    expect(reanchorLine({ line: 2, text: '  beta  ' }, lines)).toBe(2)
  })

  test('a vanished line is stale, not misplaced', () => {
    expect(reanchorLine({ line: 2, text: 'omega' }, lines)).toBeNull()
  })
})

describe('buildRevisionPrompt', () => {
  test('batches every comment with its pin and quoted line', () => {
    const p = buildRevisionPrompt([
      { file: 'a.ts', line: 3, text: 'const x = 1', note: 'rename to count' },
      { file: 'b.ts', line: 9, text: '', note: 'add error handling' },
    ])
    expect(p).toContain('- a.ts:3 — rename to count')
    expect(p).toContain('> const x = 1')
    expect(p).toContain('- b.ts:9 — add error handling')
    expect(p.startsWith('Please revise')).toBe(true)
  })
})
