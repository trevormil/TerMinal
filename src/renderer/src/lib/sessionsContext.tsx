import { createContext, useContext } from 'react'
import type { SessionEngine } from './types'

/** One entry in a workspace's peer-session sub-bar. */
export type PeerSession = {
  key: string
  label: string
  status: string
  mode: 'new' | 'resume'
  engine: SessionEngine
  needsAttention?: boolean
  loopRole?: 'driver' | 'worker'
}

/**
 * The session roster and its lifecycle callbacks — everything a tile needs to
 * know about its siblings, plus the verbs that add, switch, rename, reorder,
 * and close them. App owns the underlying state; this is the delivery
 * mechanism.
 *
 * ## Memoization contract
 *
 * The companion to LayoutContext — read the contract there first, it explains
 * why these are two contexts and not one. The half that lands here: this value
 * is the churny one. `peersByKey` and `attentionKeys` are rebuilt whenever a
 * session's status, auto-name, or attention flag moves, which in practice is
 * every few seconds. Keeping layout out of it is what stops a status tick from
 * invalidating the layout consumers.
 *
 * So the same two rules apply, and matter more here:
 *
 * 1. `useMemo` the value with exactly these fields as deps. `peersByKey` and
 *    `attentionKeys` must themselves be memoized upstream — a freshly built
 *    Map per render defeats everything below it.
 * 2. Every callback needs a stable identity across App re-renders. They close
 *    over App state (`closeSession` reads `activeKey`), so App cannot wrap them
 *    in `useCallback` without deps that change constantly; it routes them
 *    through a latest-value ref instead (see `shellHandlersRef`).
 *
 * Callbacks stay optional for the same reason as in LayoutContext: SessionView
 * gates affordances on their presence (no `onReorderSession` means the pills
 * are not draggable), so a no-op default would render dead controls.
 */
export type SessionsContextValue = {
  /** Peer lists keyed by session key. Every session in a workspace shares one
   *  array instance, so a lookup is stable until the roster actually changes. */
  peersByKey: ReadonlyMap<string, PeerSession[]>
  /** Keys of sessions currently flagged as needing attention. */
  attentionKeys: ReadonlySet<string>
  onSwitchSession?: (key: string) => void
  /** Opens the new-session screen scoped to the workspace of the given session. */
  onAddSession?: (fromKey: string) => void
  onCloseSession?: (key: string) => void
  onRenameSession?: (key: string, name: string) => void
  onReorderSession?: (fromKey: string, toKey: string) => void
  onClearAttention?: (key: string) => void
}

const DEFAULT_SESSIONS: SessionsContextValue = {
  peersByKey: new Map(),
  attentionKeys: new Set(),
}

const SessionsContext = createContext<SessionsContextValue>(DEFAULT_SESSIONS)

export const SessionsProvider = SessionsContext.Provider

export function useSessions(): SessionsContextValue {
  return useContext(SessionsContext)
}
