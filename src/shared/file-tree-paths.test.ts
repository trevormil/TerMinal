import { expect, test } from 'bun:test'
import { withinTreePath, remapTreePath, validEntryName } from './file-tree-paths'

test('folder operations include descendants but not sibling prefixes', () => {
  expect(withinTreePath('src/a.ts', 'src')).toBe(true)
  expect(withinTreePath('src', 'src')).toBe(true)
  expect(withinTreePath('src-old/a.ts', 'src')).toBe(false)
  expect(remapTreePath('src/nested/a.ts', 'src', 'lib')).toBe('lib/nested/a.ts')
  expect(remapTreePath('src-old/a.ts', 'src', 'lib')).toBe('src-old/a.ts')
})
test('entry names cannot traverse or rename into another directory', () => {
  for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b'])
    expect(validEntryName(name)).toBe(false)
  expect(validEntryName('hello world.ts')).toBe(true)
})

test('rename preserves punctuation and file extensions and does not remap similar file names', () => {
  expect(remapTreePath('src/file.ts', 'src/file.ts', 'src/new name.ts')).toBe('src/new name.ts')
  expect(remapTreePath('src/file.tsx', 'src/file.ts', 'src/new.ts')).toBe('src/file.tsx')
  for (const name of ['a\nb', 'a\rb', 'a\tb']) expect(validEntryName(name)).toBe(false)
})
