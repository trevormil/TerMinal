import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { parseFrontmatter } from './frontmatter'

// Enumerate platform-agnostic skills available to a session, across three scopes:
//   project  — <repoRoot>/.claude/skills, .codex/skills, and .cursor/skills
//   personal — ~/.claude/skills, ~/.codex/skills, and ~/.cursor/skills
//   plugin   — ~/.claude/plugins/cache/**/skills/<name>/SKILL.md (installed plugins)
// "Ours" = project + personal; plugins are the larger external set shown on expand.

export type SkillScope = 'project' | 'personal' | 'plugin'
export type SkillPlatform = 'claude' | 'codex' | 'cursor'
export type SkillInfo = {
  name: string
  description: string
  scope: SkillScope
  namespace?: string // plugin name, for scope === 'plugin'
  platforms: SkillPlatform[]
}

// Plugin skills live at .../cache/<source>/<plugin>/<version>/skills/<name>/SKILL.md.
// The namespace is the <plugin> segment (the dir two levels above the skills/ dir).
export function pluginNamespaceFromSkillPath(skillMdPath: string): string {
  const skillDir = dirname(skillMdPath) // .../skills/<name>
  const skillsDir = dirname(skillDir) // .../skills
  const versionDir = dirname(skillsDir) // .../<plugin>/<version>
  return basename(dirname(versionDir)) // <plugin>
}

function readSkill(
  skillMdPath: string,
  scope: SkillScope,
  platform: SkillPlatform,
  namespace?: string,
): SkillInfo | null {
  try {
    const { fm } = parseFrontmatter(readFileSync(skillMdPath, 'utf8'))
    const name = typeof fm.name === 'string' && fm.name ? fm.name : basename(dirname(skillMdPath))
    const description = typeof fm.description === 'string' ? fm.description : ''
    return { name, description, scope, namespace, platforms: [platform] }
  } catch {
    return null
  }
}

// One level of <dir>/<name>/SKILL.md folders.
function scanSkillDir(dir: string, scope: SkillScope, platform: SkillPlatform): SkillInfo[] {
  if (!existsSync(dir)) return []
  const out: SkillInfo[] = []
  for (const entry of readdirSync(dir)) {
    const md = join(dir, entry, 'SKILL.md')
    if (existsSync(md)) {
      const s = readSkill(md, scope, platform)
      if (s) out.push(s)
    }
  }
  return out
}

// Recursively find plugin SKILL.md files under the plugin cache (depth-bounded).
function scanPluginSkills(): SkillInfo[] {
  const root = join(homedir(), '.claude/plugins/cache')
  if (!existsSync(root)) return []
  const out: SkillInfo[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      const md = join(p, 'SKILL.md')
      if (basename(dir) === 'skills' && existsSync(md)) {
        const s = readSkill(md, 'plugin', 'claude', pluginNamespaceFromSkillPath(md))
        if (s) out.push(s)
        continue // don't descend into a skill folder
      }
      walk(p, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

let cache: { ts: number; key: string; skills: SkillInfo[] } | null = null
const SKILLS_CACHE_MS = 10_000

export function listSkills(repoRoot: string): SkillInfo[] {
  const now = Date.now()
  if (cache && cache.key === repoRoot && now - cache.ts < SKILLS_CACHE_MS) return cache.skills
  const project = repoRoot
    ? [
        ...scanSkillDir(join(repoRoot, '.claude/skills'), 'project', 'claude'),
        ...scanSkillDir(join(repoRoot, '.codex/skills'), 'project', 'codex'),
        ...scanSkillDir(join(repoRoot, '.cursor/skills'), 'project', 'cursor'),
      ]
    : []
  const personal = [
    ...scanSkillDir(join(homedir(), '.claude/skills'), 'personal', 'claude'),
    ...scanSkillDir(join(homedir(), '.codex/skills'), 'personal', 'codex'),
    ...scanSkillDir(join(homedir(), '.cursor/skills'), 'personal', 'cursor'),
  ]
  const plugin = scanPluginSkills()
  // Dedup by scope+namespace+name and merge platform mirrors into one row.
  const seen = new Map<string, SkillInfo>()
  for (const s of [...project, ...personal, ...plugin]) {
    const k = `${s.scope}:${s.namespace || ''}:${s.name}`
    const prev = seen.get(k)
    if (!prev) seen.set(k, s)
    else
      prev.platforms = Array.from(
        new Set([...prev.platforms, ...s.platforms]),
      ).sort() as SkillInfo['platforms']
  }
  const skills = [...seen.values()].sort(
    (a, b) => (a.namespace || '').localeCompare(b.namespace || '') || a.name.localeCompare(b.name),
  )
  cache = { ts: now, key: repoRoot, skills }
  return skills
}
