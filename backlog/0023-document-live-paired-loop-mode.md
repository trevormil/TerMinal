---
id: 23
title: "Document the live-paired / loop session launcher mode"
status: closed
priority: medium
horizon: next
hitl: false
type: docs
source: doc-sweep
created: 2026-07-10
updated: 2026-07-10
prs:
  - "https://github.com/trevormil/TerMinal/pull/26"
refs:
  - "Shipped across 34b6794, f5dbcae, fc7866f, e53e321, 21e15df, 6074de5, 3d16c0b — no doc commit accompanied any of them"
depends_on: []
acceptance:
  - "README.md documents what live-paired mode is (two linked sessions launched side by side vs. single mode) and how to pick it from the session picker / EntryScreen"
  - "docs/architecture.md gets a short section describing the loop engine (src/main/loops.ts) and the always-on listener (src/main/loop-listener.ts) — what they own, how a paired session's runtime params get threaded through, and how the always-on code-driven listener differs from the earlier (removed) Loop cockpit plugin"
  - "The in-app Help tab is checked for whether it should also mention the mode picker (it currently documents the ticket→PR loop but not live-paired sessions)"
  - "Docs are written by reading the actual current implementation (src/main/loops.ts, src/main/loop-listener.ts, App.tsx, EntryScreen.tsx, CommandPalette.tsx, lib/types.ts wiring) — do not guess at behavior from commit messages alone, since the feature iterated across 7 commits and later ones changed earlier decisions (e.g. 3d16c0b removed the original cockpit plugin, 6074de5 shrank paired seeds to runtime-params-only)"
agent_id: docs
agent_scope: repo
agent_kind: classic
---

## Description

TerMinal shipped a "live-paired" session launcher mode — running two linked
sessions side by side, driven by a code-based always-on listener
(`src/main/loop-listener.ts`) and a loop engine (`src/main/loops.ts`, ~565
lines) — across a run of 7 commits (`34b6794` through `3d16c0b`/`21e15df`).
The feature touches `App.tsx`, `EntryScreen.tsx`, `CommandPalette.tsx`,
`lib/types.ts`, `data.ts`, `agents.ts`, and `index.ts`, but README.md,
docs/architecture.md, and the in-app Help tab currently have **zero**
mention of it. A doc-sweep pass surfaced the gap but didn't have enough
confidence in the current (post-iteration) behavior to write accurate docs
without risking inventing behavior — the feature changed shape multiple
times within its own commit run (a first cockpit-plugin approach was later
removed in favor of the code-driven listener).

## Acceptance criteria

See frontmatter `acceptance`.
