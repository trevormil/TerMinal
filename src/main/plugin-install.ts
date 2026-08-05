import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { terminalConfigDir } from './config-dir'

// Installs the tm plugin globally: copy the bundled plugin/ tree to the stable
// ~/.config/TerMinal/plugin path, then expose it to Claude Code as a
// skills-dir plugin via a ~/.claude/skills/tm symlink (auto-loads in every
// session as tm@skills-dir, skills namespaced /tm:*). Replaces the old
// per-repo bootstrap copies of skills/hooks/bin.

export type PluginPaths = {
  configDir?: string
  claudeSkillsDir?: string
  codexSkillsDir?: string
  pluginsDir?: string
}
export type PluginInstallResult = { ok: true; version: string } | { ok: false; error: string }
export type PluginStatus = {
  installed: boolean
  linked: boolean
  version?: string
  path?: string
  codexSkills?: number
  /** A marketplace-installed plugin also named tm, which Claude loads instead. */
  shadowedBy?: string
}

function resolvePaths(opts?: PluginPaths): {
  configDir: string
  claudeSkillsDir: string
  codexSkillsDir: string
  pluginsDir: string
} {
  // Env overrides are the same seam as terminalConfigDir(): syncCodexSkills
  // DELETES managed tm-* dirs, so a caller that forgets to pass a path must
  // not fall through to the developer's real ~/.codex/skills. src/
  // test-preload.ts points these at throwaway dirs for the whole suite.
  return {
    configDir: opts?.configDir ?? terminalConfigDir(),
    claudeSkillsDir:
      opts?.claudeSkillsDir ??
      process.env.TERMINAL_CLAUDE_SKILLS_DIR ??
      join(homedir(), '.claude', 'skills'),
    codexSkillsDir:
      opts?.codexSkillsDir ??
      process.env.TERMINAL_CODEX_SKILLS_DIR ??
      join(homedir(), '.codex', 'skills'),
    pluginsDir:
      opts?.pluginsDir ??
      process.env.TERMINAL_CLAUDE_PLUGINS_DIR ??
      join(homedir(), '.claude', 'plugins'),
  }
}

// A plugin installed from a marketplace under the name `tm` wins over the
// skills-dir copy this app manages, and Claude then ignores
// ~/.claude/skills/tm entirely. Without this the panel would report a healthy
// link while a different (possibly stale) copy is what actually loads.
function findShadowingInstall(pluginsDir: string): string | undefined {
  try {
    const registry = JSON.parse(
      readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf8'),
    ) as { plugins?: Record<string, unknown> }
    return Object.keys(registry.plugins ?? {}).find((id) => id === 'tm' || id.startsWith('tm@'))
  } catch {
    return undefined // no registry, unreadable, or no marketplace plugins
  }
}

