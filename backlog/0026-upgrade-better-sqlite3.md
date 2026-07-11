---
id: 26
title: "Upgrade better-sqlite3 to 12.11.1"
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
  - "Audit: better-sqlite3 12.10.0 -> 12.11.1, published 2026-06-15T19:15:08.728Z"
depends_on: []
acceptance:
  - "Review better-sqlite3 12.11.x release notes for native-build or runtime behavior changes."
  - "Bump the exact package.json pin to 12.11.1 and refresh bun.lock."
  - "Confirm electron-rebuild succeeds for better-sqlite3."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
better-sqlite3 has a same-major update available, but it is a native dependency in the app runtime and should be validated independently from broader dependency churn.
