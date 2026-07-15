import { describe, expect, test } from 'bun:test'
import type { SessionMeta } from './types'
import { filterSessionMetas, sessionMatchesQuery } from './sessionSearch'

const session = (patch: Partial<SessionMeta>): SessionMeta => ({
  id: 'abc123',
  engine: 'claude',
  cwd: '/repo/app',
  gitBranch: '',
  model: 'sonnet',
  turns: 1,
  firstUserText: 'Ship invoices',
  mtime: 100,
  ...patch,
})

describe('sessionMatchesQuery', () => {
  test('matches prompt, path, branch, engine, model, and id case-insensitively', () => {
    const s = session({
      gitBranch: 'feature/Billing',
      model: 'gpt-5.1',
      engine: 'codex',
      id: 'xyz789',
    })
    expect(sessionMatchesQuery(s, 'invoices')).toBe(true)
    expect(sessionMatchesQuery(s, 'REPO/APP')).toBe(true)
    expect(sessionMatchesQuery(s, 'billing')).toBe(true)
    expect(sessionMatchesQuery(s, 'CODEX')).toBe(true)
    expect(sessionMatchesQuery(s, 'gpt-5')).toBe(true)
    expect(sessionMatchesQuery(s, 'xyz')).toBe(true)
  })

  test('empty query matches and unrelated query does not', () => {
    const s = session({})
    expect(sessionMatchesQuery(s, '')).toBe(true)
    expect(sessionMatchesQuery(s, 'not-present')).toBe(false)
  })
})

describe('filterSessionMetas', () => {
  test('combines folder scope with search query', () => {
    const sessions = [
      session({ id: '1', cwd: '/repo/app', gitBranch: 'main', firstUserText: 'Refactor toolbar' }),
      session({ id: '2', cwd: '/repo/api', firstUserText: 'Ship invoices' }),
      session({ id: '3', cwd: '/other/app', firstUserText: 'Ship invoices' }),
    ]

    expect(
      filterSessionMetas(sessions, { filterDir: '/repo', query: 'invoices' }).map((s) => s.id),
    ).toEqual(['2'])
  })

  test('leaves pagination to the caller', () => {
    const sessions = Array.from({ length: 75 }, (_, i) =>
      session({ id: String(i), firstUserText: 'match' }),
    )
    expect(filterSessionMetas(sessions, { query: 'match' })).toHaveLength(75)
  })
})
