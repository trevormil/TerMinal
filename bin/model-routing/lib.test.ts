import { describe, expect, test } from 'bun:test'
import { resolveEndpoint, OPENROUTER_BASE_URL } from './lib.ts'

describe('resolveEndpoint', () => {
  test('env unset → the OpenRouter default, keyed by OPENROUTER_API_KEY only', () => {
    const r = resolveEndpoint({ OPENROUTER_API_KEY: 'or-key', OPENAI_API_KEY: 'oai-key' })
    expect(r.baseUrl).toBe(OPENROUTER_BASE_URL)
    expect(r.custom).toBe(false)
    expect(r.key).toBe('or-key')
  })

  test('OPENAI_BASE_URL set → the custom endpoint, trailing slashes trimmed', () => {
    const r = resolveEndpoint({
      OPENAI_BASE_URL: 'http://10.0.0.5:8000/v1/',
      OPENAI_API_KEY: 'oai-key',
    })
    expect(r.baseUrl).toBe('http://10.0.0.5:8000/v1')
    expect(r.custom).toBe(true)
    expect(r.key).toBe('oai-key')
  })

  test('custom endpoint falls back to OPENROUTER_API_KEY when OPENAI_API_KEY is unset', () => {
    const r = resolveEndpoint({ OPENAI_BASE_URL: 'http://localhost:11434/v1', OPENROUTER_API_KEY: 'or-key' })
    expect(r.key).toBe('or-key')
  })

  test('a blank OPENAI_BASE_URL behaves exactly like unset', () => {
    const r = resolveEndpoint({ OPENAI_BASE_URL: '   ', OPENROUTER_API_KEY: 'or-key' })
    expect(r.baseUrl).toBe(OPENROUTER_BASE_URL)
    expect(r.custom).toBe(false)
  })

  test('missing keys resolve to empty string (callers decide how to fail)', () => {
    expect(resolveEndpoint({}).key).toBe('')
    expect(resolveEndpoint({ OPENAI_BASE_URL: 'http://x/v1' }).key).toBe('')
  })
})
