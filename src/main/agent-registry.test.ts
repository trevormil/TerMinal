import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasAgents, locateScript, readAgents, resetAgent, saveAgent } from './agent-registry'
import { saveGlobalAgent } from './agents-global'
import { DEFAULT_AGENTS } from './agent-catalog'

// Ticket 91: the agent definition registry (read/merge/save/reset of Agent
// entries across the default → global → repo layers) extracted from the
// 1,900-line agents.ts runtime. This is the first direct test of the layering
// logic — it was untestable in place because importing agents.ts drags in the
// whole spawn runtime and, transitively, electron.

let cfg = ''
let repo = ''
const realDir = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'tm-agent-registry-cfg-'))
  repo = mkdtempSync(join(tmpdir(), 'tm-agent-registry-repo-'))
  process.env.TERMINAL_CONFIG_DIR = cfg
})

afterEach(() => {
  rmSync(cfg, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
  if (realDir === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realDir
})

const byId = (id: string) => readAgents(repo).find((a) => a.id === id)

describe('readAgents layering', () => {
  test('defaults come through with source "default"', () => {
    const first = DEFAULT_AGENTS[0]
    const got = byId(first.id)
    expect(got).toBeDefined()
    expect(got?.source).toBe('default')
  })

  test('a global agent layers over defaults and labels its source', () => {
    expect(saveGlobalAgent({ id: 'g-agent', title: 'Global', prompt: 'do it' })).toEqual({
      ok: true,
    })
    expect(byId('g-agent')?.source).toBe('global')
  })

  test('a repo agent overriding a global one wins field-by-field and reads as repo-override', () => {
    saveGlobalAgent({ id: 'shared', title: 'Global title', prompt: 'global prompt', icon: 'Bot' })
    expect(saveAgent(repo, { id: 'shared', title: 'Repo title', prompt: 'repo prompt' })).toEqual({
      ok: true,
    })
    const got = byId('shared')
    expect(got?.source).toBe('repo-override')
    expect(got?.title).toBe('Repo title')
    // A field the repo layer does not set survives from the lower layer.
    expect(got?.icon).toBe('Bot')
  })

  test('a script-only agent is discovered from a bare .sh with sidecar metadata', () => {
    const dir = join(repo, '.agents')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'script-guy.sh'), '#!/bin/bash\necho hi\n')
    writeFileSync(join(dir, 'script-guy.json'), JSON.stringify({ title: 'Script Guy' }))
    const got = byId('script-guy')
    expect(got?.title).toBe('Script Guy')
    expect(got?.hasScript).toBe(true)
    expect(locateScript(repo, 'script-guy')).toBe(join(dir, 'script-guy.sh'))
  })
})

describe('saveAgent / resetAgent', () => {
  test('save preserves every optional field the old duplicate used to drop (#78)', () => {
    const res = saveAgent(repo, {
      id: 'full',
      title: 'Full',
      prompt: 'p',
      model: 'claude-fable-5',
      modelPolicy: 'auto',
      quality: { checks: [] },
      outputContract: 'a contract',
      acceptanceCriteria: ['done'],
      force: true,
    } as Parameters<typeof saveAgent>[1])
    expect(res).toEqual({ ok: true })
    const persisted = JSON.parse(readFileSync(join(repo, '.agents', 'agents.json'), 'utf8'))
    const entry = persisted.find((a: { id: string }) => a.id === 'full')
    expect(entry.model).toBe('claude-fable-5')
    expect(entry.modelPolicy).toBe('auto')
    expect(entry.quality).toEqual({ checks: [] })
    expect(entry.outputContract).toBe('a contract')
    expect(entry.acceptanceCriteria).toEqual(['done'])
    expect(entry.force).toBe(true)
  })

  test('save rejects a non-kebab id and an empty repoRoot', () => {
    expect('error' in saveAgent(repo, { id: 'Bad Id', title: 't', prompt: 'p' })).toBe(true)
    expect('error' in saveAgent('', { id: 'ok-id', title: 't', prompt: 'p' })).toBe(true)
  })

  test('reset removes a repo override so the default shows through again', () => {
    const target = DEFAULT_AGENTS[0]
    saveAgent(repo, { id: target.id, title: 'Customized', prompt: 'custom' })
    expect(byId(target.id)?.source).toBe('repo-override')
    expect(resetAgent(repo, target.id)).toEqual({ ok: true })
    expect(byId(target.id)?.source).toBe('default')
    expect(byId(target.id)?.title).toBe(target.title)
  })
})

describe('hasAgents', () => {
  test('every git repo has the defaults; no repo root means none', () => {
    expect(hasAgents(repo)).toBe(true)
    expect(hasAgents('')).toBe(false)
  })
})
