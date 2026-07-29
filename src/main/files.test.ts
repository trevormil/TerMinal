import { test, expect, describe } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { writeFile, createEntry, renameEntry, removeEntry } from './files'

// The safe(root, rel) guard is the sole thing keeping the Files tab's
// write/create/rename/delete inside the attached repo root. These exercise it
// through the real production functions (IPC → these) with escaping paths.
describe('files traversal guard', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-files-')))
  const outsideDir = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-outside-')))
  const sentinel = join(outsideDir, 'sentinel.txt')
  writeFileSync(sentinel, 'do not touch')

  test('writeFile refuses to escape the root', () => {
    expect(writeFile(root, '../../etc/hosts', 'x')).toBe(false)
    expect(writeFile(root, `../${'terminal-outside-'}../x`, 'x')).toBe(false)
    // an in-tree write still works
    expect(writeFile(root, 'ok.txt', 'hi')).toBe(true)
    expect(existsSync(join(root, 'ok.txt'))).toBe(true)
  })

  test('createEntry refuses to escape the root', () => {
    expect(createEntry(root, '../escaped', false)).toBe(false)
    expect(createEntry(root, 'sub/nested.txt', false)).toBe(true)
  })

  test('renameEntry refuses to escape the root on either side', () => {
    writeFileSync(join(root, 'src.txt'), 'x')
    expect(renameEntry(root, 'src.txt', '../escaped.txt')).toBe(false)
    expect(renameEntry(root, '../../whatever', 'dst.txt')).toBe(false)
    expect(existsSync(join(root, 'src.txt'))).toBe(true) // untouched
  })

  test('removeEntry refuses traversal AND refuses to delete the root itself', () => {
    expect(removeEntry(root, '../../tmp')).toBe(false)
    expect(removeEntry(root, '.')).toBe(false) // root self-delete guard
    expect(existsSync(root)).toBe(true)
  })

  test('nothing outside the root was created or deleted', () => {
    expect(existsSync(sentinel)).toBe(true)
    rmSync(root, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  })
})

describe('replaceInFiles', () => {
  const setup = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-replace-')))
    writeFileSync(join(root, 'a.txt'), 'foo one\nbar\nfoo two foo\n')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.txt'), 'nothing\nFoo here\n')
    return root
  }

  test('replaces only the targeted lines and counts occurrences', async () => {
    const root = setup()
    const { replaceInFiles } = await import('./files')
    const r = await replaceInFiles(root, 'foo', 'qux', [
      { file: 'a.txt', line: 1 },
      { file: 'a.txt', line: 3 },
      { file: 'sub/b.txt', line: 2 },
    ])
    expect(r).toEqual({ files: 2, replaced: 4, skipped: 0 })
    const { readFile } = await import('./files')
    expect(readFile(root, 'a.txt').content).toBe('qux one\nbar\nqux two qux\n')
    // case-insensitive, matching search semantics
    expect(readFile(root, 'sub/b.txt').content).toBe('nothing\nqux here\n')
    rmSync(root, { recursive: true, force: true })
  })

  test('skips a line that no longer contains the query (stale search result)', async () => {
    const root = setup()
    const { replaceInFiles, readFile } = await import('./files')
    const r = await replaceInFiles(root, 'foo', 'qux', [{ file: 'a.txt', line: 2 }])
    expect(r).toEqual({ files: 0, replaced: 0, skipped: 1 })
    expect(readFile(root, 'a.txt').content).toBe('foo one\nbar\nfoo two foo\n')
    rmSync(root, { recursive: true, force: true })
  })

  test('refuses traversal paths in targets', async () => {
    const root = setup()
    const { replaceInFiles } = await import('./files')
    const r = await replaceInFiles(root, 'foo', 'qux', [{ file: '../outside.txt', line: 1 }])
    expect(r).toEqual({ files: 0, replaced: 0, skipped: 1 })
    rmSync(root, { recursive: true, force: true })
  })
})

describe('searchRepo', () => {
  const setup = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-search-')))
    execFileSync('git', ['-C', root, 'init', '-q'])
    writeFileSync(join(root, 'a.ts'), 'const foo123 = 1\nconst BAR = foo123\n')
    writeFileSync(join(root, 'a.test.ts'), 'const foo123 = 2 // test file\n')
    execFileSync('git', ['-C', root, 'add', '-A'])
    return root
  }

  test('defaults are literal and case-insensitive', async () => {
    const root = setup()
    const { searchRepo } = await import('./files')
    const hits = await searchRepo(root, 'bar')
    expect(hits).toEqual([{ file: 'a.ts', line: 2, text: 'const BAR = foo123' }])
    rmSync(root, { recursive: true, force: true })
  })

  test('caseSensitive: true stops matching a different case', async () => {
    const root = setup()
    const { searchRepo } = await import('./files')
    expect(await searchRepo(root, 'bar', { caseSensitive: true })).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })

  test('regex: true treats the query as a pattern', async () => {
    const root = setup()
    const { searchRepo } = await import('./files')
    const hits = await searchRepo(root, 'foo[0-9]+', { regex: true })
    expect(hits.map((h) => h.file).sort()).toEqual(['a.test.ts', 'a.ts', 'a.ts'])
    rmSync(root, { recursive: true, force: true })
  })

  test('exclude glob filters out matching files', async () => {
    const root = setup()
    const { searchRepo } = await import('./files')
    const hits = await searchRepo(root, 'foo123', { exclude: '*.test.ts' })
    expect(hits.map((h) => h.file)).toEqual(['a.ts', 'a.ts'])
    rmSync(root, { recursive: true, force: true })
  })

  test('include glob narrows to matching files only', async () => {
    const root = setup()
    const { searchRepo } = await import('./files')
    const hits = await searchRepo(root, 'foo123', { include: '*.test.ts' })
    expect(hits.map((h) => h.file)).toEqual(['a.test.ts'])
    rmSync(root, { recursive: true, force: true })
  })
})

describe('formatFile', () => {
  test('formats through the project-local prettier, honoring its config', async () => {
    const { formatFile } = await import('./files')
    // This repo's own root has node_modules/.bin/prettier + .prettierrc.
    const repo = process.cwd()
    const r = await formatFile(repo, 'virtual-format-target.ts', 'const a=1;')
    expect(r.ok).toBe(true)
    expect(r.content).toBe('const a = 1\n')
  })

  test("skips files prettier doesn't own (no parser for the extension)", async () => {
    const { formatFile } = await import('./files')
    const r = await formatFile(process.cwd(), 'x.zzz-not-a-language', 'whatever')
    expect(r.ok).toBe(false)
  })

  test('skips entirely when the project has no prettier install', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-fmt-')))
    const { formatFile } = await import('./files')
    const r = await formatFile(root, 'x.ts', 'const a=1')
    expect(r.ok).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('reports a syntax error instead of mangling the file', async () => {
    const { formatFile } = await import('./files')
    const r = await formatFile(process.cwd(), 'broken.ts', 'const const const')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('isValidSessionId (data.ts) rejects path traversal', () => {
  test('accepts uuid-like ids, rejects separators and ..', async () => {
    const { isValidSessionId } = await import('./data')
    expect(isValidSessionId('4b1c2d3e-0000-1111-2222-333344445555')).toBe(true)
    expect(isValidSessionId('../../../etc/passwd')).toBe(false)
    expect(isValidSessionId('a/b')).toBe(false)
    expect(isValidSessionId('a\\b')).toBe(false)
    expect(isValidSessionId('..')).toBe(false)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId(undefined)).toBe(false)
  })
})
