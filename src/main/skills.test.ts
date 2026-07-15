import { test, expect, describe } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
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

  test('sees this repo workflow skills as Claude/Codex mirrors', () => {
    const skills = listSkills(process.cwd()).filter((s) => s.scope === 'project')
    const ticket = skills.find((s) => s.name === 'ticket')
    const newAgent = skills.find((s) => s.name === 'new-agent')
    const newSchedule = skills.find((s) => s.name === 'new-schedule')

    expect(ticket?.platforms).toEqual(['claude', 'codex'])
    expect(newAgent?.platforms).toEqual(['claude', 'codex'])
    expect(newSchedule?.platforms).toEqual(['claude', 'codex'])
  })

  test('keeps this repo Claude and Codex skill mirrors in lockstep', () => {
    const skillNames = (platform: '.claude' | '.codex') =>
      readdirSync(join(process.cwd(), platform, 'skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()

    expect(skillNames('.claude')).toEqual(skillNames('.codex'))
  })
})
