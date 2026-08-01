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

/**
 * Should the session header show the pending-approval dot?
 *
 * The dot rides the work-column TOGGLE in the session header — persistent
 * chrome — and not the Cockpit section's Plugins action, precisely so that no
 * collapse can bury an outstanding approval. `columnCollapsed` is a parameter
 * and is deliberately ignored: gating on `showColumn` (does this session have a
 * column at all) rather than on `columnVisible` (is it currently open) is the
 * whole invariant, and the reason this is a function rather than an inline
 * `&&`. Collapsing the Cockpit section cannot reach it either — that state
 * lives inside WorkColumn, below the header entirely.
 *
 * A session with no work column at all (remote, split tile) has no header
 * toggle to hang it on; the Inbox tab's RepoTrustReview is the surface there,
 * as it was before this dot existed.
 */
export function trustDotVisible(o: {
  pending: boolean
  /** This session has a work column (not remote, not a split tile). */
  showColumn: boolean
  /** The terminal pane is the visible tab, so the header toggle is rendered. */
  onTerminal: boolean
  /** Accepted and ignored — a collapsed column must not hide the dot. */
  columnCollapsed: boolean
}): boolean {
  return o.pending && o.showColumn && o.onTerminal
}
