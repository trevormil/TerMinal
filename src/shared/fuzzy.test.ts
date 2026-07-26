import { describe, expect, test } from 'bun:test'
import { extractFileRefs, fuzzyRank, fuzzyScore, parseQuickOpen } from './fuzzy'

const best = (needle: string, cands: string[]) =>
  fuzzyRank(needle, cands, (c) => c, { limit: 1 })[0]?.item

describe('fuzzyScore', () => {
  test('requires an in-order subsequence', () => {
    expect(fuzzyScore('abc', 'a-b-c')).not.toBeNull()
    expect(fuzzyScore('cba', 'a-b-c')).toBeNull()
    expect(fuzzyScore('abcd', 'abc')).toBeNull()
  })
  test('an empty needle matches everything with no positions', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, positions: [] })
  })
  test('reports the matched positions for highlighting', () => {
    expect(fuzzyScore('ac', 'abc')?.positions).toEqual([0, 2])
  })
  test('consecutive runs beat scattered matches', () => {
    const tight = fuzzyScore('index', 'index.ts')!.score
    const loose = fuzzyScore('index', 'i-n-d-e-x.ts')!.score
    expect(tight).toBeGreaterThan(loose)
  })
})

describe('fuzzyRank — the ordering that makes quick-open usable', () => {
  test('exact basename wins over a deep path that merely contains the chars', () => {
    expect(best('index', ['src/i/n/d/e/x-other.ts', 'src/renderer/index.ts'])).toBe(
      'src/renderer/index.ts',
    )
  })
  test('basename match beats a directory-only match', () => {
    expect(best('engines', ['src/engines/other-thing.ts', 'src/shared/engines.ts'])).toBe(
      'src/shared/engines.ts',
    )
  })
  test('camelCase humps and path boundaries are matchable initials', () => {
    expect(best('fv', ['src/foo/value.ts', 'src/components/FileViewer.tsx'])).toBeDefined()
    expect(fuzzyScore('fv', 'FileViewer.tsx')).not.toBeNull()
  })
  test('non-matches are dropped entirely', () => {
    expect(fuzzyRank('zzz', ['index.ts', 'main.ts'], (c) => c)).toHaveLength(0)
  })
  test('limit caps the result set', () => {
    const many = Array.from({ length: 200 }, (_, i) => `file${i}.ts`)
    expect(fuzzyRank('file', many, (c) => c, { limit: 10 })).toHaveLength(10)
  })
  test('deprioritized items still appear, but below everything else', () => {
    const items = ['dist/index.ts', 'src/index.ts']
    const ranked = fuzzyRank('index', items, (c) => c, {
      deprioritize: (c) => c.startsWith('dist/'),
    })
    // Both reachable (build output stays findable) …
    expect(ranked).toHaveLength(2)
    // … but the ignored one is last.
    expect(ranked[0].item).toBe('src/index.ts')
    expect(ranked[1].item).toBe('dist/index.ts')
  })
})

describe('parseQuickOpen', () => {
  test('recognises every mode prefix', () => {
    expect(parseQuickOpen('foo')).toEqual({ mode: 'files', term: 'foo' })
    expect(parseQuickOpen('>reload')).toEqual({ mode: 'commands', term: 'reload' })
    expect(parseQuickOpen('@handler')).toEqual({ mode: 'symbols', term: 'handler' })
    expect(parseQuickOpen('#todo')).toEqual({ mode: 'search', term: 'todo' })
  })
  test(':N parses the line number', () => {
    expect(parseQuickOpen(':42')).toEqual({ mode: 'line', term: '42', line: 42 })
    expect(parseQuickOpen(':').line).toBeUndefined()
  })
  test('leading whitespace does not defeat the prefix', () => {
    expect(parseQuickOpen('  >cmd').mode).toBe('commands')
  })
})

describe('extractFileRefs — clickable path:line from agent output', () => {
  test('pulls path, line, and column', () => {
    expect(extractFileRefs('see src/main/index.ts:412:7 for the handler')).toEqual([
      { path: 'src/main/index.ts', line: 412, column: 7 },
    ])
  })
  test('path without a line still resolves', () => {
    expect(extractFileRefs('edited src/shared/engines.ts')[0]).toEqual({
      path: 'src/shared/engines.ts',
      line: undefined,
      column: undefined,
    })
  })
  test('deduplicates repeats', () => {
    expect(extractFileRefs('a.ts:1 and a.ts:1 again')).toHaveLength(1)
  })
  test('ignores URLs and version-like tokens', () => {
    expect(extractFileRefs('see https://example.com/a/b.ts:4')).toEqual([])
    expect(extractFileRefs('bumped to 1.2 today')).toEqual([])
  })
  test('finds several refs in one blob', () => {
    const refs = extractFileRefs('touched src/a.ts:10 and lib/b/c.tsx:22:3')
    expect(refs.map((r) => r.path)).toEqual(['src/a.ts', 'lib/b/c.tsx'])
    expect(refs[1]).toEqual({ path: 'lib/b/c.tsx', line: 22, column: 3 })
  })
})
