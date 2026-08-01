import { describe, expect, test } from 'bun:test'
import { queryAcceptsFilter, sessionFilterPredicates, whereClause } from './observability-index'

describe('sessionFilterPredicates', () => {
  test('an absent or empty filter narrows nothing', () => {
    expect(sessionFilterPredicates(undefined)).toEqual([])
    expect(sessionFilterPredicates({})).toEqual([])
  })

  test('date bounds are inclusive and applied against sessions.mtime', () => {
    expect(sessionFilterPredicates({ since: 100, until: 200 })).toEqual([
      'sessions.mtime >= 100',
      'sessions.mtime <= 200',
    ])
  })

  test('a zero timestamp is a real bound, not a missing one', () => {
    expect(sessionFilterPredicates({ since: 0 })).toEqual(['sessions.mtime >= 0'])
  })

  test('NaN bounds are dropped rather than emitted as invalid SQL', () => {
    expect(sessionFilterPredicates({ since: Number.NaN, until: Number.NaN })).toEqual([])
  })

  test('string filters are quoted and escaped', () => {
    expect(sessionFilterPredicates({ repo: "/tmp/o'brien" })).toEqual([
      "sessions.repo = '/tmp/o''brien'",
    ])
  })

  test('all axes compose', () => {
    expect(
      sessionFilterPredicates({ since: 1, until: 2, repo: '/r', engine: 'codex', model: 'gpt-5' }),
    ).toEqual([
      'sessions.mtime >= 1',
      'sessions.mtime <= 2',
      "sessions.repo = '/r'",
      "sessions.engine = 'codex'",
      "sessions.model = 'gpt-5'",
    ])
  })

  test('honours the alias so joined queries can qualify their columns', () => {
    expect(sessionFilterPredicates({ repo: '/r' }, 's')).toEqual(["s.repo = '/r'"])
  })
})

describe('whereClause', () => {
  test('emits nothing when there is nothing to filter', () => {
    expect(whereClause([], [])).toBe('')
  })

  test("preserves a query's own predicate when a filter is added", () => {
    expect(whereClause(['sessions.input_tokens > 0'], ["sessions.repo = '/r'"])).toBe(
      "WHERE sessions.input_tokens > 0 AND sessions.repo = '/r'",
    )
  })

  test('a filter alone still produces a valid clause', () => {
    expect(whereClause([], ["sessions.repo = '/r'"])).toBe("WHERE sessions.repo = '/r'")
  })
})

describe('queryAcceptsFilter', () => {
  test('session-scoped and synthesized queries opt out', () => {
    expect(queryAcceptsFilter('session_events')).toBe(false)
    expect(queryAcceptsFilter('audit')).toBe(false)
  })

  test('every other canned query accepts the toolbar filter', () => {
    expect(queryAcceptsFilter('sessions_by_tokens')).toBe(true)
    expect(queryAcceptsFilter('tool_call_bloat')).toBe(true)
    expect(queryAcceptsFilter('repo_rollup')).toBe(true)
  })
})
