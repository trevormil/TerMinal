---
id: 34
title: "Mobile remote-control PWA served from the TerMinal main process"
status: closed
priority: low
horizon: future
hitl: false
type: feature
source: manual
created: 2026-07-20
updated: 2026-07-25
prs: []
refs:
  - "src/main/index.ts"
  - "src/preload/index.ts"
  - "src/renderer/src/lib/types.ts"
depends_on: []
acceptance:
  - "A settings toggle (default off) starts an authenticated HTTP + WebSocket server in the main process; token auth required on every request; server binds only when enabled."
  - "The server exposes read-only endpoints backed by the existing Gt IPC handlers for at minimum: runs (with live output tail over WebSocket), HITL inbox, tickets, schedules, and activity."
  - "A mobile-responsive PWA is served by that same server (add-to-home-screen installable, no app store) with at minimum a Runs live-tail view and the HITL inbox queue."
  - "HITL items can be resolved (approve/deny/answer) from the PWA; the write path goes through the existing resolve flow, not a parallel one."
  - "Write operations beyond HITL resolve are out of scope for the first slice (merge button, ticket filing, session input come later as follow-up tickets)."
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

A phone-sized remote control for TerMinal while the Mac is awake: watch live
run/session output, drain the HITL inbox, and glance at tickets/schedules/
activity from anywhere on the tailnet. Deliberately not an always-on service —
no relay, no fleet sync, no push infra. The phone talks straight to the Mac
over Tailscale/WireGuard; `ssh tm` covers the headless case. Complements the
Telegram notify bridge rather than replacing it: Telegram says *something needs
you*, this is *where you act on it*.

## Design notes

- The `Gt` IPC surface (main handlers + preload + `types.ts`) is already the
  enumerated API — the server is a second transport over the same handlers,
  not a new backend. Keep all three in agreement per the repo convention.
- The `listener-inbox` contract is the natural shape for any future
  untrusted write path beyond HITL resolve.
- Live session/pty streaming over WebSocket is the marquee feature Telegram
  cannot approximate; it is easy precisely because this model assumes the Mac
  is on.
- Iceboxed by design: filed to capture the agreed shape, not scheduled work.

## Resolution (2026-07-25)

**Delivered** — superseded in approach and shipped. The PWA framing was replaced by a
native SwiftUI iOS app (TerMinal Remote), merged via the #119 → #132 → #124 → #125 →
#131 → #127 → #128 → #126 → #129 → #130 stack. It covers the original goal (drive a
live agent session from the phone) plus workspaces, tickets/PRs/runs/schedules/CI,
Inbox, Monitoring, Activity, an app lock, and Tailscale pairing.
