import { describe, expect, it } from 'bun:test'
import { parseCursorModels } from './cursor-models'

// Real output shape from `cursor-agent --list-models` (2026.05.28).
const REAL = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex - Codex 5.3
cursor-grok-4.5-high - Cursor Grok 4.5
composer-2.5 - Composer 2.5 (current)
claude-opus-4-8-thinking-high - Opus 4.8 1M Thinking
`

describe('parseCursorModels', () => {
  it('parses ids and labels, skipping the header', () => {
    const models = parseCursorModels(REAL)
    expect(models[0]).toEqual({ id: 'auto', label: 'Auto (default)' })
    expect(models.map((m) => m.id)).toContain('cursor-grok-4.5-high')
    // "Available models" has no " - " separator, so it must not become a model.
    expect(models.map((m) => m.id)).not.toContain('Available')
  })

  it('keeps labels containing dashes and parentheses intact', () => {
    const models = parseCursorModels(REAL)
    expect(models.find((m) => m.id === 'composer-2.5')?.label).toBe('Composer 2.5 (current)')
  })

  it('surfaces `auto` — the Cursor Router entry point', () => {
    expect(parseCursorModels(REAL).some((m) => m.id === 'auto')).toBe(true)
  })

  it('is empty for junk, so callers fall back to the static catalog', () => {
    expect(parseCursorModels('')).toEqual([])
    expect(parseCursorModels('not a model list\njust prose')).toEqual([])
  })

  it('dedupes repeated ids', () => {
    expect(parseCursorModels('a - A\na - A again')).toEqual([{ id: 'a', label: 'A' }])
  })
})
