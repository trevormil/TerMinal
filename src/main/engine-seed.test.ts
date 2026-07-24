import { describe, expect, test } from 'bun:test'
import { engineInitialPromptArgs, engineSupportsLaunchSeed } from './engine-seed'

describe('engineSupportsLaunchSeed', () => {
  test('every agent engine supports it; a bare local shell does not', () => {
    for (const e of ['claude', 'codex', 'cursor', 'hermes', 'openrouter', 'openai-compat'])
      expect(engineSupportsLaunchSeed(e)).toBe(true)
    expect(engineSupportsLaunchSeed('local')).toBe(false)
    expect(engineSupportsLaunchSeed('unknown')).toBe(false)
  })
})

describe('engineInitialPromptArgs', () => {
  test('positional prompt for claude/codex/cursor/openai-compat', () => {
    for (const e of ['claude', 'codex', 'cursor', 'openai-compat'])
      expect(engineInitialPromptArgs(e, 'do the thing')).toEqual(['do the thing'])
  })
  test('hermes takes -z', () => {
    expect(engineInitialPromptArgs('hermes', 'do the thing')).toEqual(['-z', 'do the thing'])
  })
  test('openrouter follows its harness', () => {
    expect(engineInitialPromptArgs('openrouter', 'p', 'codex')).toEqual(['p'])
    expect(engineInitialPromptArgs('openrouter', 'p', 'hermes')).toEqual(['-z', 'p'])
  })
  test('a multi-line prompt is passed as ONE argument (not split)', () => {
    const p = 'line one\nline two\n\nline three'
    expect(engineInitialPromptArgs('claude', p)).toEqual([p])
  })
  test('empty prompt and unseedable engines yield no args', () => {
    expect(engineInitialPromptArgs('claude', '')).toEqual([])
    expect(engineInitialPromptArgs('local', 'p')).toEqual([])
  })
})
