import { expect, test } from 'bun:test'
import { normalizeKnowledgePath } from './knowledge-path'

test('path scopes normalize spelling without colliding with siblings', () => {
  expect(normalizeKnowledgePath('./src//lib/')).toBe('src/lib')
  expect(normalizeKnowledgePath('src/file name.ts')).toBe('src/file name.ts')
  expect(normalizeKnowledgePath('src-old')).not.toBe(normalizeKnowledgePath('src'))
})
test('path scopes reject root, traversal and absolute paths', () => {
  for (const path of ['', '.', '/', '../src', 'src/../lib', '/tmp/repo', 'C:\\src', 'src\0x'])
    expect(normalizeKnowledgePath(path)).toBeNull()
})
