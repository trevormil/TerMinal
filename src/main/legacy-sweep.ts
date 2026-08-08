import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
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
  const names = new Set<string>()
  // settings.local.json is a supported hooks location too — a hook wired only
  // there is just as live as one in settings.json.
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      const settings = readFileSync(join(repoRoot, '.claude', file), 'utf8')
      for (const m of settings.matchAll(/\.claude\/hooks\/([\w.-]+)/g)) names.add(m[1])
    } catch {
      /* absent or unreadable — nothing wired from this file */
    }
  }
  return names
}

// Same rule for the Codex side: the old template's hooks.json points at
// $PWD/.codex/hooks/stop-notify.sh — a user who merged it has LIVE wiring,
// and banking the script would silently kill their completion→Inbox channel.
function codexStopHookWired(repoRoot: string): boolean {
  try {
    return readFileSync(join(repoRoot, '.codex', 'hooks.json'), 'utf8').includes(
      '.codex/hooks/stop-notify.sh',
    )
  } catch {
    return false
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

// The ownership registry the old template seeded verbatim into every repo.
// It no longer ships anywhere, so "is this the vanilla seed?" can only be
// answered by content: these are the sha256 of every version the template
// ever carried. A hash miss means the repo customized it — that copy is the
// repo's own decision and survives.
export const VANILLA_OWNED_SHA256: ReadonlySet<string> = new Set([
  '5a2f085200da443f6840d6db414bd3ee74860fc79861c97e4d12f2af5e7fa988',
  'de3d4b7d4235335b784f7d2de4dfdef1ff3b250340a62e2f032ae48eeea8e3ec',
])

function isVanillaOwnedYml(p: string, vanillaShas: ReadonlySet<string>): boolean {
  try {
    return vanillaShas.has(createHash('sha256').update(readFileSync(p)).digest('hex'))
  } catch {
    return false
  }
}

/** Detection only — everything sweepLegacySeeds would move, forge included. */
export function legacySeedCandidates(
  repoRoot: string,
  pluginDir: string,
  vanillaOwnedShas: ReadonlySet<string> = VANILLA_OWNED_SHA256,
): string[] {
  if (!repoRoot) return []
  const rels: string[] = RETIRED_SEED_RELS.filter((rel) => {
    if (rel === '.codex/hooks/stop-notify.sh' && codexStopHookWired(repoRoot)) return false
    return existsSync(join(repoRoot, rel))
  })
  if (isVanillaOwnedYml(join(repoRoot, '.agents', 'owned.yml'), vanillaOwnedShas))
    rels.push('.agents/owned.yml')
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
  try {
    // Must be a regular file — anything else can't be a forge selector, and
    // counting it would leave the banner offering a migrate that can't move it.
    if (statSync(join(repoRoot, '.claude', 'forge')).isFile()) rels.push('.claude/forge')
  } catch {
    /* absent */
  }
  return rels
}

export function sweepLegacySeeds(
  repoRoot: string,
  pluginDir: string,
  sidecarPathFor: (rel: string) => string = (rel) => repoStatePathForWrite(repoRoot, rel),
  vanillaOwnedShas: ReadonlySet<string> = VANILLA_OWNED_SHA256,
): SweepResult {
  if (!repoRoot) return { moved: 0, backedUp: [] }
  const rels = legacySeedCandidates(repoRoot, pluginDir, vanillaOwnedShas)
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
