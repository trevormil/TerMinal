import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  lstatSync,
  readlinkSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installTmPlugin, tmPluginStatus } from './plugin-install'

let tmp: string
let src: string
let cfg: string
let skills: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tm-plugin-test-'))
  src = join(tmp, 'src-plugin')
  cfg = join(tmp, 'config')
  skills = join(tmp, 'claude-skills')
  mkdirSync(join(src, '.claude-plugin'), { recursive: true })
  mkdirSync(join(src, 'skills', 'ticket'), { recursive: true })
  writeFileSync(
    join(src, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'tm', version: '0.1.0' }),
  )
  writeFileSync(join(src, 'skills', 'ticket', 'SKILL.md'), '---\nname: ticket\n---\n')
  mkdirSync(cfg, { recursive: true })
  mkdirSync(skills, { recursive: true })
})

afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('installTmPlugin', () => {
  test('copies the plugin to config dir and symlinks ~/.claude/skills/tm', () => {
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.version).toBe('0.1.0')
    expect(readFileSync(join(cfg, 'plugin', 'skills', 'ticket', 'SKILL.md'), 'utf8')).toContain(
      'name: ticket',
    )
    const link = join(skills, 'tm')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(cfg, 'plugin'))
  })

  test('is idempotent and refreshes stale content', () => {
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    writeFileSync(join(src, 'skills', 'ticket', 'SKILL.md'), '---\nname: ticket\n---\nupdated\n')
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(true)
    expect(readFileSync(join(cfg, 'plugin', 'skills', 'ticket', 'SKILL.md'), 'utf8')).toContain(
      'updated',
    )
  })

  test('removes files deleted from the source on reinstall', () => {
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    rmSync(join(src, 'skills', 'ticket'), { recursive: true })
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(existsSync(join(cfg, 'plugin', 'skills', 'ticket'))).toBe(false)
  })

  test('repoints an existing symlink with a different target', () => {
    symlinkSync(join(tmp, 'elsewhere'), join(skills, 'tm'))
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(true)
    expect(readlinkSync(join(skills, 'tm'))).toBe(join(cfg, 'plugin'))
  })

  test('refuses to replace a real directory named tm', () => {
    mkdirSync(join(skills, 'tm'))
    writeFileSync(join(skills, 'tm', 'SKILL.md'), 'user skill')
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('not a symlink')
    expect(readFileSync(join(skills, 'tm', 'SKILL.md'), 'utf8')).toBe('user skill')
  })

  test('errors on a source missing the plugin manifest', () => {
    const res = installTmPlugin(join(tmp, 'nope'), { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(false)
  })
})

describe('codex sync (vendor-agnostic adapter)', () => {
  test('installs skills as ~/.codex/skills/tm-<name> with plugin root resolved', () => {
    const codex = join(tmp, 'codex-skills')
    writeFileSync(
      join(src, 'skills', 'ticket', 'SKILL.md'),
      '---\nname: ticket\ndescription: d\n---\nRun ${CLAUDE_PLUGIN_ROOT}/bin/activity\n',
    )
    const res = installTmPlugin(src, {
      configDir: cfg,
      claudeSkillsDir: skills,
      codexSkillsDir: codex,
    })
    expect(res.ok).toBe(true)
    const out = readFileSync(join(codex, 'tm-ticket', 'SKILL.md'), 'utf8')
    expect(out).toContain('name: tm-ticket')
    expect(out).toContain(`${join(cfg, 'plugin')}/bin/activity`)
    expect(out).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  test('removes stale tm-* dirs but never touches foreign skills', () => {
    const codex = join(tmp, 'codex-skills')
    mkdirSync(join(codex, 'tm-oldskill'), { recursive: true })
    mkdirSync(join(codex, 'user-skill'), { recursive: true })
    writeFileSync(join(codex, 'user-skill', 'SKILL.md'), 'mine')
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills, codexSkillsDir: codex })
    expect(existsSync(join(codex, 'tm-oldskill'))).toBe(false)
    expect(readFileSync(join(codex, 'user-skill', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  test('sweeps crash-leftover staging dirs from dead pids; leaves stray tm-* files alone', () => {
    const codex = join(tmp, 'codex-skills')
    mkdirSync(join(codex, 'tm-ticket.staging-999999999'), { recursive: true })
    writeFileSync(join(codex, 'tm-notes.md'), 'user file')
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills, codexSkillsDir: codex })
    expect(existsSync(join(codex, 'tm-ticket.staging-999999999'))).toBe(false)
    expect(readFileSync(join(codex, 'tm-notes.md'), 'utf8')).toBe('user file')
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills, codexSkillsDir: codex })
    expect(st.codexSkills).toBe(1)
  })

  test('skips codex sync when no codex dir parent exists', () => {
    // homedir has no ~/.codex → adapter should no-op rather than create one
    const res = installTmPlugin(src, {
      configDir: cfg,
      claudeSkillsDir: skills,
      codexSkillsDir: join(tmp, 'no-codex-here', 'skills'),
    })
    expect(res.ok).toBe(true)
    expect(existsSync(join(tmp, 'no-codex-here'))).toBe(false)
  })
})

describe('tmPluginStatus', () => {
  test('reports not installed before install', () => {
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills })
    expect(st.installed).toBe(false)
    expect(st.linked).toBe(false)
  })

  test('reports version, link, and codex sync after install', () => {
    const codex = join(tmp, 'codex-skills')
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills, codexSkillsDir: codex })
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills, codexSkillsDir: codex })
    expect(st.installed).toBe(true)
    expect(st.version).toBe('0.1.0')
    expect(st.linked).toBe(true)
    expect(st.path).toBe(join(cfg, 'plugin'))
    expect(st.codexSkills).toBe(1)
  })
})
