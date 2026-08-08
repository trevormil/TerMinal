import { describe, expect, test } from 'bun:test'
import { buildEngineLaunch } from './engine-launch'

// Ticket 91: the engine-argv ladder extracted from startSession. These are the
// first direct tests of the per-engine launch branches — previously buried in
// index.ts, exercised only by actually spawning sessions.

const fixed = () => 'fixed-uuid'

describe('buildEngineLaunch', () => {
  test('local: no args, keeps or mints the session id', () => {
    expect(buildEngineLaunch({ engine: 'local', mode: 'new', newSessionId: fixed })).toEqual({
      sessionId: 'fixed-uuid',
      args: [],
    })
    expect(
      buildEngineLaunch({ engine: 'local', mode: '', sessionId: 's1', newSessionId: fixed })
        .sessionId,
    ).toBe('s1')
  })

  test('codex: sandbox flags always; resume reuses the id', () => {
    const fresh = buildEngineLaunch({ engine: 'codex', mode: 'new', newSessionId: fixed })
    expect(fresh.args).toEqual(['-s', 'danger-full-access', '-a', 'never'])
    const resume = buildEngineLaunch({
      engine: 'codex',
      mode: 'resume',
      sessionId: 'abc',
      newSessionId: fixed,
    })
    expect(resume.sessionId).toBe('abc')
    expect(resume.args).toEqual(['-s', 'danger-full-access', '-a', 'never', 'resume', 'abc'])
  })

  test('codex: a model rides through the shared registry flag', () => {
    const r = buildEngineLaunch({
      engine: 'codex',
      mode: 'new',
      model: 'gpt-5.5',
      newSessionId: fixed,
    })
    expect(r.args).toContain('gpt-5.5')
  })

  test('claude: fresh sessions get --session-id + auto permission mode; resume gets --resume', () => {
    const fresh = buildEngineLaunch({
      engine: 'claude',
      mode: 'new',
      name: 'My tab',
      newSessionId: fixed,
    })
    expect(fresh.args).toEqual([
      '--session-id',
      'fixed-uuid',
      '--name',
      'My tab',
      '--permission-mode',
      'auto',
    ])
    const resume = buildEngineLaunch({
      engine: 'claude',
      mode: 'resume',
      sessionId: 'old',
      newSessionId: fixed,
    })
    expect(resume.args).toEqual(['--resume', 'old', '--permission-mode', 'auto'])
  })

  test('hermes: TUI flag, resume attach, its own -m (not the registry flag)', () => {
    const r = buildEngineLaunch({
      engine: 'hermes',
      mode: 'resume',
      sessionId: 'h1',
      model: 'llama',
      newSessionId: fixed,
    })
    expect(r.args).toEqual(['--tui', '--resume', 'h1', '-m', 'llama'])
  })

  test('openrouter: harness picks the argv shape', () => {
    const codexH = buildEngineLaunch({
      engine: 'openrouter',
      mode: 'new',
      model: 'meta/llama',
      newSessionId: fixed,
    })
    expect(codexH.args).toEqual([
      '-c',
      'model_provider=openrouter',
      '-s',
      'danger-full-access',
      '-a',
      'never',
      '-m',
      'meta/llama',
    ])
    const hermesH = buildEngineLaunch({
      engine: 'openrouter',
      mode: 'new',
      model: 'meta/llama',
      openrouterHarness: 'hermes',
      newSessionId: fixed,
    })
    expect(hermesH.args).toEqual(['--tui', '--provider', 'openrouter', '-m', 'meta/llama'])
  })

  test('openai-compat: inline provider config wired to the base URL', () => {
    const r = buildEngineLaunch({
      engine: 'openai-compat',
      mode: 'new',
      model: 'qwen',
      openAICompatBaseUrl: 'http://localhost:1234/v1',
      newSessionId: fixed,
    })
    expect(r.args).toContain('model_providers.openai-compat.base_url=http://localhost:1234/v1')
    expect(r.args).toContain('model_providers.openai-compat.env_key=OPENAI_API_KEY')
    expect(r.args.slice(-2)).toEqual(['-m', 'qwen'])
  })

  test('openai-compat without a base URL fails loudly, not with a broken spawn', () => {
    expect(() =>
      buildEngineLaunch({ engine: 'openai-compat', mode: 'new', newSessionId: fixed }),
    ).toThrow(/no base URL/)
  })

  test('cursor: resume flag, fresh keeps a provided id', () => {
    const r = buildEngineLaunch({
      engine: 'cursor',
      mode: 'resume',
      sessionId: 'c9',
      newSessionId: fixed,
    })
    expect(r.args).toEqual(['--resume', 'c9'])
    expect(
      buildEngineLaunch({ engine: 'cursor', mode: 'new', sessionId: 'keep', newSessionId: fixed })
        .sessionId,
    ).toBe('keep')
  })

  test('opencode: resume via the registry args; model via the registry flag', () => {
    const r = buildEngineLaunch({
      engine: 'opencode',
      mode: 'resume',
      sessionId: 'oc1',
      model: 'anthropic/claude-fable-5',
      newSessionId: fixed,
    })
    expect(r.sessionId).toBe('oc1')
    expect(r.args.length).toBeGreaterThan(0)
  })
})

