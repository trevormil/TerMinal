import { describe, expect, test } from 'bun:test'
import { lookupPrice } from './ai-pricing'

describe('lookupPrice', () => {
  test('normalizes known aliases and dated model ids', () => {
    expect(lookupPrice('sonnet').contextWindow).toBe(1_000_000)
    expect(lookupPrice('claude-opus-4-8-20260601').contextWindow).toBe(1_000_000)
  })

  test('unknown models do not report a fabricated context cap', () => {
    const price = lookupPrice('some-future-model')
    expect(price.family).toBe('unknown')
    expect(price.contextWindow).toBe(0)
  })
})
