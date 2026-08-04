import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Installs the tm plugin globally: copy the bundled plugin/ tree to the stable
// ~/.config/TerMinal/plugin path, then expose it to Claude Code as a
// skills-dir plugin via a ~/.claude/skills/tm symlink (auto-loads in every
// session as tm@skills-dir, skills namespaced /tm:*). Replaces the old
// per-repo bootstrap copies of skills/hooks/bin.

export type PluginPaths = { configDir?: string; claudeSkillsDir?: string }
export type PluginInstallResult = { ok: true; version: string } | { ok: false; error: string }
export type PluginStatus = { installed: boolean; linked: boolean; version?: string; path?: string }

function resolvePaths(opts?: PluginPaths): { configDir: string; claudeSkillsDir: string } {
  return {
    configDir: opts?.configDir ?? join(homedir(), '.config', 'TerMinal'),
    claudeSkillsDir: opts?.claudeSkillsDir ?? join(homedir(), '.claude', 'skills'),
  }
}

function readVersion(pluginDir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function installTmPlugin(srcDir: string, opts?: PluginPaths): PluginInstallResult {
  const { configDir, claudeSkillsDir } = resolvePaths(opts)
  const manifest = join(srcDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return { ok: false, error: `plugin source missing manifest: ${manifest}` }
  const version = readVersion(srcDir)
  if (!version) return { ok: false, error: `unreadable plugin.json version in ${srcDir}` }

  const dest = join(configDir, 'plugin')
  const staging = `${dest}.staging`
  try {
    // Stage + swap so a Claude session never reads a half-copied tree.
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
    cpSync(srcDir, staging, { recursive: true })
    rmSync(dest, { recursive: true, force: true })
    renameSync(staging, dest)
  } catch (e) {
    rmSync(staging, { recursive: true, force: true })
    return { ok: false, error: `plugin copy failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const link = join(claudeSkillsDir, 'tm')
  try {
    mkdirSync(claudeSkillsDir, { recursive: true })
    let st
    try {
      st = lstatSync(link)
    } catch {
      st = null
    }
    if (st) {
      if (!st.isSymbolicLink()) {
        // A real ~/.claude/skills/tm is the user's own — never overwrite it.
        return { ok: false, error: `~/.claude/skills/tm exists and is not a symlink — move it aside to enable the tm plugin` }
      }
      if (readlinkSync(link) !== dest) rmSync(link)
    }
    if (!existsSync(link)) symlinkSync(dest, link)
  } catch (e) {
    return { ok: false, error: `plugin symlink failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  return { ok: true, version }
}

export function tmPluginStatus(opts?: PluginPaths): PluginStatus {
  const { configDir, claudeSkillsDir } = resolvePaths(opts)
  const dest = join(configDir, 'plugin')
  const installed = existsSync(join(dest, '.claude-plugin', 'plugin.json'))
  let linked = false
  try {
    const link = join(claudeSkillsDir, 'tm')
    linked = lstatSync(link).isSymbolicLink() && readlinkSync(link) === dest
  } catch {
    /* not linked */
  }
  if (!installed) return { installed: false, linked }
  return { installed, linked, version: readVersion(dest), path: dest }
}
