import type { BriefingItem, BriefingItemKind } from '../../lib/types'

// Where the "Open" button on a briefing item should take you.
//
// Split out of TodaySection as a pure function because it is the one piece of
// that component with real branching, and getting it wrong is silent: a bad
// tab id just opens the wrong tab, which no typecheck catches.

export type BriefingTarget =
  { kind: 'url'; url: string } | { kind: 'nav'; tabId: string; payload: Record<string, unknown> }

/** Per-kind default tab, used when the agent didn't emit a `nav` hint. */
const FALLBACK_TAB: Record<BriefingItemKind, string> = {
  pr: 'mrs',
  ticket: 'tickets',
  idea: 'tickets',
  hitl: 'hitl',
  run: 'runs',
  report: 'reports',
  lesson: 'docs',
  note: 'activity',
}

export function resolveBriefingTarget(item: BriefingItem): BriefingTarget {
  const link = item.link?.trim()

  // Only http(s) opens externally. A `javascript:` or `file:` link in
  // agent-generated markdown must never reach window.open.
  if (link && /^https?:\/\//i.test(link)) return { kind: 'url', url: link }

  const payload: Record<string, unknown> = {}
  if (item.repo) payload.repo = item.repo
  if (link?.startsWith('ticket:')) payload.ticket = link.slice('ticket:'.length)
  if (link?.startsWith('run:')) payload.runId = link.slice('run:'.length)

  return {
    kind: 'nav',
    tabId: item.nav || FALLBACK_TAB[item.kind] || 'activity',
    payload,
  }
}
