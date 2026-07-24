// Authorize an opaque run id against the mobile workspace boundary.
//
// The phone reaches a run log by id; that id must be proven to belong to a repo
// the bridge advertises before any on-disk log reader runs. Authorize
// POSITIVELY: only serve when we can see the run AND confirm it's a host run
// (the user's own configured host) or its repo is advertised. An id we can't
// find (aged out of the run window, or simply guessed) is refused — never a
// fall-through to the raw readers.

export type RunRef = { hostId?: string; repoLabel: string }

export function runLogAuthorized(
  run: RunRef | undefined,
  advertisedRepoNames: Set<string>,
): boolean {
  if (!run) return false
  if (run.hostId) return true
  return advertisedRepoNames.has(run.repoLabel)
}
