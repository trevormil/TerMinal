---
id: 19
title: "Additional alert-manager channels beyond Telegram (Slack / email / desktop / webhook)"
status: open
priority: medium
horizon: next
hitl: false
type: feature
source: brainstorm
created: 2026-07-09
updated: 2026-07-09
prs: []
refs: []
depends_on: []
acceptance:
  - "Notifications (completion/blocker/HITL pings) can be delivered to at least one non-Telegram channel — pick from Slack, email (SMTP), macOS desktop notification, or a generic outbound webhook"
  - "A channel abstraction exists so adding a new provider is a small, isolated change (not another hardcoded branch); Telegram becomes one implementation of it"
  - "Per-channel enable + credentials live in Settings (sealed like openrouterApiKey), and multiple channels can be armed at once"
  - "emitActivity/notify routes to all enabled channels; a channel failure never blocks the others or the run"
  - "The notify skill + docs updated to describe the channel-agnostic bridge"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

Today the AFK/alerting bridge is **Telegram-only**: `notify` skill →
`~/.claude/bin/telegram-notify.sh` + `src/main/telegram*.ts`, and `emitActivity`
notifications assume the Telegram transport. Users who don't use Telegram get no
out-of-app alerts.

Introduce an **alert-manager abstraction** (a small `NotifyChannel` interface:
`send(kind, title, detail, refs)`), refactor the existing Telegram path to be one
implementation, and add at least one more channel. Good candidates, cheapest
first: macOS desktop notification (already have `electron` Notification),
generic outbound webhook (POST JSON — trivial + covers Slack/Discord via their
incoming-webhook URLs), then native Slack / email (SMTP) if wanted.

Config per channel in Settings (sealed secrets), multiple can be armed, and
delivery fans out to all enabled channels with per-channel failure isolation.

## Notes
- Telegram control (inbound replies) is a separate, richer capability — this
  ticket is about OUTBOUND alerts first; inbound parity per channel is a
  follow-up.
- Reuse the existing `emitActivity` kinds (done/blocked/question/info) as the
  channel-agnostic event shape.
