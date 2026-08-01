import { describe, expect, test } from 'bun:test'
import { shellEscapePath, formatDroppedPaths, droppedPathText } from './terminalInput'

describe('shellEscapePath', () => {
  test('leaves plain absolute paths untouched', () => {
    expect(shellEscapePath('/Users/me/project/src/index.ts')).toBe('/Users/me/project/src/index.ts')
  })

  test('backslash-escapes spaces (the whole point)', () => {
    expect(shellEscapePath('/Users/me/My Documents/notes.md')).toBe(
      '/Users/me/My\\ Documents/notes.md',
    )
  })

  test('escapes shell metacharacters that would otherwise break the line', () => {
    expect(shellEscapePath('/tmp/a (copy).txt')).toBe('/tmp/a\\ \\(copy\\).txt')
    expect(shellEscapePath("/tmp/it's & more.txt")).toBe("/tmp/it\\'s\\ \\&\\ more.txt")
    expect(shellEscapePath('/tmp/$HOME [1].png')).toBe('/tmp/\\$HOME\\ \\[1\\].png')
  })

  test('keeps unicode filenames intact (not a shell metachar)', () => {
    expect(shellEscapePath('/tmp/café.txt')).toBe('/tmp/café.txt')
  })
})

describe('formatDroppedPaths', () => {
  test('single file → escaped path with trailing space', () => {
    expect(formatDroppedPaths(['/tmp/a b.txt'])).toBe('/tmp/a\\ b.txt ')
  })

  test('multiple files → space-separated, each escaped', () => {
    expect(formatDroppedPaths(['/tmp/one.txt', '/tmp/two three.txt'])).toBe(
      '/tmp/one.txt /tmp/two\\ three.txt ',
    )
  })

  test('drops blank/whitespace entries', () => {
    expect(formatDroppedPaths(['', '   ', '/tmp/x.txt'])).toBe('/tmp/x.txt ')
  })

  test('empty input yields empty string (nothing to insert)', () => {
    expect(formatDroppedPaths([])).toBe('')
    expect(formatDroppedPaths(['', '  '])).toBe('')
  })
})

describe('droppedPathText', () => {
  test('an in-app drag inserts the repo-RELATIVE path, not the absolute one', () => {
    // The tree sets both payloads on every drag: the relative one for us, the
    // absolute one on text/plain for drops into other applications.
    expect(
      droppedPathText({
        rel: ['src/main/agents.ts'],
        text: '/Users/me/proj/src/main/agents.ts',
      }),
    ).toBe('src/main/agents.ts ')
  })

  test('relative wins even when a Finder-style absolute path is also present', () => {
    expect(droppedPathText({ rel: ['src/a.ts'], abs: ['/Users/me/proj/src/a.ts'] })).toBe(
      'src/a.ts ',
    )
  })

  test('a Finder drop has no workspace context, so it stays absolute', () => {
    expect(droppedPathText({ abs: ['/Users/me/Desktop/notes.md'] })).toBe(
      '/Users/me/Desktop/notes.md ',
    )
  })

  test('multiple dropped files join space-separated, each escaped', () => {
    expect(droppedPathText({ abs: ['/tmp/one.txt', '/tmp/two three.txt'] })).toBe(
      '/tmp/one.txt /tmp/two\\ three.txt ',
    )
  })

  test('paths with spaces are escaped in the relative case too', () => {
    expect(droppedPathText({ rel: ['docs/my notes.md'] })).toBe('docs/my\\ notes.md ')
  })

  test('falls back to the text payload, honouring every line (not just the first)', () => {
    expect(droppedPathText({ text: '/tmp/a.txt\n/tmp/b c.txt' })).toBe('/tmp/a.txt /tmp/b\\ c.txt ')
  })

  test('decodes file:// URIs and drops text/uri-list comment lines', () => {
    expect(droppedPathText({ text: '# comment\nfile:///Users/me/a%20b.txt' })).toBe(
      '/Users/me/a\\ b.txt ',
    )
  })

  test('a dropped web link is inserted verbatim — escaping would mangle the query', () => {
    expect(droppedPathText({ text: 'https://example.com/x?a=1&b=2' })).toBe(
      'https://example.com/x?a=1&b=2 ',
    )
  })

  test('nothing droppable yields empty string, so the caller writes nothing', () => {
    expect(droppedPathText({})).toBe('')
    expect(droppedPathText({ rel: ['', '  '], abs: [], text: '   \n#only a comment' })).toBe('')
  })

  test('never appends a submit — the human presses enter', () => {
    expect(droppedPathText({ rel: ['a.ts'] })).not.toContain('\r')
    expect(droppedPathText({ rel: ['a.ts'] })).not.toContain('\n')
  })
})
