// Sidecar state resolution for the headless runner.
//
// The resolver itself is the shared generated block (repo-state-block.js); this
// module is the typed surface the rest of the runner uses, plus the per-area
// candidate lists and the v1/v2 layout probe that the block deliberately leaves
// to its caller.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CFG } from './config'
import { makeRepoState, type RepoStateApi } from './repo-state-block.js'

let cached: { cfg: string; api: RepoStateApi } | null = null

/** The resolver bound to the CURRENT config dir. Rebound when it changes, so a
 *  test that redirects TERMINAL_CONFIG_DIR is not served a stale binding. */
export function repoState(): RepoStateApi {
  const cfg = CFG()
  if (!cached || cached.cfg !== cfg) cached = { cfg, api: makeRepoState(cfg) }
  return cached.api
}

export function areaCandidates(area: string): string[] {
  return (
    {
      backlog: ['.TerMinal/backlog', 'backlog'],
      sessions: ['.TerMinal/sessions', 'sessions'],
      reviews: ['.TerMinal/reviews', '.reviews'],
      checks: ['.TerMinal/checks', '.checks', 'checks'],
      reports: ['.TerMinal/reports', 'reports'],
    }[area] || [area]
  )
}

// v2 by default: v1 only on positive evidence of root-level v1 state dirs
// (mirrors src/main/project-layout.ts detectProjectLayout).
export function hasV2Layout(root: string): boolean {
  const areas = ['backlog', 'sessions', 'reviews', 'checks', 'reports']
  if (existsSync(join(root, '.TerMinal', 'template.json'))) return true
  if (areas.some((area) => existsSync(join(root, areaCandidates(area)[0])))) return true
  return !areas.some((area) => {
    const rels = areaCandidates(area)
    return rels.length > 1 && existsSync(join(root, rels[1]))
  })
}

export function areaPath(root: string, area: string): string {
  return repoState().areaWritePath(root, area, areaCandidates(area), hasV2Layout(root))
}

export function areaPathsFor(root: string, area: string): string[] {
  return repoState().areaPathsFor(root, area, areaCandidates(area))
}

export function statePathForRead(root: string, rel: string): string {
  return repoState().statePathForRead(root, rel)
}

export function repoStateEnv(root: string): Record<string, string> {
  return repoState().repoStateEnv(root)
}

export function maxAreaId(dirs: string[]): number {
  return repoState().maxAreaId(dirs)
}
