import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentContract, listAgentContracts, pluginAgentsDir } from './agent-contracts'

// Contracts layer repo-over-plugin, the same way agent scripts already do.
// The point is that a repo which never customized anything carries none of
// them, while a repo that DID customize one keeps winning — silently losing a
// team's edited contract would be far worse than the duplication this removes.

let tmp: string
let repo: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-contracts-'))
  repo = join(tmp, 'repo')
  mkdirSync(join(repo, '.agents'), { recursive: true })
  process.env.TERMINAL_CONFIG_DIR = join(tmp, 'config')
  mkdirSync(pluginAgentsDir(), { recursive: true })
})

afterEach(() => {
  delete process.env.TERMINAL_CONFIG_DIR
  rmSync(tmp, { recursive: true, force: true })
})

const shipDefault = (kind: string, body = '# default\n') =>
  writeFileSync(join(pluginAgentsDir(), `${kind}.md`), body)
const repoOverride = (kind: string, body = '# ours\n') =>
  writeFileSync(join(repo, '.agents', `${kind}.md`), body)

describe('agentContract', () => {
  test('falls back to the shipped default when the repo has none', () => {
    shipDefault('drift')
    const c = agentContract(repo, 'drift')
    expect(c?.source).toBe('plugin')
    expect(c?.path).toBe(join(pluginAgentsDir(), 'drift.md'))
  })

  test("a repo's own contract wins", () => {
    shipDefault('drift')
    repoOverride('drift')
    const c = agentContract(repo, 'drift')
    expect(c?.source).toBe('repo')
    expect(c?.path).toBe(join(repo, '.agents', 'drift.md'))
  })

  test('null when neither layer has it, rather than a path that does not exist', () => {
    expect(agentContract(repo, 'nonexistent')).toBeNull()
  })

  test('resolves with no repo at all — global agents still have contracts', () => {
    shipDefault('health')
    expect(agentContract('', 'health')?.source).toBe('plugin')
  })

  // `kind` reaches this from agent ids and, via the CLI, from user input.
  test.each(['../secrets', 'a/b', '.hidden', '', 'a\\b'])(
    'refuses a kind that could escape the directory: %p',
    (kind) => {
      expect(agentContract(repo, kind)).toBeNull()
    },
  )
})

describe('listAgentContracts', () => {
  test('unions both layers, with the repo overriding by kind', () => {
    shipDefault('drift')
    shipDefault('health')
    repoOverride('drift')
    repoOverride('house-style')

    const all = listAgentContracts(repo)

    expect([...all.keys()].sort()).toEqual(['drift', 'health', 'house-style'])
    expect(all.get('drift')?.source).toBe('repo')
    expect(all.get('health')?.source).toBe('plugin')
    expect(all.get('house-style')?.source).toBe('repo')
  })

  test('is empty rather than throwing when the plugin is not installed yet', () => {
    rmSync(pluginAgentsDir(), { recursive: true, force: true })
    expect([...listAgentContracts(repo).keys()]).toEqual([])
  })

  test('ignores non-markdown siblings — .sh and .json are not contracts', () => {
    shipDefault('drift')
    writeFileSync(join(repo, '.agents', 'drift.sh'), '#!/bin/sh\n')
    writeFileSync(join(repo, '.agents', 'drift.json'), '{}')
    writeFileSync(join(repo, '.agents', 'owned.yml'), 'x: 1\n')

    expect([...listAgentContracts(repo).keys()]).toEqual(['drift'])
  })
})
