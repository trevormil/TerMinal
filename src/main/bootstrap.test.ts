import { describe, expect, test } from 'bun:test'
import { BOOTSTRAP_MARKERS, classifyBootstrapStatus } from './bootstrap'

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
    expect(status.missing).toEqual([...BOOTSTRAP_MARKERS])
  })

  test('partial lists missing markers', () => {
    const present = new Set(['.agents', 'backlog'])
    const status = classifyBootstrapStatus('/repo', (rel) => present.has(rel))
    expect(status.state).toBe('partial')
    expect(status.bootstrapped).toBe(false)
    expect(status.missing).toEqual(['docs', 'sessions', '.claude/skills', '.codex/skills'])
    expect(status.message).toContain('partially bootstrapped')
  })

  test('unreadable marker checks are treated as missing', () => {
    const status = classifyBootstrapStatus('/repo', (rel) => {
      if (rel === '.agents') return true
      throw new Error('EACCES')
    })
    expect(status.state).toBe('partial')
    expect(status.missing).toContain('backlog')
  })

  test('missing repo input returns none', () => {
    const status = classifyBootstrapStatus('', () => true)
    expect(status.state).toBe('none')
    expect(status.bootstrapped).toBe(false)
  })
})
