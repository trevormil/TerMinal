import { test, expect, describe } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, pluginNamespaceFromSkillPath } from './skills'

describe('pluginNamespaceFromSkillPath', () => {
  const cache = '/Users/x/.claude/plugins/cache'
  test('derives the plugin namespace (segment above the version dir)', () => {
    expect(
      pluginNamespaceFromSkillPath(
        `${cache}/compound-engineering-plugin/compound-engineering/3.8.3/skills/ce-debug/SKILL.md`,
      ),
    ).toBe('compound-engineering')
    expect(
      pluginNamespaceFromSkillPath(`${cache}/bitbadges/bitbadges/0.1.0/skills/build/SKILL.md`),
    ).toBe('bitbadges')
    expect(
      pluginNamespaceFromSkillPath(
        `${cache}/claude-plugins-official/frontend-design/unknown/skills/frontend-design/SKILL.md`,
      ),
    ).toBe('frontend-design')
    expect(
      pluginNamespaceFromSkillPath(
        `${cache}/claude-code-toolkit/nopeek/0.0.23/skills/nopeek/SKILL.md`,
      ),
    ).toBe('nopeek')
  })
})

describe('listSkills', () => {
  test('merges mirrored project skills across Claude, Codex, and Cursor', () => {
    const repo = mkdtempSync(join(tmpdir(), 'terminal-skills-'))
    for (const platform of ['.claude', '.codex', '.cursor']) {
      const dir = join(repo, platform, 'skills', 'mirror-test')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'SKILL.md'),
        '---\nname: mirror-test\ndescription: mirrored skill\n---\n# mirror-test\n',
      )
    }

    const skill = listSkills(repo).find((s) => s.scope === 'project' && s.name === 'mirror-test')

    expect(skill?.description).toBe('mirrored skill')
    expect(skill?.platforms).toEqual(['claude', 'codex', 'cursor'])
  })

  // TerMinal used to carry its workflow skills twice — once in plugin/skills,
  // again as a hand-synced .codex/skills mirror. Both harnesses now load them
  // globally from the plugin, so the repo carries no copy at all. This repo has
  // to hold itself to that before asking any other repo to.
  test('this repo carries no per-repo workflow skill copies', () => {
    const projectSkills = listSkills(process.cwd()).filter((s) => s.scope === 'project')
    for (const name of ['ticket', 'new-agent', 'new-schedule', 'code-review', 'session-start'])
      expect(projectSkills.find((s) => s.name === name)).toBeUndefined()
  })

  test('the skills it ships live in exactly one place', () => {
    const pluginSkills = readdirSync(join(process.cwd(), 'plugin', 'skills'), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    expect(pluginSkills).toContain('ticket')
    expect(existsSync(join(process.cwd(), '.codex', 'skills'))).toBe(false)
    expect(existsSync(join(process.cwd(), '.claude', 'skills'))).toBe(false)
  })
})
