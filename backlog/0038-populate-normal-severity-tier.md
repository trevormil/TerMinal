---
id: 38
title: "Populate the 'normal' inbox severity tier so the middle notify rule earns its keep"
status: closed
priority: low
horizon: later
hitl: false
type: feature
source: manual
created: 2026-07-23
updated: 2026-07-25
prs: []
refs:
  - src/main/hitl-severity.ts
  - src/main/hitl.ts
  - bin/terminal-cli
depends_on: [34]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

The inbox severity model is 3-tier (`urgent | normal | low`) with a configurable
notify threshold, but **nothing currently emits `normal`**: `defaultSeverity()`
maps completion-hook items to `low` and everything else to `urgent`. So the
middle Settings option ("Urgent + Normal") behaves identically to "Urgent only"
until a filer actually sets `normal`.

The tier exists for a reason — items that are worth an inbox entry but not a
push (e.g. an FYI, a non-blocking review request, a soft nudge). This ticket
wires at least one real producer to emit `normal` so the middle threshold is
meaningful.

## Acceptance criteria

- At least one real HITL producer emits `severity: 'normal'` for the right class
  of item (identify the class first — likely non-blocking notifications / FYIs).
- `terminal-cli` (or the MCP `file_hitl`) exposes a way to file a `normal` item.
- With threshold = `normal`, a `normal` item notifies; with threshold =
  `urgent`, the same item is inbox-only (no push). Covered by a test.
- Docs note which sources map to which tier.

## Notes

Low priority / small. Split out from the Active-tab follow-up because it's filer
emit-logic, not iOS UI. The plumbing (types, threshold gate, tag rendering)
already shipped in #34; this only adds a producer.

## Update (2026-07-25)

**Done** — two real producers now emit `normal`, so the middle threshold
finally behaves differently from 'Urgent only':

- `defaultSeverity('review-pattern')` → `normal`. The nightly review-findings
  miner's promote digest is inbox-worthy and never a block. It was also being
  filed with the inherited `cron-fail` source, which both mislabelled it and
  made it ping unconditionally — fixed.
- Budget alerts split: cap *reached* (spawns refused) stays `urgent`; an
  intermediate warn ("50% of today's budget") is `normal`. Previously a 50%
  heads-up pushed to the phone.

terminal-cron's fileHitl now applies the same inbox.notifyThreshold gate
terminal-cli and the desktop already applied — an item with no explicit
severity stays loud, so nothing that used to alert went silent. Settings'
severity legend documents all three tiers.
