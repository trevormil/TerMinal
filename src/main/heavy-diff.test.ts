import { describe, expect, test } from 'bun:test'
import { classifyHeavyDiff, parseNumstat } from './heavy-diff'

describe('parseNumstat', () => {
  test('parses text and binary numstat lines', () => {
    expect(parseNumstat('10\t2\tsrc/app.ts\n-\t-\tassets/logo.png')).toEqual([
      { path: 'src/app.ts', added: 10, deleted: 2, binary: false },
      { path: 'assets/logo.png', added: 0, deleted: 0, binary: true },
    ])
  })

  test('skips malformed numstat lines', () => {
    expect(parseNumstat('oops\n1\tNaN\tbad.ts\n2\t3\tgood.ts')).toEqual([
      { path: 'good.ts', added: 2, deleted: 3, binary: false },
    ])
  })
})

describe('classifyHeavyDiff', () => {
  test('marks risky paths heavy even when small', () => {
    expect(classifyHeavyDiff('1\t1\tsrc/auth/session.ts')).toMatchObject({
      heavy: true,
      reason: 'risky path: src/auth/session.ts',
      lineCount: 2,
    })
  })

  test('marks large non-risky diffs heavy by threshold', () => {
    expect(classifyHeavyDiff('300\t250\tsrc/editor.ts')).toMatchObject({
      heavy: true,
      reason: 'large diff: 550 lines',
    })
  })

  test('keeps small docs-only diffs light', () => {
    expect(classifyHeavyDiff('20\t5\tdocs/runbooks/release.md')).toMatchObject({
      heavy: false,
      reason: 'docs-only diff',
      lineCount: 25,
    })
  })

  test('handles binary and empty diffs', () => {
    expect(classifyHeavyDiff('-\t-\tassets/logo.png')).toMatchObject({
      heavy: false,
      reason: 'below threshold: 0 lines',
    })
    expect(classifyHeavyDiff('')).toMatchObject({
      heavy: false,
      reason: 'empty diff',
      lineCount: 0,
    })
  })
})
