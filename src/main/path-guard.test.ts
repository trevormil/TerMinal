import { describe, expect, test } from 'bun:test'
import { resolveWithin, resolveWithinAny } from './path-guard'

describe('resolveWithin', () => {
  test('accepts a file inside the root', () => {
    expect(resolveWithin('/tmp/repo', 'src/index.ts')).toBe('/tmp/repo/src/index.ts')
  })

  test('accepts the root itself', () => {
    expect(resolveWithin('/tmp/repo', '.')).toBe('/tmp/repo')
    expect(resolveWithin('/tmp/repo', '')).toBe('/tmp/repo')
  })

  // The bug this exists for: `abs.startsWith(root)` is a STRING test, not a
  // path-boundary test. `/tmp/repo-private/x` starts with `/tmp/repo` and would
  // sail through, so a renderer could reveal a sibling directory it must not see.
  test('rejects a sibling directory that merely shares the root prefix', () => {
    expect(resolveWithin('/tmp/repo', '../repo-private/secrets.env')).toBeNull()
    expect(resolveWithin('/tmp/repo', '../repo.bak/id_rsa')).toBeNull()
  })

  test('rejects ordinary traversal out of the root', () => {
    expect(resolveWithin('/tmp/repo', '../../etc/passwd')).toBeNull()
    expect(resolveWithin('/tmp/repo', 'src/../../../etc/passwd')).toBeNull()
  })

  test('rejects an absolute path that escapes the root', () => {
    expect(resolveWithin('/tmp/repo', '/etc/passwd')).toBeNull()
  })

  test('normalises a traversal that stays inside', () => {
    expect(resolveWithin('/tmp/repo', 'src/../src/index.ts')).toBe('/tmp/repo/src/index.ts')
  })

  test('a trailing slash on the root does not change the boundary', () => {
    expect(resolveWithin('/tmp/repo/', '../repo-private/x')).toBeNull()
    expect(resolveWithin('/tmp/repo/', 'src/a.ts')).toBe('/tmp/repo/src/a.ts')
  })

  test('refuses a missing or non-string root or path', () => {
    expect(resolveWithin('', 'a.ts')).toBeNull()
    expect(resolveWithin('/tmp/repo', null as unknown as string)).toBeNull()
    expect(resolveWithin(null as unknown as string, 'a.ts')).toBeNull()
  })
})

describe('resolveWithinAny', () => {
  const roots = ['/Users/me/Projects', '/Users/me/.config/TerMinal', '']

  test('accepts an absolute path inside any listed root', () => {
    expect(resolveWithinAny(roots, '/Users/me/Projects/app/src/x.ts')).toBe(
      '/Users/me/Projects/app/src/x.ts',
    )
    expect(resolveWithinAny(roots, '/Users/me/.config/TerMinal/agents/a.sh')).toBe(
      '/Users/me/.config/TerMinal/agents/a.sh',
    )
  })

  test('accepts a root itself', () => {
    expect(resolveWithinAny(roots, '/Users/me/Projects')).toBe('/Users/me/Projects')
  })

  test('rejects a path outside every root', () => {
    expect(resolveWithinAny(roots, '/Users/me/.ssh/id_rsa')).toBeNull()
    expect(resolveWithinAny(roots, '/etc/passwd')).toBeNull()
  })

  // Same string-prefix trap as resolveWithin, and the reason an empty root must
  // not silently mean "/" — that would allow every path above.
  test('rejects a sibling that merely shares a root prefix, and ignores empty roots', () => {
    expect(resolveWithinAny(roots, '/Users/me/Projects-private/secrets.env')).toBeNull()
    expect(resolveWithinAny(['', undefined, null], '/etc/passwd')).toBeNull()
  })

  test('normalises traversal before deciding', () => {
    expect(resolveWithinAny(roots, '/Users/me/Projects/../.ssh/id_rsa')).toBeNull()
    expect(resolveWithinAny(roots, '/Users/me/Projects/app/../app/x.ts')).toBe(
      '/Users/me/Projects/app/x.ts',
    )
  })

  test('refuses relative and non-string input', () => {
    expect(resolveWithinAny(roots, 'app/src/x.ts')).toBeNull()
    expect(resolveWithinAny(roots, null as unknown as string)).toBeNull()
  })
})
