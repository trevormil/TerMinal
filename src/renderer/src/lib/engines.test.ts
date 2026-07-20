import { describe, expect, test } from 'bun:test'
import { coerceSessionEngine, ENGINE_LABEL } from './engines'

describe('coerceSessionEngine', () => {
  test('preserves every cataloged engine plus local (nothing coerced away)', () => {
    for (const e of [...Object.keys(ENGINE_LABEL), 'local']) {
      expect(coerceSessionEngine(e)).toBe(e as ReturnType<typeof coerceSessionEngine>)
    }
    // The regression that motivated this helper: a literal allowlist in
    // App.tsx silently coerced 'openai-compat' terminal launches to claude.
    expect(coerceSessionEngine('openai-compat')).toBe('openai-compat')
  })

  test('falls back to claude for unknown or non-string values', () => {
    expect(coerceSessionEngine('not-an-engine')).toBe('claude')
    expect(coerceSessionEngine(undefined)).toBe('claude')
    expect(coerceSessionEngine(42)).toBe('claude')
  })
})
