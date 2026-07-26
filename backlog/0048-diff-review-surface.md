---
id: 48
title: "Diff review: inline/side-by-side toggle, word-level, collapse unchanged, multi-file view, image diff"
status: in-progress
priority: high
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-26
prs: []
refs:
  - src/renderer/src/components/MrDetail.tsx
  - src/renderer/src/tabs/files/index.tsx
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

Reviewing what an agent changed is the single most common file interaction in
TerMinal, so the diff surface deserves real investment. `@codemirror/merge`
provides most of this out of the box.

- **Inline vs side-by-side toggle** (`MergeView` / `unifiedMergeView`).
- **Word-level intra-line highlighting** — built into `@codemirror/merge`.
- **Collapse unchanged regions** behind an expandable "N lines hidden" spacer
  (`collapseUnchanged`) — the thing that makes a large diff readable.
- **Syntax highlighting inside diffs** (missing in Orca; a differentiator).
- **Multi-file diff view** — one scrollable surface stacking every changed file
  in a turn/branch, virtualized. This is the review surface for agent output.
- **Diff any two files**, and diff against any ref (commit/branch/base), not
  just HEAD.
- **Image diff** — side-by-side, **swipe**, and **onion-skin** (Orca/VS Code).
- **Changes View** (Orca steal): toggle a HEAD-vs-working-tree diff *inside the
  editor tab* without losing cursor position; `n`/`p` walk hunks.
- **Keyboard-first review**: `j`/`k` files, `n`/`p` hunks.
- **Word wrap toggle in diffs** so wide diffs read without horizontal scroll.

## Acceptance criteria

- A 2000-line diff renders readably (unchanged collapsed) and scrolls smoothly.
- Inline/side-by-side toggles without losing scroll position.
- Image diff offers all three modes.
- Keyboard review works end-to-end without touching the mouse.

## Notes

Per-hunk git *staging* is deliberately out of scope — the audit flagged it as
high-cost/error-prone and TerMinal is not a git client.

## Update (2026-07-25)

MergeDiffView shipped in PR #140: split/inline toggle, word-level highlighting,
collapse-unchanged, syntax highlighting inside the diff, n/p hunk stepping,
plus the per-file Changes View against HEAD.

**Remaining:** image diff (swipe / onion-skin) and the multi-file diff view.

## Update (2026-07-26)

Image diff (side-by-side / swipe / onion-skin, HEAD vs working via
git:file-at-head-binary) and the multi-file diff view (Changes sidebar lists
changed files; each opens its own merge diff, patch view one click away)
shipped in PR #152. Ticket complete pending merge.
