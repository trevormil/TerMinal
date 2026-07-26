import { describe, expect, test } from 'bun:test'
import {
  coerceSessionEngine,
  ENGINE_IDS,
  ENGINES,
  engineAllowsCustomModelOf,
  engineLabelOf,
  engineSupportsSeed,
  isEngineId,
  isSessionEngineId,
  modelArgs,
  resumeArgs,
  seedArgs,
  SESSION_ENGINE_IDS,
} from './engines'

describe('registry shape', () => {
  test('every descriptor is internally consistent', () => {
    for (const id of ENGINE_IDS) {
      const e = ENGINES[id]
      expect(e.id).toBe(id) // id key and field agree
      expect(e.label.length).toBeGreaterThan(0)
      expect(e.vendor.length).toBeGreaterThan(0)
      expect(e.bin.name.length).toBeGreaterThan(0)
      // An engine with a fixed model menu must not also claim free-text, and
      // one with no menu must (else its model can never be chosen).
      if (e.models.length === 0) expect(e.allowsCustomModel).toBe(true)
    }
  })

  test('local is a session engine but NOT a coding agent', () => {
    expect(isEngineId('local')).toBe(false)
    expect(isSessionEngineId('local')).toBe(true)
    expect(SESSION_ENGINE_IDS).toContain('local')
    expect(ENGINE_IDS).not.toContain('local' as never)
  })

  test('opencode is registered', () => {
    expect(isEngineId('opencode')).toBe(true)
    expect(ENGINES.opencode.bin.name).toBe('opencode')
    // Installs outside a login shell's PATH — must declare a candidate path.
    expect(ENGINES.opencode.bin.candidates?.[0]).toContain('.opencode')
  })
})

describe('labels', () => {
  test('every engine has a non-lowercase-id label; local included', () => {
    expect(engineLabelOf('claude')).toBe('Claude')
    expect(engineLabelOf('openai-compat')).toBe('Self-hosted')
    expect(engineLabelOf('local')).toBe('Local')
  })
  test('an unknown id echoes rather than rendering blank', () => {
    expect(engineLabelOf('whatever')).toBe('whatever')
  })
})

describe('seedArgs — the launch-seed contract per CLI', () => {
  test('positional engines take the prompt as one argument', () => {
    for (const id of ['claude', 'codex', 'cursor'])
      expect(seedArgs(id, 'do the thing')).toEqual(['do the thing'])
  })
  test('hermes takes -z, opencode takes --prompt', () => {
    expect(seedArgs('hermes', 'p')).toEqual(['-z', 'p'])
    expect(seedArgs('opencode', 'p')).toEqual(['--prompt', 'p'])
  })
  test('a multi-line prompt stays ONE argument (never split)', () => {
    const p = 'line one\nline two\n\nline three'
    expect(seedArgs('claude', p)).toEqual([p])
    expect(seedArgs('opencode', p)).toEqual(['--prompt', p])
  })
  test('empty prompt or unknown engine yields nothing', () => {
    expect(seedArgs('claude', '')).toEqual([])
    expect(seedArgs('local', 'p')).toEqual([])
    expect(seedArgs('nope', 'p')).toEqual([])
  })
  test('every registered engine can be seeded', () => {
    for (const id of ENGINE_IDS) expect(engineSupportsSeed(id)).toBe(true)
    expect(engineSupportsSeed('local')).toBe(false)
  })
})

describe('resumeArgs', () => {
  test('per-engine resume shapes', () => {
    expect(resumeArgs('claude', 'abc')).toEqual(['--resume', 'abc'])
    expect(resumeArgs('cursor', 'abc')).toEqual(['--resume', 'abc'])
    expect(resumeArgs('codex', 'abc')).toEqual(['resume', 'abc']) // subcommand
    expect(resumeArgs('opencode', 'abc')).toEqual(['-s', 'abc'])
  })
  test('engines without a resume story yield nothing', () => {
    expect(resumeArgs('openrouter', 'abc')).toEqual([])
    expect(resumeArgs('claude', '')).toEqual([])
  })
  test('resume args are consistent with the resumable capability', () => {
    for (const id of ENGINE_IDS) {
      const hasArgs = resumeArgs(id, 'x').length > 0
      expect(hasArgs).toBe(ENGINES[id].caps.resumable)
    }
  })
})

describe('modelArgs', () => {
  test('--model vs -m per engine', () => {
    expect(modelArgs('claude', 'opus')).toEqual(['--model', 'opus'])
    expect(modelArgs('codex', 'gpt-5')).toEqual(['--model', 'gpt-5'])
    expect(modelArgs('hermes', 'x/y')).toEqual(['-m', 'x/y'])
    expect(modelArgs('opencode', 'anthropic/claude')).toEqual(['-m', 'anthropic/claude'])
  })
  test('no model → no args', () => {
    expect(modelArgs('claude', '')).toEqual([])
  })
})

describe('coerceSessionEngine', () => {
  test('passes through valid ids incl. local, else falls back', () => {
    expect(coerceSessionEngine('codex')).toBe('codex')
    expect(coerceSessionEngine('opencode')).toBe('opencode')
    expect(coerceSessionEngine('local')).toBe('local')
    expect(coerceSessionEngine('bogus')).toBe('claude')
    expect(coerceSessionEngine(undefined, 'codex')).toBe('codex')
  })
})

describe('custom-model capability', () => {
  test('free-text engines are exactly the ones without a fixed menu', () => {
    expect(engineAllowsCustomModelOf('openrouter')).toBe(true)
    expect(engineAllowsCustomModelOf('hermes')).toBe(true)
    expect(engineAllowsCustomModelOf('openai-compat')).toBe(true)
    expect(engineAllowsCustomModelOf('opencode')).toBe(true)
    expect(engineAllowsCustomModelOf('claude')).toBe(false)
  })
})
