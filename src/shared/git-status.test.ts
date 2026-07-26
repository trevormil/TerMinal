import { describe, expect, test } from 'bun:test'
import { fileStatuses, parsePorcelain, rollUpDirs, statusBadge } from './git-status'

describe('parsePorcelain', () => {
  test('parses the common status codes', () => {
    const out = parsePorcelain(
      [
        ' M src/main/index.ts',
        'A  src/new.ts',
        ' D src/gone.ts',
        '?? scratch.txt',
        'M  src/staged.ts',
      ].join('\n'),
    )
    expect(out).toEqual({
      'src/main/index.ts': 'modified',
      'src/new.ts': 'added',
      'src/gone.ts': 'deleted',
      'scratch.txt': 'untracked',
      'src/staged.ts': 'modified',
    })
  })

  test('a rename reports the NEW path (what is on disk)', () => {
    expect(parsePorcelain('R  src/old.ts -> src/new.ts')).toEqual({ 'src/new.ts': 'renamed' })
  })

  test('unmerged states are conflicts, not plain modifications', () => {
    expect(parsePorcelain('UU src/conflict.ts')['src/conflict.ts']).toBe('conflicted')
    expect(parsePorcelain('AA src/both-added.ts')['src/both-added.ts']).toBe('conflicted')
    expect(parsePorcelain('DD src/both-deleted.ts')['src/both-deleted.ts']).toBe('conflicted')
  })

  test('quoted paths (special characters) are unquoted', () => {
    expect(parsePorcelain(' M "src/a b\\"c.ts"')).toEqual({ 'src/a b"c.ts': 'modified' })
  })

  test('blank and malformed lines are ignored', () => {
    expect(parsePorcelain('\n\nxx\n M ok.ts')).toEqual({ 'ok.ts': 'modified' })
  })

  test('the index status wins when both index and worktree are set', () => {
    // Added to the index, then modified in the worktree → still "added".
    expect(parsePorcelain('AM src/x.ts')['src/x.ts']).toBe('added')
  })
})

describe('rollUpDirs — a collapsed folder must still show change', () => {
  test('marks every ancestor directory', () => {
    const out = rollUpDirs({ 'src/main/bridge/server.ts': 'modified' })
    expect(out['src']).toBe('modified')
    expect(out['src/main']).toBe('modified')
    expect(out['src/main/bridge']).toBe('modified')
    expect(out['src/main/bridge/server.ts']).toBe('modified')
  })

  test('the most urgent descendant status wins for a folder', () => {
    const out = rollUpDirs({ 'src/a.ts': 'modified', 'src/b.ts': 'conflicted' })
    expect(out['src']).toBe('conflicted')
  })

  test('a top-level file creates no phantom directory entry', () => {
    expect(rollUpDirs({ 'README.md': 'modified' })).toEqual({ 'README.md': 'modified' })
  })

  test('does not clobber an explicit status on the directory itself', () => {
    const out = rollUpDirs({ src: 'untracked', 'src/a.ts': 'conflicted' })
    expect(out['src']).toBe('conflicted') // higher rank wins
  })
})

describe('fileStatuses', () => {
  test('parses and rolls up in one pass', () => {
    const out = fileStatuses(' M deep/nested/file.ts')
    expect(out['deep']).toBe('modified')
    expect(out['deep/nested/file.ts']).toBe('modified')
  })
})

describe('statusBadge', () => {
  test('one letter per status', () => {
    expect(statusBadge('modified')).toBe('M')
    expect(statusBadge('added')).toBe('A')
    expect(statusBadge('deleted')).toBe('D')
    expect(statusBadge('untracked')).toBe('U')
    expect(statusBadge('conflicted')).toBe('!')
  })
})
