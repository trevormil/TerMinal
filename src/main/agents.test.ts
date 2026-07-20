import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { resolveModel } from './resolve-model'

const run = (home: string, code: string) => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

describe('resolveModel', () => {
  const policy = {
    default: 'model-default',
    cheap: 'model-cheap',
    deep: 'model-deep',
    judge: 'model-judge',
    allowOverride: true,
  }

  test('maps each modelTier through the agent policy', () => {
    expect(resolveModel({ policy, tier: 'top' })).toBe('model-deep')
    expect(resolveModel({ policy, tier: 'cheap-agentic' })).toBe('model-cheap')
    expect(resolveModel({ policy, tier: 'cheap-raw' })).toBe('model-cheap')
    expect(resolveModel({ policy, tier: 'auto' })).toBe('model-default')
    expect(resolveModel({ policy })).toBe('model-default')
  })

  test('unknown tier behaves like auto', () => {
    expect(resolveModel({ policy, tier: 'nonsense' })).toBe('model-default')
  })

  test('explicit per-run override wins over the policy-selected model', () => {
    expect(resolveModel({ override: 'my-pick', policy, tier: 'top' })).toBe('my-pick')
  })

  test('allowOverride: false blocks an override from superseding the policy model', () => {
    const locked = { ...policy, allowOverride: false }
    expect(resolveModel({ override: 'my-pick', policy: locked, tier: 'top' })).toBe('model-deep')
    expect(resolveModel({ override: 'my-pick', policy: locked })).toBe('model-default')
  })

  test('allowOverride: false still honors the override when the policy selects nothing', () => {
    const locked = { allowOverride: false }
    expect(resolveModel({ override: 'my-pick', policy: locked, tier: 'top' })).toBe('my-pick')
  })

  test('an empty mapped tier falls through to the next priority step', () => {
    const sparse = { default: 'model-default', deep: '' }
    expect(resolveModel({ policy: sparse, tier: 'top', model: 'agent-model' })).toBe('agent-model')
    expect(resolveModel({ policy: sparse, tier: 'top', engineDefault: 'settings-model' })).toBe(
      'settings-model',
    )
  })

  test('missing policy keeps the legacy fallback chain unchanged', () => {
    expect(resolveModel({ override: 'my-pick', model: 'agent-model' })).toBe('my-pick')
    expect(resolveModel({ model: 'agent-model', engineDefault: 'settings-model' })).toBe(
      'agent-model',
    )
    expect(resolveModel({ engineDefault: 'settings-model' })).toBe('settings-model')
    expect(resolveModel({})).toBe('')
  })

  test('never returns whitespace-only output (no empty --model flag)', () => {
    expect(resolveModel({ policy: { default: '  ' }, model: ' ', engineDefault: '' })).toBe('')
  })

  test('a policy written for another engine is ignored, including its override lock', () => {
    const locked = { ...policy, allowOverride: false }
    const cross = { policy: locked, tier: 'top', engine: 'claude', policyEngine: 'codex' }
    expect(resolveModel({ ...cross, override: 'my-pick' })).toBe('my-pick')
    expect(resolveModel({ ...cross, engineDefault: 'settings-model' })).toBe('settings-model')
    expect(
      resolveModel({ policy: locked, tier: 'top', engine: 'codex', policyEngine: 'codex' }),
    ).toBe('model-deep')
  })
})

