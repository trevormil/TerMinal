import { describe, expect, test } from 'bun:test'
import { rewriteCodexSkillSubmit } from './codexSkillInput'

describe('rewriteCodexSkillSubmit', () => {
  const skills = new Set(['ticket', 'code-review'])

  test('rewrites installed slash skills to codex skill mentions', () => {
    expect(rewriteCodexSkillSubmit('/ticket test ticket', skills)).toBe('$ticket test ticket\r')
    expect(rewriteCodexSkillSubmit('/code-review', skills)).toBe('$code-review\r')
  })

  test('leaves non-skill slash commands alone', () => {
    expect(rewriteCodexSkillSubmit('/help', skills)).toBeNull()
    expect(rewriteCodexSkillSubmit('file a ticket', skills)).toBeNull()
  })
})
