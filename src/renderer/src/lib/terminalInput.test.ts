import { describe, expect, test } from 'bun:test'
import { shellEscapePath, formatDroppedPaths } from './terminalInput'

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
