import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { repoStatePathForWrite } from './repo-state'

// One-time sweep of the per-repo copies that OLDER bootstraps installed and
// the global tm plugin now serves: .claude/skills/<s>, .codex/skills/<s>,
// .claude/bin/<b>, .claude/hooks/<h>. What the plugin "owns" is derived from
// the INSTALLED plugin tree, never a hardcoded list — a skill the plugin
// doesn't ship (e.g. a repo-authored one sharing the directory) is never
// touched. Copies are MOVED to .claude/pre-tm-backup/<rel> (recoverable, and
// numbered on collision so a re-run can't clobber an earlier banked
// customization), mirroring bootstrap.sh's migrate step for repos that never
// re-ran bootstrap.

export type SweepResult = { moved: number; backedUp: string[] }

function pluginNames(pluginDir: string, sub: string): Set<string> {
  try {
    return new Set(readdirSync(join(pluginDir, sub)))
  } catch {
    return new Set()
  }
}

// Hook copies that .claude/settings.json still wires by project path must
// stay: banking them leaves every tool call in that repo pointing at a dead
// script and silently disables the merge gate for plain checkouts (TerMinal's
// own repo carries wired copies on purpose). A hook becomes sweepable once
// the settings entry is gone.
function wiredHookNames(repoRoot: string): Set<string> {
  try {
    const settings = readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8')
    return new Set([...settings.matchAll(/\.claude\/hooks\/([\w.-]+)/g)].map((m) => m[1]))
  } catch {
    return new Set()
  }
}

function candidateRels(repoRoot: string, pluginDir: string): string[] {
  const skills = pluginNames(pluginDir, 'skills')
  const bins = pluginNames(pluginDir, 'bin')
  const hooks = pluginNames(pluginDir, 'hooks')
  for (const name of wiredHookNames(repoRoot)) hooks.delete(name)
  const rels: string[] = []
  const collect = (repoSub: string, owned: Set<string>) => {
    for (const name of owned) {
      const rel = `${repoSub}/${name}`
      if (existsSync(join(repoRoot, rel))) rels.push(rel)
    }
  }
  collect('.claude/skills', skills)
  collect('.codex/skills', skills)
  collect('.claude/bin', bins)
  collect('.claude/hooks', hooks)
  return rels
}

export function legacyPluginCopies(repoRoot: string, pluginDir: string): string[] {
  if (!repoRoot || !pluginDir) return []
  return candidateRels(repoRoot, pluginDir).sort()
}

function pruneEmpty(dir: string, stopAt: string): void {
  let cur = dir
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      if (readdirSync(cur).length > 0) return
      rmdirSync(cur)
    } catch {
      return
    }
    cur = dirname(cur)
  }
}

// Wave-3 seeds that older bootstraps put in every repo and are global now:
// the Codex stop hook + its merge-by-hand seed artifact, the settings.json
// seed artifact, the layout marker (v2 is the default layout now), the forge
// selector (moved to the sidecar override), and any default script-agent file
// whose content still exactly matches the plugin's copy (customized ones are
// this repo's own agents and survive). Live user config — .codex/hooks.json,
// .TerMinal/widgets.json, .TerMinal/tabs.json — is never touched.
const RETIRED_SEED_RELS = [
  '.codex/hooks/stop-notify.sh',
  '.codex/hooks.workflow.json',
  '.claude/settings.workflow.json',
  '.TerMinal/template.json',
]

/** Detection only — everything sweepLegacySeeds would move, forge included. */
export function legacySeedCandidates(repoRoot: string, pluginDir: string): string[] {
  if (!repoRoot) return []
  const rels: string[] = RETIRED_SEED_RELS.filter((rel) => existsSync(join(repoRoot, rel)))
  const scripts = join(pluginDir, 'scripts')
  let defaults: string[] = []
  try {
    defaults = readdirSync(scripts)
  } catch {
    /* no plugin scripts — nothing to compare */
  }
  for (const name of defaults) {
    const rel = `.agents/${name}`
    const p = join(repoRoot, rel)
    try {
      if (existsSync(p) && readFileSync(p, 'utf8') === readFileSync(join(scripts, name), 'utf8'))
        rels.push(rel)
    } catch {
      /* unreadable (e.g. a directory) — leave it */
    }
  }
  if (existsSync(join(repoRoot, '.claude', 'forge'))) rels.push('.claude/forge')
  return rels
}

export function sweepLegacySeeds(
  repoRoot: string,
  pluginDir: string,
  sidecarPathFor: (rel: string) => string = (rel) => repoStatePathForWrite(repoRoot, rel),
): SweepResult {
  if (!repoRoot) return { moved: 0, backedUp: [] }
  const rels = legacySeedCandidates(repoRoot, pluginDir)
  // Forge selector: preserve the choice in the sidecar before banking the file.
  const forgeIdx = rels.indexOf('.claude/forge')
  if (forgeIdx !== -1) {
    try {
      const dest = sidecarPathFor('forge')
      if (!existsSync(dest)) {
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(join(repoRoot, '.claude', 'forge'), dest)
      }
    } catch {
      // Sidecar unavailable — keep the repo file so the choice isn't lost.
      rels.splice(forgeIdx, 1)
    }
  }
  return bankRels(repoRoot, rels)
}

function bankRels(repoRoot: string, rels: string[]): SweepResult {
  const backupRoot = join(repoRoot, '.claude', 'pre-tm-backup')
  const backedUp: string[] = []
  for (const rel of rels) {
    const src = join(repoRoot, rel)
    let dest = join(backupRoot, rel)
    if (existsSync(dest)) {
      let n = 1
      while (existsSync(`${dest}.${n}`)) n++
      dest = `${dest}.${n}`
    }
    mkdirSync(dirname(dest), { recursive: true })
    renameSync(src, dest)
    backedUp.push(rel)
    pruneEmpty(dirname(src), repoRoot)
  }
  return { moved: backedUp.length, backedUp }
}

export function sweepLegacyPluginCopies(repoRoot: string, pluginDir: string): SweepResult {
  return bankRels(repoRoot, legacyPluginCopies(repoRoot, pluginDir))
}
