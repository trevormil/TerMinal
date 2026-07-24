import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCheckStale, listChecks, parseCheckStatus } from './checks'

const rec = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'fleet-health',
    scope: 'global',
    repoLabel: '',
    status: 'ok',
    summary: 'all green',
    updatedAt: 1000,
    since: 500,
    lastTransition: null,
    history: [{ at: 1000, status: 'ok' }],
    ...over,
  })

describe('parseCheckStatus', () => {
  test('round-trips a valid record', () => {
    const c = parseCheckStatus(rec())!
    expect(c.kind).toBe('fleet-health')
    expect(c.status).toBe('ok')
    expect(c.summary).toBe('all green')
  })

  test('rejects garbage, bad status, and missing kind', () => {
    expect(parseCheckStatus('not json')).toBeNull()
    expect(parseCheckStatus(rec({ status: 'meh' }))).toBeNull()
    expect(parseCheckStatus(rec({ kind: '' }))).toBeNull()
  })
})

describe('listChecks', () => {
  test('sorts worst-first, then most recent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checks-'))
    writeFileSync(join(dir, 'a--ok.json'), rec({ kind: 'a', status: 'ok', updatedAt: 9 }))
    writeFileSync(join(dir, 'b--fail.json'), rec({ kind: 'b', status: 'fail', updatedAt: 1 }))
    writeFileSync(join(dir, 'c--warn.json'), rec({ kind: 'c', status: 'warn', updatedAt: 5 }))
    writeFileSync(join(dir, 'junk.json'), 'nope')
    expect(listChecks(dir).map((c) => c.kind)).toEqual(['b', 'c', 'a'])
  })

  test('missing dir is empty, not an error', () => {
    expect(listChecks('/nonexistent/checks-dir')).toEqual([])
  })
})

describe('isCheckStale', () => {
  test('older than the stale window flips stale', () => {
    const c = parseCheckStatus(rec({ updatedAt: 0 }))!
    expect(isCheckStale(c, 1000)).toBe(false)
    expect(isCheckStale(c, 3 * 60 * 60 * 1000)).toBe(true)
  })
})
