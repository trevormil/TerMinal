import { describe, expect, test } from 'bun:test'
import { ENGINES, effortArgs, engineEffortsOf, engineSupportsEffort, coerceEffort } from './engines'

// Reasoning-effort support (verified against each installed CLI's --help):
//   claude   --effort <low|medium|high|xhigh|max>
//   codex    -c model_reasoning_effort=<minimal|low|medium|high|xhigh>
//   pi       --thinking <off|minimal|low|medium|high|xhigh|max>
//   opencode --variant <minimal|low|medium|high|max>
//   openrouter/openai-compat: or-agent --effort (codex harness passthrough)
//   cursor/hermes: no effort control → null

describe('engine effort registry', () => {
  test('claude takes --effort with the Claude Code level set', () => {
    expect(effortArgs('claude', 'xhigh')).toEqual(['--effort', 'xhigh'])
    expect(engineEffortsOf('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('codex takes the config-key form usable by both TUI and exec', () => {
    expect(effortArgs('codex', 'high')).toEqual(['-c', 'model_reasoning_effort=high'])
    expect(engineEffortsOf('codex')).toContain('minimal')
    expect(engineEffortsOf('codex')).toContain('xhigh')
  })

  test('pi takes --thinking, opencode takes --variant', () => {
    expect(effortArgs('pi', 'max')).toEqual(['--thinking', 'max'])
    expect(effortArgs('opencode', 'high')).toEqual(['--variant', 'high'])
  })

  test('or-agent-harnessed engines take or-agent --effort', () => {
    expect(effortArgs('openrouter', 'high')).toEqual(['--effort', 'high'])
    expect(effortArgs('openai-compat', 'low')).toEqual(['--effort', 'low'])
  })

  test('cursor and hermes have no effort control', () => {
    expect(engineSupportsEffort('cursor')).toBe(false)
    expect(engineSupportsEffort('hermes')).toBe(false)
    expect(effortArgs('cursor', 'high')).toEqual([])
    expect(engineEffortsOf('cursor')).toEqual([])
  })

  test('empty/unknown inputs never emit args', () => {
    expect(effortArgs('claude', '')).toEqual([])
    expect(effortArgs('not-an-engine', 'high')).toEqual([])
    // a level the engine does not accept is dropped, not passed through
    expect(effortArgs('claude', 'minimal')).toEqual([])
    expect(effortArgs('codex', 'bogus')).toEqual([])
  })

  test('coerceEffort validates against the engine level set', () => {
    expect(coerceEffort('claude', 'high')).toBe('high')
    expect(coerceEffort('claude', 'minimal')).toBeUndefined()
    expect(coerceEffort('cursor', 'high')).toBeUndefined()
    expect(coerceEffort('claude', undefined)).toBeUndefined()
    expect(coerceEffort('claude', '')).toBeUndefined()
  })

  test('every engine declares effort explicitly (supported or null)', () => {
    for (const e of Object.values(ENGINES)) expect('effort' in e).toBe(true)
  })
})
