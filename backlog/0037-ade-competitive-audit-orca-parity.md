---
id: 37
title: "ADE competitive audit: Orca feature parity + survey other ADEs, shortlist features to steal"
status: closed
priority: medium
horizon: next
hitl: true
type: feature
source: manual
created: 2026-07-24
updated: 2026-07-25
prs: []
worked_by: []
refs: []
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
model_tier: top
---

## Description

Orca by Stably AI (onorca.dev, github.com/stablyai/orca, MIT, ~28k stars) is
the most prominent "Agent Development Environment" and overlaps heavily with
TerMinal. A 2026-07-24 research pass produced a full cross-comparison; the
headline gaps where Orca is ahead: interactive diff review (Annotate AI Diff —
gutter comments on diff lines batched back to the agent until resolved),
Design Mode (click a rendered UI element → HTML + computed CSS + screenshot +
source line into the agent prompt), breadth of agent CLIs (~35 presets + custom),
native mobile apps, and an "agents can script the app itself" CLI. This ticket
is the structured follow-up: build a parity matrix, survey the wider ADE
landscape, and shortlist what TerMinal should actually steal — as tickets, not
as a report that rots.

## Acceptance criteria

- A parity matrix doc exists at `docs/research/ade-landscape.md` comparing
  TerMinal against Orca **plus at least 4 other ADEs / agent managers**
  (candidates: Conductor, Sculptor, Vibe Kanban, Terragon, Cursor background
  agents, Devin, OpenHands — pick the 4+ most relevant), covering at minimum:
  engines supported, parallelism/worktree model, diff review, orchestration/
  scheduling, HITL/approvals, remote/mobile, observability/cost, review→agent
  feedback loop, safety posture (permissions/merge gates).
- Each matrix row for TerMinal is verified against the actual codebase (not
  README claims); each competitor row cites a source URL.
- The doc ends with a ranked "steal list": every candidate feature gets a
  verdict (`steal` / `adapt` / `skip`) with a one-paragraph rationale grounded
  in TerMinal's factory workflow. Annotate-AI-Diff-style review comments and
  Design Mode MUST be evaluated; evaluating them and concluding `skip` is a
  valid outcome.
- For every `steal`/`adapt` verdict, a follow-up backlog ticket is filed
  (one feature per ticket, with its own acceptance criteria) and linked from
  the doc — this ticket does NOT implement any of them.
- HITL checkpoint: the ranked steal list is surfaced for human review (HITL
  item) before follow-up tickets are filed.

## Design notes

- Seed material: the 2026-07-24 comparison covered Orca's docs (~20 subpages),
  GitHub releases, and third-party reviews (andrew.ooo). Key Orca facts to
  reuse: worktree-native model, `orca orchestration` coordinator loop,
  `orca automations` (cron/RRULE), Orca CLI (terminal/browser/worktree
  scripting), skills registry via `npx skills add`, default
  `--dangerously-skip-permissions` launch posture, remote `orca serve` +
  Tailscale pairing, iOS/Android companions with no cloud relay.
- Judge candidates against TerMinal's invariants, not feature-count: agents
  never merge; local-first, no server/telemetry; ticket→run→PR lineage is the
  spine. A feature that fights those (e.g. auto-merge) is an automatic `skip`.
- Overlap check before filing follow-ups: 0034 (mobile PWA, icebox) already
  covers the mobile gap — reference it rather than duplicating.
- This is research + ticket-filing work with judgment throughout → `top` tier,
  no downgrade.

## Resolution (2026-07-25)

**Done** — the audit ran (Orca docs + Cursor/VS Code, in parallel) and its output is
now tracked as six batched implementation tickets rather than living here:

- #0044 file viewers (markdown/image/CSV/JSON/binary/PDF)
- #0045 editor quality-of-life
- #0046 navigation, quick-open, project search
- #0047 file-tree affordances
- #0048 diff review surface
- #0049 agent↔file integration (the differentiated cluster)

Top Orca steals captured in those tickets: line-pinned diff comments batched into one
agent prompt, AI-attribution gutter markers, in-tab Changes View, drag-a-file-onto-an-
agent-terminal, gitignored files as a second tier in quick-open, and image diff
swipe/onion-skin.
