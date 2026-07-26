---
id: 45
title: "Editor quality-of-life: multi-cursor, regex find/replace, sticky scroll, breadcrumbs, format-on-save"
status: in-progress
priority: medium
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-26
prs: []
refs:
  - src/renderer/src/tabs/files/index.tsx
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

CodeMirror 6 gives most of these nearly free; we just haven't wired the
extensions. Batch of editing affordances users expect from any editor:

- **Multi-cursor** (Alt+Click, Cmd-D select-next-occurrence, Cmd-Shift-L
  select-all-occurrences) and **column/rectangular select** — native to CM6
  (`rectangularSelection`, `crosshairCursor`, `selectNextOccurrence`).
- **Find/replace with regex**, case, whole-word, in-selection — `@codemirror/search`.
- **Code folding** + **bracket matching** + bracket-pair colorization.
- **Sticky scroll** — pin the enclosing scope header while scrolling (syntax-tree
  ancestor lookup at the top visible line).
- **Breadcrumbs** — path trail above the editor, each segment a picker.
- **Format on save** — shell out to the project's prettier/formatter, preserving
  cursor. **Auto-save** (after-delay / on-blur).
- **Indentation auto-detect** from content, shown in a status line.

## Acceptance criteria

- Each affordance works in the Files tab and is discoverable (keybinding shown
  in the command palette where one exists).
- Format-on-save is opt-in per settings and never fires on a file the formatter
  doesn't own.
- Auto-save cannot lose content mid-edit (debounced, and flushes on blur/close).

## Update (2026-07-25)

Multi-cursor, column select, regex find/replace, code folding, bracket
matching, indentation auto-detect, and breadcrumbs shipped in PR #138.

**Remaining:** sticky scroll (no CM6 core equivalent — needs a custom
viewport + syntax-tree overlay) and format-on-save.

## Update (2026-07-26)

Sticky scroll (indentation-walk scope headers, shared/sticky.ts + a CM6 top
panel) and opt-in format-on-save (project-local prettier via
Settings → External apps) shipped in PR #151. Ticket complete pending merge.