function readVersion(pluginDir: string): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function installTmPlugin(srcDir: string, opts?: PluginPaths): PluginInstallResult {
  const { configDir, claudeSkillsDir, codexSkillsDir } = resolvePaths(opts)
  const manifest = join(srcDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest))
    return { ok: false, error: `plugin source missing manifest: ${manifest}` }
  const version = readVersion(srcDir)
  if (!version) return { ok: false, error: `unreadable plugin.json version in ${srcDir}` }

  const dest = join(configDir, 'plugin')
  // pid-suffixed staging so two app *instances* (no single-instance lock)
  // never interleave writes into the same staging tree; within one process
  // this is synchronous and can't race.
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
  } catch (e) {
    // Roll the old tree back if the swap died between the renames.
    if (!existsSync(dest) && existsSync(old)) renameSync(old, dest)
    rmSync(staging, { recursive: true, force: true })
    return { ok: false, error: `plugin copy failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  // Post-swap cleanup is best-effort: the install already succeeded, so a
  // failed delete must not fail the call. Sweeps this run's old tree plus any
  // staging/old leftovers from crashed runs whose pid is no longer alive.
  try {
    rmSync(old, { recursive: true, force: true })
    for (const entry of readdirSync(configDir)) {
      const m = entry.match(/^plugin\.(?:staging|old)-(\d+)$/)
      if (m && Number(m[1]) !== process.pid && !isProcessAlive(Number(m[1])))
        rmSync(join(configDir, entry), { recursive: true, force: true })
    }
  } catch {
    /* best effort */
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
        return {
          ok: false,
          error: `~/.claude/skills/tm exists and is not a symlink — move it aside to enable the tm plugin`,
        }
      }
      // A symlink pointing elsewhere is repointed (deliberate: symlinks here
      // are install wiring, not content; a user's real skill dir is protected
      // above).
      if (readlinkSync(link) !== dest) rmSync(link)
    }
    if (!existsSync(link)) symlinkSync(dest, link)
  } catch (e) {
    return {
      ok: false,
      error: `plugin symlink failed: ${e instanceof Error ? e.message : String(e)}`,
    }
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

  linkStateResolvers(dest, join(configDir, 'bin'))

  return { ok: true, version }
}

// Skills tell the model to fall back to `tm-state-dir <area>` when the injected
// TERMINAL_<AREA>_DIR vars are absent — written bare, as a command. That only
// resolves if it is on PATH, and it was not: the app prepends <config>/bin
// (where terminal-cli and friends live) while the resolvers shipped only inside
// <config>/plugin/bin. So the one documented fallback was "command not found",
// and an agent following it wrote wherever the shell landed instead.
//
// Only the two `tm-`prefixed resolvers are linked. The rest of plugin/bin
// (`status`, `activity`, `forge`, `hitl`) carries generic names that would
// shadow real commands on a PATH, and skills address those by absolute path.
export function linkStateResolvers(pluginDir: string, binDir: string): void {
  try {
    mkdirSync(binDir, { recursive: true })
    for (const name of ['tm-state-dir', 'tm-state-dirs']) {
      const target = join(pluginDir, 'bin', name)
      if (!existsSync(target)) continue
      const link = join(binDir, name)
      let st
      try {
        st = lstatSync(link)
      } catch {
        st = null
      }
      // A real file here is the user's own — never overwrite it. A symlink is
      // install wiring, so a stale one gets repointed rather than left behind.
      if (st && !st.isSymbolicLink()) continue
      if (st) {
        if (readlinkSync(link) === target) continue
        rmSync(link)
      }
      symlinkSync(target, link)
    }
  } catch {
    /* best effort — injected vars already cover every session the app spawns */
  }
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
    if (!entry.startsWith('tm-') || wanted.has(entry)) continue
    // Only directories are managed — a user's stray tm-*.md file is theirs.
    if (!lstatSync(join(codexSkillsDir, entry)).isDirectory()) continue
    // Another live process's staging dir is off-limits; stale staging dirs
    // from dead runs get swept with the rest.
    if (entry.includes('.staging-') && !entry.endsWith(`.staging-${process.pid}`)) {
      const pid = Number(entry.split('.staging-')[1])
      if (pid && isProcessAlive(pid)) continue
    }
    rmSync(join(codexSkillsDir, entry), { recursive: true, force: true })
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
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
  const { configDir, claudeSkillsDir, codexSkillsDir, pluginsDir } = resolvePaths(opts)
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
    codexSkills = readdirSync(codexSkillsDir).filter(
      (e) =>
        e.startsWith('tm-') &&
        !e.includes('.staging-') &&
        lstatSync(join(codexSkillsDir, e)).isDirectory(),
    ).length
  } catch {
    /* codex not installed */
  }
  const shadowedBy = findShadowingInstall(pluginsDir)
  return {
    installed,
    linked,
    codexSkills,
    ...(shadowedBy ? { shadowedBy } : {}),
    ...(installed ? { version: readVersion(dest), path: dest } : {}),
  }
}
