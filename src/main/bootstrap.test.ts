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

  test('partial lists missing markers', () => {
    const present = new Set(['.agents'])
    const status = classifyBootstrapStatus('/repo', (rel) => present.has(rel))
    expect(status.state).toBe('partial')
    expect(status.bootstrapped).toBe(false)
    expect(status.missing).toEqual(['docs'])
    expect(status.message).toContain('partially bootstrapped')
  })

  // The markers must describe what bootstrap LEAVES in a repo. Workflow state
  // moved to the per-project sidecar and skills moved to the global plugin, so
  // a repo that is fully bootstrapped AND fully migrated has neither backlog/
  // nor sessions/ nor any skills dir — requiring them reported exactly the
  // repos that had done everything right as "partially bootstrapped".
  test('a fully migrated repo with no in-repo state or skills reads as full', () => {
    const present = new Set(['.agents', 'docs'])
    const status = classifyBootstrapStatus('/repo', (rel) => present.has(rel))
    expect(status.state).toBe('full')
    expect(status.bootstrapped).toBe(true)
  })

  test('in-repo state and skill dirs neither help nor hurt', () => {
    const legacy = new Set(['backlog', 'sessions', '.codex/skills', '.claude/skills'])
    const status = classifyBootstrapStatus('/repo', (rel) => legacy.has(rel))
    expect(status.state).toBe('none')
  })

  test('unreadable marker checks are treated as missing', () => {
    const status = classifyBootstrapStatus('/repo', (rel) => {
      if (rel === '.agents') return true
      throw new Error('EACCES')
    })
    expect(status.state).toBe('partial')
    expect(status.missing).toContain('docs')
  })

  test('missing repo input returns none', () => {
    const status = classifyBootstrapStatus('', () => true)
    expect(status.state).toBe('none')
    expect(status.bootstrapped).toBe(false)
  })
})
