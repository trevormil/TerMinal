import { describe, expect, test } from 'bun:test'
import { costOf, lookupPrice } from './ai-pricing'

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

  test('the whole gpt-5.6 family prices distinctly, incl. the bare alias', () => {
    const M = 1_000_000
    // Sol is the frontier tier…
    expect(lookupPrice('gpt-5.6-sol').input).toBeCloseTo(5 / M, 12)
    expect(lookupPrice('gpt-5.6-sol').output).toBeCloseTo(30 / M, 12)
    // …and `gpt-5.6` is its alias. Without an explicit row this would
    // prefix-match the older, cheaper `gpt-5` and under-report cost.
    expect(lookupPrice('gpt-5.6').input).toBeCloseTo(5 / M, 12)
    expect(lookupPrice('gpt-5.6').input).not.toBeCloseTo(lookupPrice('gpt-5').input, 12)
    // Luna is the cheap tier.
    expect(lookupPrice('gpt-5.6-luna').input).toBeCloseTo(1 / M, 12)
  })

  test('Opus 5 prices as a frontier Claude model', () => {
    const M = 1_000_000
    expect(lookupPrice('claude-opus-5').input).toBeCloseTo(15 / M, 12)
    expect(lookupPrice('claude-opus-5').output).toBeCloseTo(75 / M, 12)
    expect(lookupPrice('claude-opus-5').family).toBe('claude')
    // Dated variants still resolve via prefix matching.
    expect(lookupPrice('claude-opus-5-20260901').contextWindow).toBe(1_000_000)
  })

  test('unknown provider-prefixed slugs still fall back to zero-cost', () => {
    expect(lookupPrice('nobody/great-unknown-model').contextWindow).toBe(0)
  })

  // A row that omits cacheWrite does not bill zero — costOf falls back to the
  // plain input rate, so the miss is a silent 25% under-report rather than an
  // obvious one. Assert the rate, not merely that the field exists.
  test('every GPT-5.6 row bills cache writes at 1.25x uncached input', () => {
    const M = 1_000_000
    const writeCost = (m: string) => costOf(m, { cacheWrite: M })
    expect(writeCost('gpt-5.6-sol')).toBeCloseTo(6.25, 9)
    expect(writeCost('gpt-5.6')).toBeCloseTo(6.25, 9) // Sol's alias
    expect(writeCost('gpt-5.6-terra')).toBeCloseTo(3.125, 9)
    expect(writeCost('gpt-5.6-luna')).toBeCloseTo(1.25, 9)
    // The exact bug this pins: silently falling through to the input rate.
    for (const m of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
      expect(writeCost(m)).toBeGreaterThan(costOf(m, { input: M }))
  })

  test('a cache read stays far cheaper than a cache write', () => {
    const M = 1_000_000
    expect(costOf('gpt-5.6-sol', { cacheRead: M })).toBeCloseTo(0.5, 9)
    expect(costOf('gpt-5.6-sol', { cacheRead: M })).toBeLessThan(
      costOf('gpt-5.6-sol', { cacheWrite: M }),
    )
  })
})
