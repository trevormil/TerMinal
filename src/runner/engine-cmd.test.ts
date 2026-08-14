import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Schedule } from '../shared/types/schedules'
import { buildChildEnv, buildCommand, resolveScriptPath, scriptArgsFor } from './engine-cmd'

// The command string IS the run. Every engine here has a distinct CLI contract,
// and openrouter/hermes shipped once falling through to `codex exec` — a silent
// wrong-engine run that still exited 0.

const prevCfg = process.env.TERMINAL_CONFIG_DIR
afterEach(() => {
  if (prevCfg === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prevCfg
})

function sandbox(): string {
  const cfg = join(mkdtempSync(join(tmpdir(), 'tm-engine-cmd-')), 'TerMinal')
  mkdirSync(cfg, { recursive: true })
  process.env.TERMINAL_CONFIG_DIR = cfg
  return cfg
}

const sched = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 's1',
    repoRoot: '/repo',
    repoLabel: 'repo',
    agentId: 'nightly',
    agentTitle: 'Nightly',
    engine: 'codex',
    prompt: 'do the thing',
    spec: { kind: 'cron', expr: '0 9 * * *' },
    enabled: true,
    createdAt: 0,
    ...over,
  }) as Schedule

describe('buildCommand', () => {
  test('each engine gets its own CLI, never a codex fallback', () => {
    sandbox()
    const wt = '/wt'
    expect(buildCommand(sched({ engine: 'claude' }), wt, null)).toStartWith('claude -p ')
    expect(buildCommand(sched({ engine: 'cursor' }), wt, null)).toStartWith('cursor-agent -p ')
    expect(buildCommand(sched({ engine: 'openrouter' }), wt, null)).toStartWith('or-agent --dir ')
    expect(buildCommand(sched({ engine: 'hermes' }), wt, null)).toStartWith('hermes -z ')
    expect(buildCommand(sched({ engine: 'codex' }), wt, null)).toStartWith('codex exec ')
  })

  test('openai-compat refuses to run without a base URL instead of silently hitting OpenRouter', () => {
    sandbox()
    const cmd = buildCommand(sched({ engine: 'openai-compat' }), '/wt', null)
    expect(cmd).toStartWith('[ -n "$OPENAI_BASE_URL" ] ||')
    expect(cmd).toContain('exit 2')
    expect(cmd).toContain('or-agent --dir')
  })

  test('a prompt carrying a quote cannot break out of the shell word', () => {
    sandbox()
    const cmd = buildCommand(sched({ prompt: "it's; rm -rf /" }), '/wt', null)
    expect(cmd).toContain(`'it'\\''s; rm -rf /'`)
    // The dangerous fragment stays INSIDE the quoted argument.
    expect(cmd.endsWith(`'it'\\''s; rm -rf /'`)).toBe(true)
  })

  test('a script path replaces the whole command — the prompt is not appended', () => {
    sandbox()
    const cmd = buildCommand(sched({ prompt: 'ignored' }), '/wt', '/repo/.agents/nightly.sh')
    expect(cmd).toBe(`'/repo/.agents/nightly.sh'`)
  })

  test('effort maps to each engine s native flag, and an unknown level is dropped', () => {
    sandbox()
    expect(buildCommand(sched({ engine: 'claude', effort: 'high' }), '/wt', null)).toContain(
      ' --effort high',
    )
    expect(buildCommand(sched({ engine: 'codex', effort: 'high' }), '/wt', null)).toContain(
      ' -c model_reasoning_effort=high',
    )
    // 'max' is not a codex level — passing it through would make the CLI reject
    // the whole invocation.
    expect(buildCommand(sched({ engine: 'codex', effort: 'max' }), '/wt', null)).not.toContain(
      'model_reasoning_effort',
    )
  })
})

describe('resolveScriptPath', () => {
  test('a per-repo script wins over a global one of the same name', () => {
    const cfg = sandbox()
    const repo = mkdtempSync(join(tmpdir(), 'tm-repo-'))
    mkdirSync(join(repo, '.agents'), { recursive: true })
    mkdirSync(join(cfg, 'scripts'), { recursive: true })
    writeFileSync(join(repo, '.agents', 'nightly.sh'), '#!/bin/sh\n')
    writeFileSync(join(cfg, 'scripts', 'nightly.sh'), '#!/bin/sh\n')
    expect(resolveScriptPath(repo, 'nightly')).toBe(join(repo, '.agents', 'nightly.sh'))
  })

  test('the global script is the fallback, and absence is null (prompt mode)', () => {
    const cfg = sandbox()
    const repo = mkdtempSync(join(tmpdir(), 'tm-repo-'))
    expect(resolveScriptPath(repo, 'nightly')).toBeNull()
    mkdirSync(join(cfg, 'scripts'), { recursive: true })
    writeFileSync(join(cfg, 'scripts', 'nightly.sh'), '#!/bin/sh\n')
    expect(resolveScriptPath(repo, 'nightly')).toBe(join(cfg, 'scripts', 'nightly.sh'))
  })
})

describe('buildChildEnv', () => {
  const base = { repo: '/repo', runId: 'r1', branch: 'cron/x', worktree: '/wt' }

  test('the schedule s own env is spread LAST so the operator can override', () => {
    sandbox()
    const env = buildChildEnv({
      ...base,
      sched: sched({ env: { TERMINAL_ENGINE: 'mine', BEACON_PROJECT: 'bolt' } }),
    })
    expect(env.BEACON_PROJECT).toBe('bolt')
    expect(env.TERMINAL_ENGINE).toBe('mine')
  })

  test('TERMINAL_MODEL and TERMINAL_EFFORT are absent rather than empty when unset', () => {
    sandbox()
    const env = buildChildEnv({ ...base, sched: sched() })
    expect('TERMINAL_MODEL' in env).toBe(false)
    expect('TERMINAL_EFFORT' in env).toBe(false)
  })

  test('the config bin dir is PREPENDED to PATH so terminal-cli resolves', () => {
    const cfg = sandbox()
    const env = buildChildEnv({ ...base, sched: sched() })
    expect(env.PATH).toStartWith(`${join(cfg, 'bin')}:`)
  })

  test('OPENAI_API_KEY falls back to the keyless placeholder only for openai-compat', () => {
    sandbox()
    expect('OPENAI_API_KEY' in buildChildEnv({ ...base, sched: sched({ engine: 'codex' }) })).toBe(
      process.env.OPENAI_API_KEY !== undefined,
    )
    const compat = buildChildEnv({ ...base, sched: sched({ engine: 'openai-compat' }) })
    expect(compat.OPENAI_API_KEY).toBe(process.env.OPENAI_API_KEY || 'none')
  })
})

describe('scriptArgsFor', () => {
  test('linux passes -e so a failing run is not recorded as done', () => {
    // Without --return, util-linux `script` always exits 0 — every failed
    // scheduled run would land as status:done.
    const args = scriptArgsFor(false, '/bin/bash', 'false')
    expect(args).toContain('-e')
    expect(args[args.length - 1]).toBe('/dev/null')
  })

  test('macos takes the command as trailing argv and needs no -e', () => {
    expect(scriptArgsFor(true, '/bin/zsh', 'false')).toEqual([
      '-q',
      '/dev/null',
      '/bin/zsh',
      '-l',
      '-c',
      'false',
    ])
  })
})
