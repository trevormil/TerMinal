import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const run = (home: string, code: string) => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

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
