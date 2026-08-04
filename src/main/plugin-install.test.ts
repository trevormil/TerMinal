import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, lstatSync, readlinkSync, existsSync, symlinkSync } from 'node:fs'
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
  writeFileSync(join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tm', version: '0.1.0' }))
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
    expect(readFileSync(join(cfg, 'plugin', 'skills', 'ticket', 'SKILL.md'), 'utf8')).toContain('name: ticket')
    const link = join(skills, 'tm')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(cfg, 'plugin'))
  })

  test('is idempotent and refreshes stale content', () => {
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    writeFileSync(join(src, 'skills', 'ticket', 'SKILL.md'), '---\nname: ticket\n---\nupdated\n')
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(true)
    expect(readFileSync(join(cfg, 'plugin', 'skills', 'ticket', 'SKILL.md'), 'utf8')).toContain('updated')
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
    expect(res.error).toContain('tm')
    expect(readFileSync(join(skills, 'tm', 'SKILL.md'), 'utf8')).toBe('user skill')
  })

  test('errors on a source missing the plugin manifest', () => {
    const res = installTmPlugin(join(tmp, 'nope'), { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(false)
  })
})

describe('tmPluginStatus', () => {
  test('reports not installed before install', () => {
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills })
    expect(st.installed).toBe(false)
    expect(st.linked).toBe(false)
  })

  test('reports version and link after install', () => {
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills })
    expect(st.installed).toBe(true)
    expect(st.version).toBe('0.1.0')
    expect(st.linked).toBe(true)
    expect(st.path).toBe(join(cfg, 'plugin'))
  })
})
