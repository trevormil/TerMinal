import { test, expect, describe } from 'bun:test'
import { hostRepoRoot, ensureRepoClonedCmd } from './host-repo'

describe('hostRepoRoot', () => {
  test('maps a Mac repo path to the host convention ~/repos/<name>', () => {
    expect(hostRepoRoot('/Users/t/code/TerMinal')).toBe('~/repos/TerMinal')
  })
  test('sanitizes the repo name to a safe token', () => {
    expect(hostRepoRoot('/tmp/weird name!')).toBe('~/repos/weird')
  })
})

describe('ensureRepoClonedCmd', () => {
  const c = ensureRepoClonedCmd('TerMinal', 'git@github.com:trevormil/TerMinal.git')
  test('clones into ~/repos/<name> only when absent (idempotent)', () => {
    expect(c).toContain('$HOME/repos/TerMinal/.git') // presence guard
    expect(c).toContain('git clone')
    expect(c).toContain('$HOME/repos/TerMinal')
  })
  test('carries the origin url', () => {
    expect(c).toContain('git@github.com:trevormil/TerMinal.git')
  })
  test('does not re-clone when the repo already exists', () => {
    // structural: the clone is guarded by the .git test, joined with ||
    expect(c).toMatch(/\[ -d .*\.git" \] \|\|/)
  })
})
