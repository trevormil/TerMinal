---
id: 44
title: "File viewers: markdown preview, images, CSV/TSV tables, JSON folding, binary hex fallback"
status: backlog
priority: high
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-25
updated: 2026-07-25
prs: []
refs:
  - src/renderer/src/tabs/files/index.tsx
  - src/renderer/src/components/Markdown.tsx
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

The Files tab syntax-highlights everything but *renders* nothing: opening a
`.md` shows raw markdown, an image shows mojibake, a CSV shows a wall of commas,
and a binary file dumps garbage into CodeMirror. Every IDE audited (VS Code,
Cursor, Orca) treats per-type viewers as table stakes.

Batch of viewers, picked by extension with a raw-source toggle on each:

- **Markdown preview** — reuse the existing `Markdown.tsx` (react-markdown +
  remark-gfm already in deps) in a side-by-side pane, with scroll sync via
  per-block source-line mapping.
- **Image preview** — png/jpg/gif/webp/svg with zoom + dimensions readout.
- **CSV/TSV table** — parsed into a virtualized sortable grid; toggle to raw.
- **JSON** — folding (`@codemirror/lang-json` + fold service) and a collapsible
  tree view.
- **Binary/hex fallback** — null-byte sniff on the first 8KB, then an
  offset/hex/ASCII dump instead of corrupt text. Prevents the worst failure mode.
- **PDF** — Electron's Chromium renders PDFs natively; point a webview at it.

## Acceptance criteria

- Opening a `.md`, `.png`, `.csv`, `.json`, `.pdf`, and a binary each renders
  its viewer, and each offers a "view source" toggle where meaningful.
- Markdown preview scroll-syncs both directions without feedback loops.
- A binary file NEVER renders as text.
- Unknown extensions still fall through to the existing editor unchanged.
