---
id: 29
title: "Evaluate @types/node major-version target"
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
  - "Audit: @types/node 22.10.5 -> 26.1.1 latest, published 2026-07-08T06:47:46.733Z"
  - "Project engine currently declares node >=22.12.0"
depends_on: []
acceptance:
  - "Decide whether TerMinal should stay on the latest Node 22 type line or intentionally move to @types/node 26.x."
  - "Apply the selected exact pin and refresh bun.lock."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
@types/node is notably behind the npm latest, but blindly moving to Node 26 types may not match the declared runtime baseline. This needs an explicit target decision before changing the pin.
