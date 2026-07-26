---
id: 47
title: "File tree: git status decorations, context actions, drag-and-drop (incl. drop path into agent)"
status: in-progress
priority: medium
horizon: next
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-26
prs:
  - https://github.com/trevormil/TerMinal/pull/152
refs:
  - src/renderer/src/tabs/files/index.tsx
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

The explorer is currently a plain tree. Batch of affordances that make it a
working surface:

- **Git status decorations** — color + badge for modified/added/deleted/
  untracked/ignored, rolled up to parent folders (`git status --porcelain=v2`,
  refreshed on the existing watcher).
- **Context actions** — rename, duplicate, delete, reveal in Finder, copy path,
  copy relative path, new file/folder. (Copy-path and reveal are used constantly.)
- **Filter-as-you-type** in the tree.
- **Drag and drop** — within the tree to move; OS files in; and the Orca steal:
  **drag a file onto an agent terminal to paste its path**, which is a genuinely
  better way to reference files in a prompt than typing them.
- **Compare with…** — "select for compare" → "compare with selected", plus
  compare-with-saved (diff the dirty buffer against disk). Cheap once #0048 lands.
- **Live external changes** — an agent writing a file should update the tree
  immediately (verify the existing watcher covers creates/deletes, not just edits).

## Acceptance criteria

- Status colors match `git status` and update within ~1s of an agent's write.
- Every context action works and is keyboard-reachable.
- Dropping a file on a terminal pastes its path into that session's prompt.
- Compare-with-saved shows the unsaved-vs-disk diff.

## Update (2026-07-25)

Git status decorations with parent-folder rollup shipped in PR #141; copy
relative path and reveal-in-Finder in PR #144.

**Remaining:** drag-and-drop (including the Orca steal — drop a file onto an
agent terminal to paste its path) and compare-with.

## Update (2026-07-26)

Drag-and-drop shipped in PR #152: tree-internal moves (rename under the hood,
open buffers follow, guards in shared/tree-dnd.ts) and drags carry the
absolute path as text/plain so a drop on any terminal pastes it (the Orca
steal). Compare-with: hover action diffs any file against the active one.
Ticket complete pending merge.
