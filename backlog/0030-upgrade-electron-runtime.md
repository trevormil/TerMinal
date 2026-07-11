---
id: 30
title: "Upgrade Electron runtime to 43.1.0"
status: open
priority: medium
horizon: next
hitl: false
type: chore
source: dependency-hygiene
created: 2026-07-11
updated: 2026-07-11
prs: []
refs:
  - "Audit: electron 41.10.1 -> 43.1.0, published 2026-07-07T19:57:09.753Z"
depends_on: []
acceptance:
  - "Review Electron 42 and 43 breaking changes before upgrading."
  - "Bump the exact package.json pin to 43.1.0 and refresh bun.lock."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
  - "Verify the Electron app launches a window after build/dev startup."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
Electron has a major upgrade available that is outside the 72-hour hold window. Because it affects the packaged runtime, this should be isolated from small package bumps and validated with an app-launch check.
