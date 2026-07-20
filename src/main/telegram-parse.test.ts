import { test, expect, describe } from 'bun:test'
import {
  parseCommand,
  classifyRunArgs,
  parsePollLine,
  parseFeatureDraft,
  splitRepoToken,
} from './telegram-parse'

describe('parseCommand', () => {
  test('lowercases the command, preserves arg case', () => {
    expect(parseCommand('/Run Docs Codex')).toEqual({ cmd: '/run', args: ['Docs', 'Codex'] })
  })

  test('collapses surrounding + inner whitespace', () => {
    expect(parseCommand('  /runs   ')).toEqual({ cmd: '/runs', args: [] })
  })
})

describe('classifyRunArgs', () => {
  test('first arg is the agent id', () => {
    expect(classifyRunArgs(['docs']).agentId).toBe('docs')
  })

  test('defaults: codex engine, single pipeline, no persona/repo', () => {
    const r = classifyRunArgs(['docs'])
    expect(r.engine).toBe('codex')
    expect(r.pipeline).toBe('single')
    expect(r.repoToken).toBeUndefined()
    expect(r.personaCandidates).toEqual([])
  })

  test('classifies engine / pipeline / @repo / persona in any order', () => {
    const r = classifyRunArgs([
      'security-sweep',
      'review-iterate',
      '@agentforge',
      'claude',
      'security',
    ])
    expect(r.agentId).toBe('security-sweep')
    expect(r.engine).toBe('claude')
    expect(r.pipeline).toBe('review-iterate')
    expect(r.repoToken).toBe('@agentforge')
    expect(r.personaCandidates).toEqual(['security'])
  })

  test('engine + pipeline matching is case-insensitive', () => {
    const r = classifyRunArgs(['docs', 'CLAUDE', 'REVIEW'])
    expect(r.engine).toBe('claude')
    expect(r.pipeline).toBe('review')
  })

  test('classifies cursor as an engine', () => {
    const r = classifyRunArgs(['docs', 'cursor'])
    expect(r.engine).toBe('cursor')
  })

  test('classifies openai-compat as an engine, not a persona candidate', () => {
    const r = classifyRunArgs(['docs', 'openai-compat', 'security'])
    expect(r.engine).toBe('openai-compat')
    expect(r.personaCandidates).toEqual(['security'])
  })

  test('unrecognized tokens become persona candidates', () => {
    expect(classifyRunArgs(['docs', 'wizard', 'ninja']).personaCandidates).toEqual([
      'wizard',
      'ninja',
    ])
  })
})

describe('splitRepoToken', () => {
  test('takes a leading @repo token', () => {
    expect(splitRepoToken(['@vellum', 'add', 'CSV', 'export'])).toEqual({
      repoToken: '@vellum',
      rest: ['add', 'CSV', 'export'],
    })
  })

  test('takes a trailing @repo token', () => {
    expect(splitRepoToken(['add', 'CSV', 'export', '@vellum-project'])).toEqual({
      repoToken: '@vellum-project',
      rest: ['add', 'CSV', 'export'],
    })
  })

  test('leaves a mid-sentence @ as prose', () => {
    // The bug this exists to prevent: "@media" is CSS, not a repo.
    expect(splitRepoToken(['add', 'an', '@media', 'query', 'for', 'dark', 'mode'])).toEqual({
      rest: ['add', 'an', '@media', 'query', 'for', 'dark', 'mode'],
    })
  })

  test('ignores an @ token that is the entire message', () => {
    expect(splitRepoToken(['@vellum'])).toEqual({ rest: ['@vellum'] })
  })

  test('does not treat a bare @ or an email-ish token as a repo', () => {
    expect(splitRepoToken(['@', 'do', 'thing'])).toEqual({ rest: ['@', 'do', 'thing'] })
    expect(splitRepoToken(['ping', 'me@example.com'])).toEqual({ rest: ['ping', 'me@example.com'] })
  })

  test('takes only the leading token when both ends look like repos', () => {
    expect(splitRepoToken(['@a', 'do', 'thing', '@b'])).toEqual({
      repoToken: '@a',
      rest: ['do', 'thing', '@b'],
    })
  })

  test('passes through an empty arg list', () => {
    expect(splitRepoToken([])).toEqual({ rest: [] })
  })
})

