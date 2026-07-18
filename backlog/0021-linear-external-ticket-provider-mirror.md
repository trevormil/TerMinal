---
id: 21
title: "External ticket providers (Linear, etc.) — remote source of truth, local mirror, frequent sync"
status: closed
priority: medium
horizon: next
hitl: false
type: feature
source: brainstorm
created: 2026-07-09
updated: 2026-07-18
prs: []
refs: []
depends_on: []
acceptance:
  - "A new ticket provider (start with Linear) plugs into the existing provider abstraction (src/main/ticket-provider.ts — repoTicketProvider/provider.kind, alongside local/github/gitlab)"
  - "Remote is the source of truth: the provider pulls issues from Linear and mirrors them into the local backlog view; edits made remotely appear locally after a sync"
  - "A local mirror/cache is kept on disk so the Tickets tab renders offline and instantly (no per-render API calls), refreshed by a frequent background sync"
  - "Sync runs often + on demand: a poll interval (configurable) plus a manual refresh; last-synced time surfaced in the UI"
  - "Writes (status change, comment, PR link) go to the remote and are reflected back into the mirror; conflicts resolve remote-wins"
  - "Sealed API credentials per provider in Settings (like openrouterApiKey); provider selectable per repo/workspace"
  - "The abstraction is generic enough that a second provider (e.g. Jira/Height) is a small isolated addition, not a rewrite"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

> **Dropped 2026-07-10** — superseded by the **Obsidian** ticket provider
> (#27/#28), which delivers the local, private, offline ticketing this ticket was
> really after, without a cloud source of truth or sync machinery. The existing
> Linear provider code stays as-is; the full remote-mirror build-out is no longer
> planned.

## Description

TerMinal already abstracts ticket providers (`src/main/ticket-provider.ts` —
`repoTicketProvider`, `provider.kind` ∈ `local | github | gitlab`, plus
`ticketProviderInstructions`). Extend it to support **external issue trackers,
starting with Linear**, on a **remote-source-of-truth + local-mirror** model:

- Pull issues from the remote (Linear GraphQL API) and mirror them into the
  local backlog representation so the Tickets tab reads a fast on-disk cache
  rather than hitting the API on every render.
- **Sync often** — a configurable background poll + a manual "refresh now", with
  a visible last-synced timestamp. Remote wins on conflict.
- Writes (status, comments, PR links) propagate to the remote and update the
  mirror.
- Sealed per-provider credentials in Settings; provider chosen per
  repo/workspace. Keep the layer generic so Jira/Height/etc. are small additions.

This mirrors how the forge layer already treats GitHub/GitLab as remote sources
with local enrichment — apply the same shape to tickets.

## Notes
- Scope v1 to Linear (read + basic write + sync); other providers are follow-ups
  once the mirror/sync machinery exists.
- The local mirror format should reuse the existing backlog ticket shape so the
  Tickets UI, agent ownership, and run-linking all work unchanged.
