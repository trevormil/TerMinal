import { test, expect, describe } from 'bun:test'
import { pluginVisibleForEngine, reconcileFreshPlugins } from './pluginVisibility'
import type { Engine } from './types'

const p = (id: string, defaultEnabled: boolean) => ({ id, defaultEnabled })

describe('pluginVisibleForEngine', () => {
  const ungated = {} as { engines?: Engine[] }
  const claudeOnly = { engines: ['claude'] as Engine[] }

  test('local session shows ungated plugins (tickets/git/PRs class)', () => {
    expect(pluginVisibleForEngine(ungated, 'local')).toBe(true)
  })

  test('local session hides engine-gated plugins (transcript/telemetry class)', () => {
    expect(pluginVisibleForEngine(claudeOnly, 'local')).toBe(false)
  })

  test('engine sessions unchanged: gated plugin shows only on its engine', () => {
    expect(pluginVisibleForEngine(claudeOnly, 'claude')).toBe(true)
    expect(pluginVisibleForEngine(claudeOnly, 'codex')).toBe(false)
    expect(pluginVisibleForEngine(claudeOnly, 'hermes')).toBe(false)
    expect(pluginVisibleForEngine(claudeOnly, 'cursor')).toBe(false)
    expect(pluginVisibleForEngine(claudeOnly, 'openrouter')).toBe(false)
  })

  test('engine sessions unchanged: ungated plugin shows everywhere', () => {
    for (const e of ['claude', 'codex', 'cursor', 'openrouter', 'hermes'] as const) {
      expect(pluginVisibleForEngine(ungated, e)).toBe(true)
    }
  })

  test('empty engines list means visible nowhere (explicitly unreachable)', () => {
    expect(pluginVisibleForEngine({ engines: [] }, 'claude')).toBe(false)
    expect(pluginVisibleForEngine({ engines: [] }, 'local')).toBe(false)
  })
})

describe('reconcileFreshPlugins', () => {
  test('saved visibility state + unknown new id → defaultEnabled wins (widget shows up)', () => {
    // A user with persisted state from before the `tickets` widget shipped.
    const next = reconcileFreshPlugins([p('todos', true), p('tickets', true)], ['todos'], ['todos'])
    expect(next).toEqual({ known: ['todos', 'tickets'], enabled: ['todos', 'tickets'] })
  })

  test('fresh plugin with defaultEnabled false becomes known but stays hidden', () => {
    const next = reconcileFreshPlugins([p('todos', true), p('niche', false)], ['todos'], ['todos'])
    expect(next).toEqual({ known: ['todos', 'niche'], enabled: ['todos'] })
  })

  test('nothing fresh → null (no state churn)', () => {
    expect(reconcileFreshPlugins([p('todos', true)], ['todos'], ['todos'])).toBeNull()
  })

  test('a known plugin the user disabled is never re-enabled', () => {
    const next = reconcileFreshPlugins(
      [p('todos', true), p('git', true), p('tickets', true)],
      ['todos', 'git'],
      ['todos'], // user turned git off
    )
    expect(next).toEqual({ known: ['todos', 'git', 'tickets'], enabled: ['todos', 'tickets'] })
  })

  test('first run (no saved state) enables every defaultEnabled plugin', () => {
    const next = reconcileFreshPlugins([p('a', true), p('b', false), p('c', true)], [], [])
    expect(next).toEqual({ known: ['a', 'b', 'c'], enabled: ['a', 'c'] })
  })

  test('never duplicates ids already present', () => {
    const next = reconcileFreshPlugins([p('a', true), p('b', true)], ['a'], ['a', 'b'])
    expect(next).toEqual({ known: ['a', 'b'], enabled: ['a', 'b'] })
  })
})
