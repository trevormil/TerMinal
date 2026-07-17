// Gating logic for the two orientation surfaces: the one-time first-run
// orientation (after Onboarding completes) and the per-repo orientation for
// fresh repos. Pure functions so the rules are testable without a renderer.

export type FirstRunPhase = 'loading' | 'setup' | 'orient' | 'app'

export function firstRunPhase(opts: {
  /** settings.onboarded — null while the initial settings read is in flight */
  onboarded: boolean | null
  /** true only when Onboarding's onDone fired during this app session */
  completedThisSession: boolean
  orientationDismissed: boolean
}): FirstRunPhase {
  if (opts.onboarded === null) return 'loading'
  if (!opts.onboarded) return 'setup'
  if (opts.completedThisSession && !opts.orientationDismissed) return 'orient'
  return 'app'
}

export function repoOrientationKey(repoRoot: string): string {
  return `gt.repoOriented.${repoRoot}`
}

/**
 * One-shot marker written by the new-project scaffold flow: the next open of
 * this repo shows the orientation even though the template seeds .agents/ and
 * a backlog (which would otherwise read as "established" below).
 */
export function repoOrientationPendingKey(repoRoot: string): string {
  return `gt.repoOrientPending.${repoRoot}`
}

/**
 * Auto-show the per-repo orientation for a fresh local repo — one with
 * neither agents nor a backlog yet — or for one just created via the
 * new-project scaffold (justCreated). Established repos never get nagged,
 * and the user's dismissal is respected per repo. (The palette command
 * bypasses this and shows it on demand.)
 */
export function shouldAutoShowRepoOrientation(
  ctx: { repoRoot: string; hasAgents: boolean; hasBacklog: boolean; remote?: boolean },
  isDismissed: (key: string) => boolean,
  opts?: { justCreated?: boolean },
): boolean {
  if (!ctx.repoRoot || ctx.remote) return false
  if (!opts?.justCreated && (ctx.hasAgents || ctx.hasBacklog)) return false
  return !isDismissed(repoOrientationKey(ctx.repoRoot))
}
