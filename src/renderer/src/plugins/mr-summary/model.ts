import type { Mr } from '../../lib/types'

// Pure list → view-model transform for the PRs cockpit widget. Kept out of the
// component so sorting/collapse/paging/derivation rules are unit-testable.
// Sibling of plugins/tickets/model.ts — same shape, PR vocabulary.

export type PrRow = {
  iid: number
  title: string
  /** Source branch, shown compact next to the title. */
  branch: string
  state: string
  draft: boolean
  /** Test glyph derived from the harness review artifact (pending = no signal). */
  ci: 'pass' | 'fail' | 'pending'
  /** Review verdict/score — null when no review artifact exists. */
  verdict: string | null
  overall: number | null
}

export type PrsView = {
  rows: PrRow[]
  /** Rows beyond the visible cap ("+N more"). */
  overflow: number
  /** merged + closed, collapsed to a single count row. */
  done: number
  /** state === 'opened' count (the header's "N open"). */
  open: number
  /** Non-collapsed count (everything shown as a row). */
  total: number
}

const COLLAPSED = new Set(['merged', 'closed'])
// Unknown states rank after 'opened' but stay visible — a forge quirk must
// never silently hide a PR (mirrors the tickets model's unknown-status rule).
const rank = (s: string): number => (s === 'opened' ? 0 : 1)

const ciGlyph = (m: Mr): PrRow['ci'] =>
  m.review?.testStatus === 'pass' ? 'pass' : m.review?.testStatus === 'fail' ? 'fail' : 'pending'

export const PAGE_SIZE = 8

/**
 * `pagesShown` drives the see-more pagination: the widget starts at 1 page
 * (PAGE_SIZE rows) and each "+N more" click reveals one more page; "show less"
 * collapses back to 1.
 */
export function prsView(mrs: Mr[], pagesShown = 1, pageSize = PAGE_SIZE): PrsView {
  const listed = mrs.filter((m) => !COLLAPSED.has(m.state))
  const rows = [...listed]
    .sort((a, b) => rank(a.state) - rank(b.state))
    .map((m): PrRow => ({
      iid: m.iid,
      title: m.title,
      branch: m.sourceBranch,
      state: m.state,
      draft: m.draft,
      ci: ciGlyph(m),
      verdict: m.review?.verdict ?? null,
      overall: m.review?.overall ?? null,
    }))
  const cap = Math.max(1, pagesShown) * pageSize
  return {
    rows: rows.slice(0, cap),
    overflow: Math.max(0, rows.length - cap),
    done: mrs.length - listed.length,
    open: listed.filter((m) => m.state === 'opened').length,
    total: listed.length,
  }
}
