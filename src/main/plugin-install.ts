import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { terminalConfigDir } from './config-dir'

// Installs the tm plugin globally: copy the bundled plugin/ tree to the stable
// ~/.config/TerMinal/plugin path, then expose it to Claude Code as a
// skills-dir plugin via a ~/.claude/skills/tm symlink (auto-loads in every
// session as tm@skills-dir, skills namespaced /tm:*). Replaces the old
// per-repo bootstrap copies of skills/hooks/bin.

export type PluginPaths = { configDir?: string; claudeSkillsDir?: string; codexSkillsDir?: string }
export type PluginInstallResult = { ok: true; version: string } | { ok: false; error: string }
export type PluginStatus = {
  installed: boolean
  linked: boolean
  version?: string
  path?: string
  codexSkills?: number
}

function resolvePaths(opts?: PluginPaths): {
  configDir: string
  claudeSkillsDir: string
  codexSkillsDir: string
} {
  return {
    configDir: opts?.configDir ?? terminalConfigDir(),
    claudeSkillsDir: opts?.claudeSkillsDir ?? join(homedir(), '.claude', 'skills'),
    codexSkillsDir: opts?.codexSkillsDir ?? join(homedir(), '.codex', 'skills'),
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
  const { configDir, claudeSkillsDir, codexSkillsDir } = resolvePaths(opts)
  const manifest = join(srcDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return { ok: false, error: `plugin source missing manifest: ${manifest}` }
  const version = readVersion(srcDir)
  if (!version) return { ok: false, error: `unreadable plugin.json version in ${srcDir}` }

  const dest = join(configDir, 'plugin')
  // pid-suffixed staging so concurrent installs (launch + Settings sync) never
  // interleave writes into the same staging tree.
  const staging = `${dest}.staging-${process.pid}`
  const old = `${dest}.old-${process.pid}`
  try {
    // Stage, then swap via two renames so the path a running Claude session
    // resolves through ~/.claude/skills/tm is only ever a complete tree — the
    // gap is between two rename syscalls, not a full recursive delete.
    rmSync(staging, { recursive: true, force: true })
    rmSync(old, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
    cpSync(srcDir, staging, { recursive: true })
    if (existsSync(dest)) renameSync(dest, old)
    renameSync(staging, dest)
    rmSync(old, { recursive: true, force: true })
  } catch (e) {
    // Roll the old tree back if the swap died between the renames.
    if (!existsSync(dest) && existsSync(old)) renameSync(old, dest)
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
      // A symlink pointing elsewhere is repointed (deliberate: symlinks here
      // are install wiring, not content; a user's real skill dir is protected
      // above).
      if (readlinkSync(link) !== dest) rmSync(link)
    }
    if (!existsSync(link)) symlinkSync(dest, link)
  } catch (e) {
    return { ok: false, error: `plugin symlink failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Vendor adapters beyond Claude. Codex has no plugin/namespace mechanism, so
  // the same skills sync in as tm-<name> dirs with ${CLAUDE_PLUGIN_ROOT}
  // resolved to the real install path. Best-effort — a broken codex install
  // must never fail the Claude-side install.
  try {
    syncCodexSkills(dest, codexSkillsDir)
  } catch {
    /* best effort */
  }

  return { ok: true, version }
}

// Copy plugin skills into a Codex global skills dir as tm-<name>, rewriting
// ${CLAUDE_PLUGIN_ROOT} (a Claude-only substitution) to the literal plugin
// path and the frontmatter name to the prefixed one. Only tm-* dirs are
// managed: stale ones are removed, everything else is left alone. No-ops when
// the harness isn't installed (parent dir missing).
export function syncCodexSkills(pluginDir: string, codexSkillsDir: string): void {
  if (!existsSync(dirname(codexSkillsDir))) return
  const srcSkills = join(pluginDir, 'skills')
  if (!existsSync(srcSkills)) return
  mkdirSync(codexSkillsDir, { recursive: true })

  const wanted = new Set<string>()
  for (const name of readdirSync(srcSkills)) {
    if (!statSync(join(srcSkills, name)).isDirectory()) continue
    const destName = `tm-${name}`
    wanted.add(destName)
    const dest = join(codexSkillsDir, destName)
    // Stage + rename per dir so a concurrent codex agent never reads a
    // half-copied skill.
    const stagingDir = `${dest}.staging-${process.pid}`
    rmSync(stagingDir, { recursive: true, force: true })
    cpSync(join(srcSkills, name), stagingDir, { recursive: true })
    for (const file of walkFiles(stagingDir)) {
      const body = readFileSync(file, 'utf8')
      let next = body.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir)
      if (file === join(stagingDir, 'SKILL.md'))
        next = next.replace(/^name:\s*\S+\s*$/m, `name: ${destName}`)
      if (next !== body) writeFileSync(file, next)
    }
    rmSync(dest, { recursive: true, force: true })
    renameSync(stagingDir, dest)
  }
  for (const entry of readdirSync(codexSkillsDir)) {
    if (entry.startsWith('tm-') && !entry.includes('.staging-') && !wanted.has(entry))
      rmSync(join(codexSkillsDir, entry), { recursive: true, force: true })
  }
}

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walkFiles(p)
    else yield p
  }
}

export function tmPluginStatus(opts?: PluginPaths): PluginStatus {
  const { configDir, claudeSkillsDir, codexSkillsDir } = resolvePaths(opts)
  const dest = join(configDir, 'plugin')
  const installed = existsSync(join(dest, '.claude-plugin', 'plugin.json'))
  let linked = false
  try {
    const link = join(claudeSkillsDir, 'tm')
    linked = lstatSync(link).isSymbolicLink() && readlinkSync(link) === dest
  } catch {
    /* not linked */
  }
  let codexSkills = 0
  try {
    codexSkills = readdirSync(codexSkillsDir).filter((e) => e.startsWith('tm-')).length
  } catch {
    /* codex not installed */
  }
  if (!installed) return { installed: false, linked, codexSkills }
  return { installed, linked, version: readVersion(dest), path: dest, codexSkills }
}
