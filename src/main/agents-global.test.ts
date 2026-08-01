import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  globalAgentsFile,
  readGlobalAgents,
  removeGlobalAgent,
  saveGlobalAgent,
} from './agents-global'

// Every test in this file writes ONLY to a fresh mkdtemp dir. The registry
// resolves its path per call through configPath(), so the real
// ~/.config/TerMinal/agents/global.json is never touched. src/test-preload.ts
// already redirects the whole suite; this narrows it further per-file.
let dir = ''
const realDir = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-global-agents-'))
  process.env.TERMINAL_CONFIG_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
})

const saved = () => JSON.parse(readFileSync(join(dir, 'agents', 'global.json'), 'utf8'))

describe('globalAgentsFile', () => {
  test('resolves under the injected dir, never the real config dir', () => {
    expect(globalAgentsFile()).toBe(join(dir, 'agents', 'global.json'))
    expect(globalAgentsFile()).not.toContain('/.config/TerMinal/')
  })
})

describe('saveGlobalAgent', () => {
  test('persists modelPolicy, quality, and the other fields it used to drop', () => {
    const res = saveGlobalAgent({
      id: 'nightly-audit',
      title: 'Nightly audit',
      prompt: 'audit the repo',
      model: 'haiku',
      modelPolicy: { mode: 'fixed', model: 'haiku' } as never,
      quality: { deterministicChecks: [{ id: 'tc', title: 'typecheck', command: 'tsc' }] },
      outputContract: 'a markdown report',
      acceptanceCriteria: ['no findings missed'],
      force: true,
    })
    expect(res).toEqual({ ok: true })

    const [a] = saved()
    expect(a.modelPolicy).toEqual({ mode: 'fixed', model: 'haiku' })
    expect(a.quality).toEqual({
      deterministicChecks: [{ id: 'tc', title: 'typecheck', command: 'tsc' }],
    })
    expect(a.model).toBe('haiku')
    expect(a.outputContract).toBe('a markdown report')
    expect(a.acceptanceCriteria).toEqual(['no findings missed'])
    expect(a.force).toBe(true)
  })

  test('re-saving without a field clears it rather than resurrecting stale data', () => {
    saveGlobalAgent({
      id: 'a',
      title: 'A',
      prompt: 'p',
      quality: { deterministicChecks: [] },
      force: true,
    })
    saveGlobalAgent({ id: 'a', title: 'A', prompt: 'p' })
    const [a] = saved()
    expect(a.quality).toBeUndefined()
    expect(a.force).toBeUndefined()
    expect(saved()).toHaveLength(1)
  })

  test('does not persist computed provenance/hasScript fields', () => {
    saveGlobalAgent({
      id: 'a',
      title: 'A',
      prompt: 'p',
      source: 'repo',
      hasScript: true,
    })
    const [a] = saved()
    expect(a.source).toBeUndefined()
    expect(a.hasScript).toBeUndefined()
  })

  test('trims and round-trips through readGlobalAgents', () => {
    saveGlobalAgent({ id: 'a', title: '  A  ', prompt: '  do it  ', description: '  d  ' })
    const [a] = readGlobalAgents()
    expect(a).toMatchObject({ id: 'a', title: 'A', prompt: 'do it', description: 'd' })
  })

  test('rejects invalid ids and missing required fields', () => {
    expect(saveGlobalAgent({ id: 'Bad Id', title: 't', prompt: 'p' })).toHaveProperty('error')
    expect(saveGlobalAgent({ id: 'ok', title: '  ', prompt: 'p' })).toHaveProperty('error')
    expect(saveGlobalAgent({ id: 'ok', title: 't', prompt: '' })).toHaveProperty('error')
    expect(readGlobalAgents()).toEqual([])
  })
})

describe('removeGlobalAgent', () => {
  test('removes a known agent and reports false for an unknown one', () => {
    saveGlobalAgent({ id: 'a', title: 'A', prompt: 'p' })
    expect(removeGlobalAgent('nope')).toBe(false)
    expect(removeGlobalAgent('a')).toBe(true)
    expect(readGlobalAgents()).toEqual([])
  })
})
