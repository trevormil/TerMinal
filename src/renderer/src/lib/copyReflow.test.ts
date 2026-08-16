import { describe, expect, test } from 'bun:test'
import { reflowTerminalCopy } from './copyReflow'

// The shapes here are real transcript output: Claude Code word-wraps by
// printing hard newlines plus a 2-space hanging indent, so a native copy
// pastes with the wrap baked in. The reflow must undo exactly that — and
// nothing else.

const COLS = 90

describe('reflowTerminalCopy', () => {
  test('joins a hard-wrapped prose bullet back into one line', () => {
    const text = [
      '⏺ The release finished cleanly: built from main (bd47356b), notarized and installed to',
      '  /Applications/TerMinal.app. Your running instance was not quit — restart TerMinal',
      '  whenever you are ready.',
    ].join('\n')
    expect(reflowTerminalCopy(text, COLS)).toBe(
      '⏺ The release finished cleanly: built from main (bd47356b), notarized and installed to ' +
        '/Applications/TerMinal.app. Your running instance was not quit — restart TerMinal ' +
        'whenever you are ready.',
    )
  })

  test('a selection that starts mid-bullet still reflows', () => {
    const text = [
      'The pager shows the visible range, the total kept, and the unread pill beside it in',
      '  the header.',
    ].join('\n')
    expect(reflowTerminalCopy(text, COLS)).toBe(
      'The pager shows the visible range, the total kept, and the unread pill beside it in the header.',
    )
  })

  test('a copied code block keeps its line breaks and pastes flush', () => {
    const text = [
      '  const fit = new FitAddon()',
      '  term.loadAddon(fit)',
      '  term.open(el)',
      '  fit.fit()',
    ].join('\n')
    // Short lines: every "next" first word would have fit, so no join —
    // and the common indent is stripped so the paste needs no backspacing.
    expect(reflowTerminalCopy(text, COLS)).toBe(
      ['const fit = new FitAddon()', 'term.loadAddon(fit)', 'term.open(el)', 'fit.fit()'].join(
        '\n',
      ),
    )
  })

  test('relative indentation inside a code block survives the dedent', () => {
    const text = ['  function f() {', '    return 1', '  }'].join('\n')
    expect(reflowTerminalCopy(text, COLS)).toBe(['function f() {', '  return 1', '}'].join('\n'))
  })

  test('an indented list item after a full line stays its own line', () => {
    const long = 'x'.repeat(COLS - 2)
    const text = [long, '  - first point', '  - second point'].join('\n')
    // The marker guard blocks the join; the items keep their nesting because
    // the unindented first line pins the common indent at zero.
    expect(reflowTerminalCopy(text, COLS)).toBe(text)
  })

  test('a wrapped numbered-list item joins, the next item does not', () => {
    const first = '1. This numbered item runs long enough that its final word lands on the next'
    const text = [first, '   physical row of the transcript.', '2. Second item.'].join('\n')
    expect(reflowTerminalCopy(text, 80)).toBe(
      [`${first} physical row of the transcript.`, '2. Second item.'].join('\n'),
    )
  })

  test('blank lines keep paragraphs apart', () => {
    const text = ['First paragraph.', '', '  Second paragraph, indented.'].join('\n')
    expect(reflowTerminalCopy(text, COLS)).toBe(
      ['First paragraph.', '', '  Second paragraph, indented.'].join('\n'),
    )
  })

  test('a deliberate short line is never glued to the next', () => {
    const text = ['Short line.', '  indented continuation that was not a wrap'].join('\n')
    expect(reflowTerminalCopy(text, COLS)).toBe(text)
  })

  test('a single indented line just loses its indent', () => {
    expect(reflowTerminalCopy('  bun run release', COLS)).toBe('bun run release')
  })

  test('empty and degenerate input pass through', () => {
    expect(reflowTerminalCopy('', COLS)).toBe('')
    expect(reflowTerminalCopy('plain', 0)).toBe('plain')
  })
})
