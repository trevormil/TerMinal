---
id: 22
title: "Integrate Hermes sessions into the resume picker (from ~/.hermes, with resume)"
status: open
priority: low
horizon: next
hitl: false
type: feature
source: brainstorm
created: 2026-07-09
updated: 2026-07-09
prs: []
refs:
  - "Follow-up to the fix that stopped listSessions('hermes') from leaking Claude/Codex/Cursor sessions (returns [] for now)"
depends_on: []
acceptance:
  - "listSessions('hermes') returns real Hermes sessions (like listCodexSessions reads ~/.codex) instead of []"
  - "Sessions carry enough metadata for the resume UI: id, title, last-active, and a cwd/repo when available (so repo-scoping works)"
  - "Resuming a Hermes session launches the interactive TUI attached to it (hermes --resume <id> --tui, or --continue)"
  - "Graceful when Hermes isn't installed / store is empty"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

Hermes keeps its own session history (SQLite `SessionDB` under `~/.hermes`),
surfaced by `hermes sessions list` — but that command prints a fixed-width
**table** (Title / Preview / Last Active / ID) with **no `--json` and no cwd**,
so it can't feed TerMinal's repo-scoped resume picker directly.

For now `listSessions('hermes')` returns `[]` (the earlier bug leaked the
Claude/Codex/Cursor lists under Hermes). To actually resume Hermes sessions:

1. Add `listHermesSessions()` in `src/main/data.ts` (sibling to
   `listCodexSessions`). Best source, in order of preference: a `--json` mode if
   Hermes gains one; else read the SQLite store with better-sqlite3 (already a
   dep) — inspect the `SessionDB` schema in `~/.hermes`; last resort, parse the
   table output (fragile — the ID is the trailing token per row).
2. Map to `SessionMeta` (id, title, mtime, and cwd/gitBranch if the store has
   them — needed for repo-scoped grouping/filtering).
3. Wire interactive resume: `startSession` for a resumed Hermes session runs
   `hermes --resume <id> --tui` (or `--continue`). Currently Hermes only starts
   fresh (`--tui`).

## Notes
- Codex integration (`~/.codex/sessions`, `collectCodexSessions`) is the closest
  existing template.
- If the SQLite schema proves unstable across Hermes versions, prefer requesting
  a `hermes sessions list --json` upstream over brittle parsing.
