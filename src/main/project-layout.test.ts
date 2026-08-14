import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProjectLayout, existingProjectAreaPaths } from './project-layout'
import { clearRepoStateCache, repoStateAreaPath } from './repo-state'
import { MIGRATION_SUNSET } from '../shared/migration-sunset'

const repo = () => mkdtempSync(join(tmpdir(), 'layout-'))

const OPEN = new Date('2026-08-13T00:00:00Z')
const CLOSED = new Date(`${MIGRATION_SUNSET}T00:00:00Z`)

describe('detectProjectLayout', () => {
  test('a clean repo is v2 — no marker required', () => {
    // The template ships no .TerMinal at all; a fresh scaffold and a
    // collaborator's clone of a fully-migrated repo must both read v2.
    expect(detectProjectLayout(repo())).toBe('v2')
  })

  test('the legacy marker still forces v2', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal'), { recursive: true })
    writeFileSync(join(r, '.TerMinal', 'template.json'), '{"version":2}')
    expect(detectProjectLayout(r)).toBe('v2')
  })

  test('root-level v1 state dirs are the only thing that reads v1', () => {
    const r = repo()
    mkdirSync(join(r, 'backlog'), { recursive: true })
    expect(detectProjectLayout(r)).toBe('v1')
  })

  test('v2 state dirs win over v1 leftovers', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal', 'backlog'), { recursive: true })
    mkdirSync(join(r, 'backlog'), { recursive: true })
    expect(detectProjectLayout(r)).toBe('v2')
  })
})

describe('area reads stop merging the repo after the migration sunset', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'layout-state-'))
    process.env.TERMINAL_REPO_STATE_DIR = stateDir
    clearRepoStateCache()
  })

  afterEach(() => {
    delete process.env.TERMINAL_REPO_STATE_DIR
    clearRepoStateCache()
  })

  test('an unmigrated v2 backlog is merged while the window is open', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal', 'backlog'), { recursive: true })
    expect(existingProjectAreaPaths(r, 'backlog', OPEN)).toEqual([join(r, '.TerMinal', 'backlog')])
  })

  test('the SAME repo reads as empty once the window closes', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal', 'backlog'), { recursive: true })
    mkdirSync(join(r, 'backlog'), { recursive: true }) // v1 leftovers too
    expect(existingProjectAreaPaths(r, 'backlog', CLOSED)).toEqual([])
  })

  test('the sidecar copy is still returned after the sunset', () => {
    const r = repo()
    const sidecar = repoStateAreaPath(r, 'backlog')
    mkdirSync(sidecar, { recursive: true })
    mkdirSync(join(r, '.TerMinal', 'backlog'), { recursive: true })
    expect(existingProjectAreaPaths(r, 'backlog', CLOSED)).toEqual([sidecar])
  })

  test('agents is NOT a sidecar area — it lives in the repo forever', () => {
    // .agents/ is a shared contract, like CI config. Sunsetting the legacy
    // read must not make the agent roster disappear.
    const r = repo()
    mkdirSync(join(r, '.agents'), { recursive: true })
    expect(existingProjectAreaPaths(r, 'agents', CLOSED)).toEqual([join(r, '.agents')])
  })
})
