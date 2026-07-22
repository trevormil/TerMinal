import { describe, expect, test } from 'bun:test'
import { MODEL_TIERS, isModelTier, normalizeModelTier, resolveModel } from './resolve-model'

// resolveModel's routing is exercised in agents.test.ts. This file covers the
// tier VALIDATION seam that the write path depends on — the part that decides
// what is allowed to reach a ticket file in the first place.

describe('model tier validation', () => {
  test('recognises exactly the routable tiers', () => {
    expect(MODEL_TIERS).toEqual(['auto', 'top', 'cheap-agentic', 'cheap-raw'])
    for (const tier of MODEL_TIERS) expect(isModelTier(tier)).toBe(true)
  })

  test('rejects anything resolveModel could not route', () => {
    for (const junk of ['', 'cheep-raw', 'TOP', 'default', 'deep', null, undefined, 7, {}]) {
      expect(isModelTier(junk)).toBe(false)
    }
  })

  test('normalises an unroutable tier to auto', () => {
    expect(normalizeModelTier('cheep-raw')).toBe('auto')
    expect(normalizeModelTier(undefined)).toBe('auto')
    expect(normalizeModelTier('')).toBe('auto')
    // A valid tier passes through untouched.
    expect(normalizeModelTier('top')).toBe('top')
    expect(normalizeModelTier('cheap-raw')).toBe('cheap-raw')
  })

  test('an unroutable tier bills at the default slot, never the cheap one', () => {
    // This is why validation exists. A typo'd tier falls through to `default`,
    // which is the EXPENSIVE model — so a ticket could claim to be cheap while
    // every run silently billed at top rate. Normalising at the write boundary
    // keeps the file honest about its own cost.
    const policy = { default: 'sonnet', deep: 'opus', cheap: 'haiku' }
    expect(resolveModel({ policy, tier: 'cheep-raw' })).toBe('sonnet')
    expect(resolveModel({ policy, tier: 'cheap-raw' })).toBe('haiku')
    expect(resolveModel({ policy, tier: 'top' })).toBe('opus')
    expect(resolveModel({ policy, tier: undefined })).toBe('sonnet')
  })
})
