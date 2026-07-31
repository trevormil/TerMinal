import type { RepoTrustStatus } from './types'

// Pure derivation of the per-repo trust gate's UI state, split out from the
// component so the one rule that carries the security property is testable:
// only a repo the user has ALREADY approved for THIS exact command set may
// hide its commands.

export type TrustPanelState =
  /** Nothing repo-sourced to decide about. */
  | 'none'
  /** Approved for this exact command set. */
  | 'trusted'
  /** Refused for this exact command set. */
  | 'blocked'
  /** Needs a human decision. */
  | 'pending'

export function trustPanelState(status: RepoTrustStatus | null, denied: boolean): TrustPanelState {
  if (!status || status.commands.length === 0) return 'none'
  if (status.trusted) return 'trusted'
  return denied ? 'blocked' : 'pending'
}

/**
 * May the literal commands be hidden behind a disclosure?
 *
 * Only when trusted. `trusted` is keyed on (repoRoot, command-set hash), so the
 * moment a repo's widgets.json changes the hash stops matching, the state falls
 * back to `pending`, and the commands are forced open again — new commands are
 * unread commands. Collapsing a pending repo would defeat the whole gate.
 */
export function commandsCollapsible(state: TrustPanelState): boolean {
  return state === 'trusted'
}
