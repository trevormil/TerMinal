import { createContext, useContext } from 'react'
import type { SessionRail, TerminalLayout } from '../App'
import type { AppearanceTabLayout } from './types'

/**
 * Terminal-shell layout: how session tiles are arranged, where the session
 * chrome sits, and which tile has focus. App still owns the state (these are
 * its `useState`s); this context is only the delivery mechanism, so the shape
 * below mirrors what SessionView used to receive as props one-for-one.
 *
 * ## Memoization contract
 *
 * Two contexts instead of one, deliberately. This one changes ONLY when the
 * user moves a layout control (single/split/grid, rail top-vs-left, tab
 * layout) or the focused tile changes. SessionsContext carries the session
 * roster, which churns on every status poll, rename, and attention flip.
 * Fused into a single context, a rail toggle would invalidate the roster and
 * a status tick would invalidate the layout — every consumer of either would
 * re-render on both. Split, each invalidation stays in its own lane.
 *
 * That only holds if the provider upholds two rules:
 *
 * 1. The value handed to `LayoutProvider` is `useMemo`'d, with deps that are
 *    exactly the fields below — no spreading in a fresh object per render.
 * 2. The callbacks keep stable identities across App re-renders. A `useState`
 *    setter is stable already; a handler defined in App's body is NOT, so App
 *    routes those through a latest-value ref (see `shellHandlersRef`).
 *
 * Break either rule and the split buys nothing: the value changes on every App
 * render and both contexts invalidate together again.
 *
 * The callbacks stay optional because SessionView keys real affordances off
 * their presence (no `onTerminalLayoutChange` means no layout button group).
 * A no-op default would silently render dead controls.
 */
export type LayoutContextValue = {
  /** Split/grid layouts are terminal-focused; hide workspace chrome and the work column. */
  terminalTile: boolean
  terminalLayout: TerminalLayout
  tabLayout: AppearanceTabLayout
  /** Position of the peer-session sub-bar: a horizontal row on top, or a
   *  vertical rail on the left of the terminal pane. */
  sessionRail: SessionRail
  /** Both split (2 tiles) and grid (4 tiles) tile sessions across repos, so each
   *  is enabled whenever ≥2 sessions exist app-wide. */
  canSplitTerminal: boolean
  canGridTerminal: boolean
  /** The session whose terminal takes keyboard focus. A tile compares its own
   *  key against this rather than each tile being told individually. */
  focusedSessionKey: string | null
  onTerminalLayoutChange?: (layout: TerminalLayout) => void
  onSessionRailChange?: (rail: SessionRail) => void
}

/** Standalone defaults — what SessionView fell back to when App passed nothing. */
const DEFAULT_LAYOUT: LayoutContextValue = {
  terminalTile: false,
  terminalLayout: 'single',
  tabLayout: 'horizontal',
  sessionRail: 'top',
  canSplitTerminal: false,
  canGridTerminal: false,
  focusedSessionKey: null,
}

const LayoutContext = createContext<LayoutContextValue>(DEFAULT_LAYOUT)

export const LayoutProvider = LayoutContext.Provider

export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext)
}
