---
id: 37
title: "Retire the never-die heartbeat in favor of app-side pty re-injection"
status: backlog
priority: medium
horizon: next
hitl: false
type: refactor
source: manual
created: 2026-07-23
updated: 2026-07-23
prs: []
refs:
  - src/main/bridge/server.ts
  - src/main/agents.ts
  - docs/decisions
depends_on: [34]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

The remote "never-die" mechanism (a session parks itself and stays registered
instead of exiting) is currently kept alive by a **blocking Stop hook that burns
an LLM turn roughly hourly** while the session is idle. It works, but it is:

- **Noisy / costly** — an idle parked session should cost ~nothing; instead it
  wakes the model on a timer just to say "still here."
- **Slightly fragile** — it leans on Claude Code's hook-timeout behavior, which
  we don't own and which could change out from under us.

The cleaner design, deferred from the mobile-remote v1 (#34), is **app-side pty
re-injection**: the Electron main process owns the parked pty and keeps the
session registered/heartbeated from the *app*, injecting the next prompt
directly into the pty when one arrives over the bridge — no model turn spent on
staying alive.

## Acceptance criteria

- An idle parked remote session consumes **zero LLM turns** while waiting.
- A prompt sent from the phone still reaches the live agent and streams back
  (existing e2e for #34 stays green).
- Session survives desktop→remote→desktop handoff without a heartbeat turn.
- The old Stop-hook heartbeat path is removed (or gated off), not left dormant.
- ADR added/superseded documenting the mechanism change.

## Notes

Separate subsystem from the iOS UI — deliberately NOT bundled into the Active-tab
follow-up. Touches the desktop never-die machinery and needs its own e2e pass.