describe('parseFeatureDraft', () => {
  const full = JSON.stringify({
    title: 'Dark mode toggle in Settings',
    type: 'feature',
    priority: 'high',
    body: 'Add a toggle under Settings → Appearance.',
    acceptance: ['Toggle persists across restarts', 'Respects system preference'],
  })

  test('parses a well-formed draft', () => {
    expect(parseFeatureDraft(full)).toEqual({
      title: 'Dark mode toggle in Settings',
      type: 'feature',
      priority: 'high',
      body: 'Add a toggle under Settings → Appearance.',
      acceptance: ['Toggle persists across restarts', 'Respects system preference'],
    })
  })

  test('unwraps a fenced code block and surrounding prose', () => {
    const wrapped = 'Here you go:\n```json\n' + full + '\n```\nHope that helps!'
    expect(parseFeatureDraft(wrapped)?.title).toBe('Dark mode toggle in Settings')
  })

  test('defaults unknown type and priority rather than passing them through', () => {
    const d = parseFeatureDraft('{"title":"X","type":"epic","priority":"urgent"}')
    expect(d).toMatchObject({ type: 'feature', priority: 'medium', body: '', acceptance: [] })
  })

  test('normalizes type and priority case', () => {
    expect(parseFeatureDraft('{"title":"X","type":"BUG","priority":"High"}')).toMatchObject({
      type: 'bug',
      priority: 'high',
    })
  })

  test('collapses whitespace in the title and caps its length', () => {
    const d = parseFeatureDraft(`{"title":"  a\\n  b  ","body":""}`)
    expect(d?.title).toBe('a b')
    const long = parseFeatureDraft(JSON.stringify({ title: 'x'.repeat(200) }))
    expect(long?.title.length).toBe(120)
  })

  test('drops non-string and empty acceptance items, caps at six', () => {
    const d = parseFeatureDraft(
      JSON.stringify({ title: 'X', acceptance: ['a', 3, '', null, 'b', 'c', 'd', 'e', 'f', 'g'] }),
    )
    expect(d?.acceptance).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  test('returns null without a usable title', () => {
    expect(parseFeatureDraft('{"title":"","body":"x"}')).toBeNull()
    expect(parseFeatureDraft('{"body":"x"}')).toBeNull()
  })

  test('returns null on non-JSON or malformed output', () => {
    expect(parseFeatureDraft('NONE')).toBeNull()
    expect(parseFeatureDraft('{"title": broken')).toBeNull()
    expect(parseFeatureDraft('')).toBeNull()
  })

  test('extracts the object when the model wraps it in an array', () => {
    expect(parseFeatureDraft('[{"title":"X"}]')?.title).toBe('X')
  })
})

describe('parsePollLine', () => {
  const T = '2026-05-28T20:00:00Z'
  const enabledBefore = Date.parse('2026-05-28T19:59:00Z')

  test('returns the command for a fresh command line', () => {
    expect(parsePollLine(`${T}\t/runs`, enabledBefore)).toBe('/runs')
  })

  test('trims the command text', () => {
    expect(parsePollLine(`${T}\t  /run docs  `, enabledBefore)).toBe('/run docs')
  })

  test('ignores non-command messages', () => {
    expect(parsePollLine(`${T}\thello there`, enabledBefore)).toBeNull()
  })

  test('ignores continuation lines (no tab)', () => {
    expect(parsePollLine('a wrapped line with no tab', enabledBefore)).toBeNull()
  })

  test('skips pre-enable backlog (message older than enabledAt)', () => {
    const enabledLater = Date.parse('2026-05-28T20:10:00Z')
    expect(parsePollLine(`${T}\t/runs`, enabledLater)).toBeNull()
  })

  test('allows a small clock-skew grace window', () => {
    const enabledJustAfter = Date.parse(T) + 3_000 // within the 5s grace
    expect(parsePollLine(`${T}\t/runs`, enabledJustAfter)).toBe('/runs')
  })
})
