import { test, expect, describe } from 'bun:test'
import {
  BUILTIN_PROMPT_ID,
  DEFAULT_SPAWN,
  NO_PROMPT,
  SPAWN_COUNT_MAX,
  TERMINAL_AGENT_PROMPT,
  buildPromptOptions,
  clampSpawnCount,
  findPromptOption,
  resolvePromptText,
  spawnSummary,
} from './spawnOptions'

describe('clampSpawnCount', () => {
  test('keeps a sane count and floors everything else to 1', () => {
    expect(clampSpawnCount(1)).toBe(1)
    expect(clampSpawnCount(8)).toBe(8)
    expect(clampSpawnCount(0)).toBe(1)
    expect(clampSpawnCount(-3)).toBe(1)
    expect(clampSpawnCount(2.7)).toBe(2)
    expect(clampSpawnCount(NaN)).toBe(1)
    expect(clampSpawnCount('4')).toBe(4)
    expect(clampSpawnCount(undefined)).toBe(1)
  })

  test('caps at the spend guard', () => {
    expect(clampSpawnCount(9)).toBe(SPAWN_COUNT_MAX)
    expect(clampSpawnCount(500)).toBe(SPAWN_COUNT_MAX)
    expect(SPAWN_COUNT_MAX).toBe(8)
  })
})

describe('buildPromptOptions', () => {
  const agents = [
    { id: 'code-review', title: 'Code review', prompt: 'Review the PR.' },
    { id: 'no-prompt', title: 'Scripted agent', prompt: '' },
  ]
  const custom = [{ id: 'c1', name: 'Ship it', text: 'Ship the thing.' }]

  test('None first, then the built-in, then agents, then custom', () => {
    const opts = buildPromptOptions({ agents, custom })
    expect(opts.map((o) => o.id)).toEqual([
      NO_PROMPT,
      BUILTIN_PROMPT_ID,
      'agent:code-review',
      'custom:c1',
    ])
    expect(opts.map((o) => o.group)).toEqual(['', '', 'Agents', 'Custom'])
  })

  test('agents without a prompt body are not offered', () => {
    const ids = buildPromptOptions({ agents, custom: [] }).map((o) => o.id)
    expect(ids).not.toContain('agent:no-prompt')
  })

  test('None and the built-in exist with no agents and no custom prompts', () => {
    const opts = buildPromptOptions({})
    expect(opts.map((o) => o.id)).toEqual([NO_PROMPT, BUILTIN_PROMPT_ID])
    expect(opts[0].text).toBe('')
    expect(opts[1].text).toBe(TERMINAL_AGENT_PROMPT)
  })

  test('labels are the agent/prompt names', () => {
    const opts = buildPromptOptions({ agents, custom })
    expect(findPromptOption(opts, 'agent:code-review')?.label).toBe('Code review')
    expect(findPromptOption(opts, 'custom:c1')?.label).toBe('Ship it')
  })
})

describe('resolvePromptText', () => {
  const opts = buildPromptOptions({
    agents: [{ id: 'a1', title: 'A one', prompt: 'agent body' }],
    custom: [{ id: 'c1', name: 'Ship it', text: 'custom body' }],
  })

  test('resolves each kind of selection', () => {
    expect(resolvePromptText(opts, NO_PROMPT)).toBe('')
    expect(resolvePromptText(opts, BUILTIN_PROMPT_ID)).toBe(TERMINAL_AGENT_PROMPT)
    expect(resolvePromptText(opts, 'agent:a1')).toBe('agent body')
    expect(resolvePromptText(opts, 'custom:c1')).toBe('custom body')
  })

  test('a selection that no longer exists falls back to no prompt', () => {
    // A saved pref can outlive the agent or custom prompt it named.
    expect(resolvePromptText(opts, 'agent:deleted')).toBe('')
    expect(resolvePromptText(opts, '')).toBe('')
  })

  test('never returns a trailing newline — a prefill must not submit', () => {
    for (const o of opts) expect(resolvePromptText(opts, o.id)).toBe(o.text.replace(/\s+$/, ''))
    expect(TERMINAL_AGENT_PROMPT.endsWith('\n')).toBe(false)
  })
})

describe('spawnSummary', () => {
  const opts = buildPromptOptions({})
  test('defaults summarize as nothing at all', () => {
    expect(spawnSummary(1, NO_PROMPT, opts)).toBe('')
  })
  test('non-default choices read as a compact line', () => {
    expect(spawnSummary(3, NO_PROMPT, opts)).toBe('×3')
    expect(spawnSummary(1, BUILTIN_PROMPT_ID, opts)).toBe('TerMinal agent')
    expect(spawnSummary(3, BUILTIN_PROMPT_ID, opts)).toBe('×3 · TerMinal agent')
  })
  test('an unresolvable prompt id summarizes as the count alone', () => {
    expect(spawnSummary(2, 'custom:gone', opts)).toBe('×2')
  })
})

describe('DEFAULT_SPAWN', () => {
  test('is ×1 / None — the reset target for both first mount and every post-spawn reset', () => {
    // The New session screen deliberately keeps no memory of the last pick:
    // it seeds initial state from this constant AND resets back to it after
    // each spawn, so a second spawn in the same visit is just as explicit as
    // the first. Pinning the shape here protects both call sites at once.
    expect(DEFAULT_SPAWN).toEqual({ count: 1, promptId: NO_PROMPT, text: '' })
  })
})

describe('TERMINAL_AGENT_PROMPT', () => {
  test('is engine-agnostic — it addresses no specific CLI vendor', () => {
    // CLAUDE.md is a FILE in the repo, not the engine, so it is allowed; a
    // vendor name anywhere else would make the prompt wrong for half the
    // engines that can receive it.
    const withoutFilenames = TERMINAL_AGENT_PROMPT.replace(/CLAUDE\.md/g, '')
    expect(withoutFilenames).not.toMatch(/claude|codex|cursor|anthropic|openai|gemini/i)
  })
  test('carries the four things a TerMinal session must know', () => {
    expect(TERMINAL_AGENT_PROMPT).toMatch(/TerMinal/)
    expect(TERMINAL_AGENT_PROMPT).toMatch(/skills|slash/i)
    expect(TERMINAL_AGENT_PROMPT).toMatch(/never push (to )?main|never commit or push to main/i)
    expect(TERMINAL_AGENT_PROMPT).toMatch(/terminal-cli inbox-item/)
  })
  test('is a briefing, not an essay', () => {
    const lines = TERMINAL_AGENT_PROMPT.split('\n').filter((l) => l.trim())
    expect(lines.length).toBeGreaterThanOrEqual(8)
    expect(lines.length).toBeLessThanOrEqual(16)
  })
})