describe('buildEngineLaunch — reasoning effort', () => {
  test('claude gets --effort; local never does', () => {
    const r = buildEngineLaunch({
      engine: 'claude',
      mode: 'new',
      effort: 'xhigh',
      newSessionId: fixed,
    })
    expect(r.args).toContain('--effort')
    expect(r.args).toContain('xhigh')
    expect(
      buildEngineLaunch({ engine: 'local', mode: 'new', effort: 'high', newSessionId: fixed }).args,
    ).toEqual([])
  })

  test('codex gets the -c config form (works for TUI and exec)', () => {
    const r = buildEngineLaunch({
      engine: 'codex',
      mode: 'new',
      effort: 'high',
      newSessionId: fixed,
    })
    expect(r.args).toContain('model_reasoning_effort=high')
  })

  test('openrouter: codex harness gets the -c form, hermes harness gets nothing', () => {
    const codexH = buildEngineLaunch({
      engine: 'openrouter',
      mode: 'new',
      effort: 'high',
      openrouterHarness: 'codex',
      newSessionId: fixed,
    })
    expect(codexH.args).toContain('model_reasoning_effort=high')
    const hermesH = buildEngineLaunch({
      engine: 'openrouter',
      mode: 'new',
      effort: 'high',
      openrouterHarness: 'hermes',
      newSessionId: fixed,
    })
    expect(hermesH.args.join(' ')).not.toContain('effort')
  })

  test('openai-compat (codex TUI) gets the -c form', () => {
    const r = buildEngineLaunch({
      engine: 'openai-compat',
      mode: 'new',
      effort: 'low',
      openAICompatBaseUrl: 'http://x',
      newSessionId: fixed,
    })
    expect(r.args).toContain('model_reasoning_effort=low')
  })

  test('unsupported engines and off-list levels are dropped', () => {
    expect(
      buildEngineLaunch({
        engine: 'cursor',
        mode: 'new',
        effort: 'high',
        newSessionId: fixed,
      }).args.join(' '),
    ).not.toContain('effort')
    expect(
      buildEngineLaunch({
        engine: 'claude',
        mode: 'new',
        effort: 'bogus',
        newSessionId: fixed,
      }).args.join(' '),
    ).not.toContain('--effort')
  })

  test('pi gets --thinking', () => {
    const r = buildEngineLaunch({ engine: 'pi', mode: 'new', effort: 'max', newSessionId: fixed })
    expect(r.args).toContain('--thinking')
    expect(r.args).toContain('max')
  })
})
