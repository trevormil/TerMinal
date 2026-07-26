import { describe, expect, test } from 'bun:test'
import { DEFAULT_INDENT, describeIndent, detectIndent, indentUnitFor } from './indent'

describe('detectIndent', () => {
  test('detects 2-space indentation', () => {
    const src = ['function a() {', '  const x = 1', '  if (x) {', '    return x', '  }', '}'].join(
      '\n',
    )
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 2 })
  })

  test('detects 4-space indentation', () => {
    const src = ['def a():', '    x = 1', '    if x:', '        return x'].join('\n')
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 4 })
  })

  test('detects tabs when they dominate', () => {
    const src = ['func a() {', '\tx := 1', '\tif x {', '\t\treturn x', '\t}', '}'].join('\n')
    expect(detectIndent(src).useTabs).toBe(true)
  })

  test('deep nesting does not fool it into 4/6/8 (the absolute-count trap)', () => {
    // Mostly 4s and 6s by absolute width, but every STEP is 2.
    const src = ['a', '  b', '    c', '      d', '      e', '    f', '  g'].join('\n')
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 2 })
  })

  test('blank lines and single-space alignment are ignored', () => {
    const src = ['a', '', ' * aligned comment', '    b', '        c'].join('\n')
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 4 })
  })

  test('an unindented or empty file falls back', () => {
    expect(detectIndent('one line')).toEqual(DEFAULT_INDENT)
    expect(detectIndent('')).toEqual(DEFAULT_INDENT)
    expect(detectIndent('a\nb\nc', { useTabs: false, width: 4 })).toEqual({
      useTabs: false,
      width: 4,
    })
  })

  test('mixed file picks the dominant style, not the first one seen', () => {
    // One stray tab line, many space lines → spaces win.
    const src = ['\tstray', 'a', '  b', '    c', '  d', '    e'].join('\n')
    expect(detectIndent(src).useTabs).toBe(false)
  })

  // Counting each *distinct* width once let a single wrapped-argument line
  // carry the same weight as the entire rest of the file: widths {4, 6} vote
  // 4 once and 2 once, and the smaller-width tie-break then picked 2 — so a
  // 4-space file indented at 2.
  test('a lone wrapped continuation does not outvote the dominant indent', () => {
    const src = [
      'def f():',
      '    value = call(',
      '      wrapped_arg,',
      '    )',
      '    return value',
    ].join('\n')
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 4 })
  })

  test('a genuinely 2-space file still wins against a few deeper lines', () => {
    const src = ['a', '  b', '  c', '  d', '    e', '    f', '      g'].join('\n')
    expect(detectIndent(src)).toEqual({ useTabs: false, width: 2 })
  })
})

describe('indentUnitFor / describeIndent', () => {
  test('renders the unit and a human label', () => {
    expect(indentUnitFor({ useTabs: false, width: 2 })).toBe('  ')
    expect(indentUnitFor({ useTabs: false, width: 4 })).toBe('    ')
    expect(indentUnitFor({ useTabs: true, width: 4 })).toBe('\t')
    expect(describeIndent({ useTabs: false, width: 2 })).toBe('Spaces: 2')
    expect(describeIndent({ useTabs: true, width: 4 })).toBe('Tabs')
  })
})
