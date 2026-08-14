// Types for the generated JS block in repo-state-block.js. The block itself
// must stay byte-identical to every other copy, so it cannot carry
// annotations — they live here instead.
export type SidecarArea = 'backlog' | 'sessions' | 'reviews' | 'checks' | 'reports'

export type RepoStateApi = {
  SIDECAR_AREAS: SidecarArea[]
  /** Sidecar key for a repo ('' when it cannot be resolved). */
  repoStateKey(root: string): string
  /** <state>/<key>/<area>, or '' when unresolvable. */
  sidecarAreaPath(root: string, area: string): string
  /** Every dir an area READS from: sidecar first, then surviving in-repo dirs. */
  areaPathsFor(root: string, area: string, candidates: string[]): string[]
  /** The single dir an area WRITES to. */
  areaWritePath(root: string, area: string, candidates: string[], isV2: boolean): string
  /** Highest NNNN- prefix across the given dirs (0 when none). */
  maxAreaId(dirs: string[]): number
  statePathForWrite(root: string, rel: string): string
  statePathForRead(root: string, rel: string): string
  statePathSticky(root: string, rel: string): string
  /** TERMINAL_<AREA>_DIR env for a spawned child ({} when unresolvable). */
  repoStateEnv(root: string): Record<string, string>
}

export function makeRepoState(CFG: string): RepoStateApi
