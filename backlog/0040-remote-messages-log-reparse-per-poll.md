---
id: 40
title: "Remote messages endpoint re-reads the whole session log per poll"
status: backlog
priority: low
horizon: later
hitl: false
type: refactor
source: manual
created: 2026-07-23
updated: 2026-07-23
prs: []
refs:
  - src/main/remote-sessions.ts
depends_on: [34]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

`readMessages` parses the entire append-only `.jsonl` on every
`/v1/remote/:id/messages` poll. Long-lived phone sessions make this O(n) per
2s tick. Fix by tracking byte offsets per message index (or caching parse
position) so `after` skips without re-parsing.

## Acceptance criteria

- Poll cost independent of session length.
- Existing message-pagination tests green, plus a new test that a large log
  isn't re-parsed fully (measurable via a counter or seek position).

## Notes

Pure server-side perf refactor — no wire-format change, phone client
untouched.