describe('ticketOwnerModelPolicy', () => {
  test('resolves classic AND persistent ticket owners (and folds their policy)', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-ticket-owner-'))
    try {
      const result = run(
        home,
        `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} } }));
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = join('${home}', 'repo');
mkdirSync(join(repo, '.agents'), { recursive: true });
writeFileSync(join(repo, '.agents', 'agents.json'), JSON.stringify([{
  id: 'classic-owner', title: 'Classic', prompt: 'p', engine: 'codex',
  modelPolicy: { deep: 'classic-deep', allowOverride: true },
}]));
const persistent = join('${home}', '.config', 'TerMinal', 'persistent-agents', 'memory-owner');
mkdirSync(persistent, { recursive: true });
writeFileSync(join(persistent, 'agent.json'), JSON.stringify({
  id: 'memory-owner', title: 'Memory Owner', engine: 'claude', model: 'sonnet',
  modelPolicy: { deep: 'persistent-deep' }, tags: [], createdAt: 1, updatedAt: 1,
}));
writeFileSync(join(persistent, 'INSTRUCTIONS.md'), '# I');
writeFileSync(join(persistent, 'MEMORY.md'), '# M');
writeFileSync(join(persistent, 'STATE.md'), '# S');
writeFileSync(join(persistent, 'JOURNAL.md'), '# J');
const { ticketOwnerModelPolicy } = await import('./src/main/agents.ts');
console.log(JSON.stringify({
  classic: ticketOwnerModelPolicy(repo, { id: 'classic-owner', scope: 'repo', kind: 'classic' }),
  persistent: ticketOwnerModelPolicy(repo, { id: 'memory-owner', scope: 'global', kind: 'persistent' }),
  unknown: ticketOwnerModelPolicy(repo, { id: 'nobody', scope: 'repo', kind: 'classic' }),
  none: ticketOwnerModelPolicy(repo, undefined),
}));`,
      )
      expect(result.classic.policy.deep).toBe('classic-deep')
      expect(result.classic.engine).toBe('codex')
      expect(result.persistent.policy.deep).toBe('persistent-deep')
      // The persistent owner's plain model folds into the policy default slot.
      expect(result.persistent.policy.default).toBe('sonnet')
      expect(result.persistent.engine).toBe('claude')
      expect(result.unknown.policy).toBeUndefined()
      expect(result.none.policy).toBeUndefined()
      // Composes with resolveModel: a top-tier ticket owned by the persistent
      // agent launches its deep model (same engine), per the routing seam.
      expect(
        resolveModel({
          policy: result.persistent.policy,
          tier: 'top',
          engine: 'claude',
          policyEngine: result.persistent.engine,
        }),
      ).toBe('persistent-deep')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('readAgentRunContexts', () => {
  test('lists classic and persistent agents as selectable run contexts', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-agent-contexts-'))
    try {
      const contexts = run(
        home,
        `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} } }));
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = join('${home}', 'repo');
mkdirSync(join(repo, '.agents'), { recursive: true });
writeFileSync(join(repo, '.agents', 'agents.json'), JSON.stringify([{ id: 'custom-agent', title: 'Custom Agent', prompt: 'Custom guidance.', description: 'Repo custom.' }]));
const persistent = join('${home}', '.config', 'TerMinal', 'persistent-agents', 'memory-agent');
mkdirSync(persistent, { recursive: true });
writeFileSync(join(persistent, 'agent.json'), JSON.stringify({ id: 'memory-agent', title: 'Memory Agent', description: 'Persistent custom.', engine: 'claude', tags: [], createdAt: 1, updatedAt: 1 }));
writeFileSync(join(persistent, 'INSTRUCTIONS.md'), '# Instructions');
writeFileSync(join(persistent, 'MEMORY.md'), '# Memory');
writeFileSync(join(persistent, 'STATE.md'), '# State');
writeFileSync(join(persistent, 'JOURNAL.md'), '# Journal');
const { readAgentRunContexts } = await import('./src/main/agents.ts');
console.log(JSON.stringify(readAgentRunContexts(repo)));`,
      )
      expect(contexts.some((c: { id: string }) => c.id === 'agent:custom-agent')).toBe(true)
      expect(contexts.some((c: { id: string }) => c.id === 'persistent:memory-agent')).toBe(true)
      expect(contexts.find((c: { id: string }) => c.id === 'agent:custom-agent')?.prompt).toContain(
        'Custom guidance.',
      )
      expect(
        contexts.find((c: { id: string }) => c.id === 'persistent:memory-agent')?.prompt,
      ).toContain('Persistent agent memory home')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('listAgentDefinitions', () => {
  test('returns one schema for classic and persistent agents with model and quality policy', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-agent-definitions-'))
    try {
      const definitions = run(
        home,
        `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} } }));
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = join('${home}', 'repo');
mkdirSync(join(repo, '.agents'), { recursive: true });
writeFileSync(join(repo, '.agents', 'agents.json'), JSON.stringify([{
  id: 'quality-agent',
  title: 'Quality Agent',
  prompt: 'Ship carefully.',
  description: 'Repo quality.',
  model: 'claude-sonnet-4',
  modelPolicy: { cheap: 'claude-haiku-4', deep: 'claude-opus-4', judge: 'gpt-5-mini', allowOverride: false },
  quality: {
    acceptanceCriteria: ['Tests pass.'],
    requiredArtifacts: ['report.md'],
    deterministicChecks: [{ id: 'tests', title: 'Tests pass', command: 'bun test', required: true }],
    judge: { enabled: true, mode: 'hybrid', passThreshold: 90 }
  }
}]));
const persistent = join('${home}', '.config', 'TerMinal', 'persistent-agents', 'memory-agent');
mkdirSync(persistent, { recursive: true });
writeFileSync(join(persistent, 'agent.json'), JSON.stringify({ id: 'memory-agent', title: 'Memory Agent', description: 'Persistent custom.', engine: 'claude', model: 'claude-haiku-4', tags: ['memory'], createdAt: 1, updatedAt: 2, lastRunAt: 3 }));
writeFileSync(join(persistent, 'INSTRUCTIONS.md'), '# Instructions');
writeFileSync(join(persistent, 'MEMORY.md'), '# Memory');
writeFileSync(join(persistent, 'STATE.md'), '# State');
writeFileSync(join(persistent, 'JOURNAL.md'), '# Journal');
const { listAgentDefinitions } = await import('./src/main/agents.ts');
console.log(JSON.stringify(listAgentDefinitions(repo)));`,
      )
      const classic = definitions.find((d: { ref: { id: string } }) => d.ref.id === 'quality-agent')
      const codeReview = definitions.find(
        (d: { ref: { id: string } }) => d.ref.id === 'code-review',
      )
      const implementer = definitions.find(
        (d: { ref: { id: string } }) => d.ref.id === '1000x-ai-engineer',
      )
      const persistent = definitions.find(
        (d: { ref: { id: string } }) => d.ref.id === 'memory-agent',
      )
      expect(codeReview.kind).toBe('classic')
      expect(codeReview.quality.acceptanceCriteria.join('\n')).toContain(
        'Run the detected test suite',
      )
      expect(implementer.kind).toBe('classic')
      expect(implementer.runtime.engine).toBe('codex')
      expect(implementer.quality.judge.enabled).toBe(true)
      expect(implementer.instructions.outputContract).toContain('implementation PR')
      expect(classic.kind).toBe('classic')
      expect(classic.scope).toBe('repo')
      expect(classic.runtime.modelPolicy.cheap).toBe('claude-haiku-4')
      expect(classic.runtime.modelPolicy.allowOverride).toBe(false)
      expect(classic.quality.acceptanceCriteria).toContain('Tests pass.')
      expect(classic.quality.deterministicChecks[0].command).toBe('bun test')
      expect(classic.quality.judge.enabled).toBe(true)
      expect(persistent.kind).toBe('persistent')
      expect(persistent.runtime.mode).toBe('persistent')
      expect(persistent.instructions.knowledgePolicy).toBe('deep')
      expect(persistent.quality.requiredArtifacts).toContain('STATE.md')
      expect(persistent.metadata.tags).toContain('memory')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
