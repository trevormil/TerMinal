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
import { homedir, tmpdir } from 'node:os'
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

describe('path seam: defaults never reach the real home under test', () => {
  // syncCodexSkills deletes managed tm-* dirs, so a caller that omits a path
  // must land in the throwaway dirs set by src/test-preload.ts. Forgetting one
  // here previously destroyed 34 skills in the developer's ~/.codex/skills.
  test('omitting every path writes only inside the test overrides', () => {
    const res = installTmPlugin(src, { configDir: cfg })
    expect(res.ok).toBe(true)
    const home = homedir()
    for (const key of [
      'TERMINAL_CLAUDE_SKILLS_DIR',
      'TERMINAL_CODEX_SKILLS_DIR',
      'TERMINAL_CLAUDE_PLUGINS_DIR',
    ]) {
      expect(process.env[key]).toBeDefined()
      expect(process.env[key]!.startsWith(join(home, '.claude'))).toBe(false)
      expect(process.env[key]!.startsWith(join(home, '.codex'))).toBe(false)
    }
    // and the install really did land in the override, not the real home
    expect(existsSync(join(process.env.TERMINAL_CLAUDE_SKILLS_DIR!, 'tm'))).toBe(true)
  })
})

describe('tmPluginStatus shadowing detection', () => {
  // Installing tm from the marketplace AND running the app puts two plugins
  // named tm on the machine; Claude loads the marketplace copy and silently
  // ignores ~/.claude/skills/tm, which would otherwise leave Settings claiming
  // "linked" while Sync does nothing the user can see.
  const writeRegistry = (pluginsDir: string, entry: string) => {
    mkdirSync(pluginsDir, { recursive: true })
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { [entry]: [{ scope: 'user' }] } }),
    )
  }

  test('reports the competing install that takes precedence', () => {
    const pluginsDir = join(tmp, 'claude-plugins')
    writeRegistry(pluginsDir, 'tm@terminal')
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills, pluginsDir })
    expect(st.linked).toBe(true)
    expect(st.shadowedBy).toBe('tm@terminal')
  })

  test('no shadowing reported for unrelated installed plugins', () => {
    const pluginsDir = join(tmp, 'claude-plugins')
    writeRegistry(pluginsDir, 'compound-engineering@every')
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    const st = tmPluginStatus({ configDir: cfg, claudeSkillsDir: skills, pluginsDir })
    expect(st.shadowedBy).toBeUndefined()
  })

  test('no registry file is not an error', () => {
    installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    const st = tmPluginStatus({
      configDir: cfg,
      claudeSkillsDir: skills,
      pluginsDir: join(tmp, 'nope'),
    })
    expect(st.shadowedBy).toBeUndefined()
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

// Skills instruct the MODEL to run `tm-state-dir reviews` when the injected
// vars are absent — bare, as a command. That only resolves if the plugin's
// resolvers are on PATH. They were not, anywhere: the app prepends
// <config>/bin (terminal-cli and friends), while the resolvers lived only in
// <config>/plugin/bin. So the documented fallback was "command not found", and
// an agent following it wrote to whatever the shell resolved instead.
describe('the state resolvers are reachable as commands', () => {
  const resolvers = ['tm-state-dir', 'tm-state-dirs', 'tm-agent-spec']

  beforeEach(() => {
    mkdirSync(join(src, 'bin'), { recursive: true })
    for (const r of resolvers) writeFileSync(join(src, 'bin', r), '#!/usr/bin/env bash\necho ok\n')
  })

  test('installing links them into the bin dir the app puts on PATH', () => {
    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })
    expect(res.ok).toBe(true)
    for (const r of resolvers) {
      const linked = join(cfg, 'bin', r)
      expect(existsSync(linked)).toBe(true)
      // Resolves to the installed plugin, so a plugin update is picked up
      // without relinking.
      expect(readlinkSync(linked)).toBe(join(cfg, 'plugin', 'bin', r))
    }
  })

  test('re-installing repoints a stale link instead of failing', () => {
    mkdirSync(join(cfg, 'bin'), { recursive: true })
    symlinkSync(join(tmp, 'somewhere-else'), join(cfg, 'bin', 'tm-state-dir'))

    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })

    expect(res.ok).toBe(true)
    expect(readlinkSync(join(cfg, 'bin', 'tm-state-dir'))).toBe(
      join(cfg, 'plugin', 'bin', 'tm-state-dir'),
    )
  })

  test("a real file of the user's is never clobbered", () => {
    mkdirSync(join(cfg, 'bin'), { recursive: true })
    writeFileSync(join(cfg, 'bin', 'tm-state-dir'), '#!/bin/sh\n# mine\n')

    const res = installTmPlugin(src, { configDir: cfg, claudeSkillsDir: skills })

    expect(res.ok).toBe(true)
    expect(readFileSync(join(cfg, 'bin', 'tm-state-dir'), 'utf8')).toContain('# mine')
  })
})
