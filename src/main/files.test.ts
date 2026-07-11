import { test, expect, describe } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
