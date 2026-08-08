import { describe, expect, test } from 'bun:test'
import { BOOTSTRAP_MARKER_LABELS, classifyBootstrapStatus } from './bootstrap'

describe('classifyBootstrapStatus', () => {
  test('full when all project-template markers exist', () => {
    const status = classifyBootstrapStatus('/repo', () => true)
    expect(status.state).toBe('full')
    expect(status.bootstrapped).toBe(true)
    expect(status.missing).toEqual([])
  })

  test('none when no markers exist', () => {
    const status = classifyBootstrapStatus('/repo', () => false)
    expect(status.state).toBe('none')
    expect(status.bootstrapped).toBe(false)
    expect(status.missing).toEqual([...BOOTSTRAP_MARKER_LABELS])
  })

  // The markers must describe what bootstrap LEAVES in a repo. Workflow state
  // moved to the per-project sidecar, skills moved to the global plugin, and
  // the default script agents moved to the global scripts dir — so a fully
  // bootstrapped repo carries only the docs skeleton (plus repo-owned config
  // files that make poor markers: CI and CLAUDE.md predate TerMinal in many
  // repos).
  test('a fully migrated repo with only docs reads as full', () => {
    const present = new Set(['docs'])
    const status = classifyBootstrapStatus('/repo', (rel) => present.has(rel))
    expect(status.state).toBe('full')
    expect(status.bootstrapped).toBe(true)
  })

  test('legacy .agents and in-repo state neither help nor hurt', () => {
    const legacy = new Set(['.agents', 'backlog', 'sessions', '.codex/skills', '.claude/skills'])
    const status = classifyBootstrapStatus('/repo', (rel) => legacy.has(rel))
    expect(status.state).toBe('none')
  })

  test('unreadable marker checks are treated as missing', () => {
    const status = classifyBootstrapStatus('/repo', () => {
      throw new Error('EACCES')
    })
    expect(status.state).toBe('none')
    expect(status.missing).toContain('docs')
  })

  test('missing repo input returns none', () => {
    const status = classifyBootstrapStatus('', () => true)
    expect(status.state).toBe('none')
    expect(status.bootstrapped).toBe(false)
  })
})
