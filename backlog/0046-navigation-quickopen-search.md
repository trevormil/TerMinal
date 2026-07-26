---
id: 46
title: "Navigation: fuzzy quick-open with modes, symbol outline, back/forward history, project-wide search"
status: in-progress
priority: high
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-25
prs: []
refs:
  - src/renderer/src/components/CommandPalette.tsx
  - src/renderer/src/tabs/files/index.tsx
  - src/renderer/src/tabs/search/index.tsx
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

Highest-ROI cluster from the audit: getting *to* a file/line fast. We already
have a CommandPalette and a workspace search panel — this unifies them into one
widget with mode prefixes, the way VS Code and Orca both do it.

- **Fuzzy quick-open (Cmd-P)** — subsequence scorer over a warm file index,
  ranked by recency + match quality. Per Orca: show **gitignored files as a
  deliberate second tier** rather than hiding them (build output stays
  reachable without polluting results).
- **Mode prefixes in one widget** — `>` commands, `@` symbols in file, `:` line,
  `#` project symbols, plain = files.
- **Symbol outline** — panel + `@` mode. No LSP: walk the Lezer syntax tree
  (falling back to regex) which the audit put at ~70% of the value for ~10% of
  the cost.
- **Back/forward navigation history** — (file, position) stack across files;
  severely missed when absent.
- **Project-wide search & replace with preview** — ripgrep for the search, a
  grouped result list, per-match preview before applying.
- **Clickable `path:line` from agent output** — parse references in the terminal
  / activity / run logs and open the file at that position. Cheapest big win.

## Acceptance criteria

- Cmd-P opens any file in a large repo with sub-100ms filtering.
- All five modes work in the single widget; the palette lists keybindings.
- Back/forward survives edits (positions don't drift onto the wrong line).
- Replace-across-files shows a preview and can be applied partially.
- Clicking `src/main/index.ts:412` in agent output opens that exact line.

## Update (2026-07-25)

Ranked fuzzy quick-open with `>`/`@`/`:`/`#` modes, gitignored-second-tier
ranking, and file:line ref extraction shipped in PR #139; the symbol outline
and back/forward history in PR #144.

**Remaining:** project-wide search & replace with a per-match preview.
