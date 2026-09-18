import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { searchFileSymbols } from './file-symbol-search'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'symbol-search-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content)
  execFileSync('git', ['-C', root, 'add', '.'])
  return root
}
test('finds exact declarations across tracked files, omitting uses and untracked files', async () => {
  const root = repo({
    'a.ts': 'export const target = 1',
    'b.py': 'def target():',
    'c.ts': 'target()',
  })
  writeFileSync(join(root, 'untracked.ts'), 'const target = 2')
  const result = await searchFileSymbols(root, 'target')
  expect(result.hits.map((h) => [h.path, h.line])).toEqual([
    ['a.ts', 1],
    ['b.py', 1],
  ])
  expect(result.truncated).toBe(false)
  expect((await searchFileSymbols(root, 'missing')).hits).toEqual([])
  expect((await searchFileSymbols(root, '')).error).toContain('identifier')
  expect((await searchFileSymbols('', 'target')).error).toContain('local')
  expect((await searchFileSymbols(repo({}), 'target')).hits).toEqual([])
})
test('reports file, byte, hit and time bounds without scanning indefinitely', async () => {
  const root = repo({ 'a.ts': 'const target = 1', 'b.ts': 'const target = 2' })
  for (const limits of [{ files: 1 }, { bytes: 1 }, { hits: 1 }, { scanMs: 0 }, { fileBytes: 1 }]) {
    expect((await searchFileSymbols(root, 'target', limits)).truncated).toBe(true)
  }
})
test('skips symlinks and binary files', async () => {
  const root = repo({ 'binary.ts': 'const target = 1\0' })
  const outside = repo({ 'secret.ts': 'const target = 2' })
  symlinkSync(join(outside, 'secret.ts'), join(root, 'link.ts'))
  execFileSync('git', ['-C', root, 'add', '.'])
  const result = await searchFileSymbols(root, 'target')
  expect(result.hits).toEqual([])
  expect(result.skipped).toBe(2)
})
