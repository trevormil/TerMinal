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

  test('provider-prefixed OpenRouter slugs resolve to real rows, not zero-cost', () => {
    // OpenRouter models are recorded as provider/model — the prefix must not
    // defeat the lookup (runs were logging $0 for every OpenRouter model).
    const M = 1_000_000
    expect(lookupPrice('moonshotai/kimi-k3').input).toBeCloseTo(3 / M, 12)
    expect(lookupPrice('moonshotai/kimi-k3').output).toBeCloseTo(15 / M, 12)
    expect(lookupPrice('deepseek/deepseek-v4-flash').input).toBeCloseTo(0.098 / M, 12)
    expect(lookupPrice('anthropic/claude-sonnet-5').family).toBe('claude')
  })

  test('prefixed dated ids still prefix-match after the provider is stripped', () => {
    expect(lookupPrice('anthropic/claude-opus-4-8-20260601').contextWindow).toBe(1_000_000)
  })

  test('gpt-5.6-terra gets its own row, not the shorter gpt-5 prefix match', () => {
    const M = 1_000_000
    expect(lookupPrice('openai/gpt-5.6-terra').input).toBeCloseTo(2.5 / M, 12)
    expect(lookupPrice('gpt-5.6-terra').output).toBeCloseTo(15 / M, 12)
  })

  test('unknown provider-prefixed slugs still fall back to zero-cost', () => {
    expect(lookupPrice('nobody/great-unknown-model').contextWindow).toBe(0)
  })
})
