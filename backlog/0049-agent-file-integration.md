---
id: 49
title: "Agent↔file integration: inline AI-edit diffs, per-turn checkpoints, line-pinned diff comments, AI attribution"
status: open
priority: high
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-26
prs: []
refs:
  - src/renderer/src/tabs/files/index.tsx
  - src/main/agents.ts
  - src/main/index.ts
depends_on: [48]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

The genuinely differentiated cluster — where TerMinal's agentic core meets the
file surface. These are the features Cursor and Orca are actually *for*, and
they matter more here than generic IDE parity.

- **Inline AI-edit diffs** — an agent's edits land as red/green decorations in
  the buffer rather than being silently applied, with **per-hunk accept/reject**
  plus accept-all/reject-all. (Cursor's defining affordance.)
- **Per-turn checkpoint / restore** — snapshot changed files each agent turn
  (shadow git repo with a commit per turn is the cheap implementation); one
  click rolls back. This is what makes letting an agent run unattended feel safe.
- **Line-pinned diff comments batched into one prompt** (Orca's strongest idea)
  — annotate diff lines, then send every comment as a single revision prompt.
  Pins track across the agent's edits so you can verify what changed.
- **AI attribution gutter markers** — record ranges an agent wrote and mark
  them; a human editing those lines flips attribution back to human. Local only,
  never written to git.
- **Changed-file review list per turn** — every file the agent touched this
  turn, expandable to its diff (uses #0048's multi-file view).

## Acceptance criteria

- An agent edit is reviewable before it's committed to the buffer; reject
  restores the original exactly.
- Checkpoint restore returns the workspace to a prior turn's state and says so
  in the Activity feed.
- Comments survive an agent revision pass and stay pinned to the right lines.
- Attribution never leaks into git (no file writes, no commit trailers).

## Notes

`@codebase` embeddings and predictive multi-line completion were considered and
rejected: high cost, and ripgrep + fuzzy paths already cover the retrieval need.

## Update (2026-07-25)

Per-turn checkpoints with one-click restore shipped in PR #142 — a shadow git
repo that never touches the user's own .git, with restore itself undoable.

**Remaining:** inline AI-edit diffs with per-hunk accept/reject, line-pinned
diff comments batched into one revision prompt, and AI-attribution gutter
markers.
