import { resolve, sep } from 'node:path'

/** True if `repoRoot` resolves to a path at or under one of `allowedDirs`.
 *  Pure + dependency-free so it's unit-testable without the electron module
 *  graph. The automation inbox dispatches full-access agents, so a dropped
 *  envelope must not point them at an arbitrary directory outside the user's
 *  configured projects. */
export function isRepoRootWithin(repoRoot: string, allowedDirs: string[]): boolean {
  if (!repoRoot) return false
  const real = resolve(repoRoot)
  return allowedDirs
    .filter(Boolean)
    .map((d) => resolve(d))
    .some((root) => real === root || real.startsWith(root + sep))
}
