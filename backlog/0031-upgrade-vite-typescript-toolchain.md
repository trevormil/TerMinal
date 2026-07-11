---
id: 31
title: "Upgrade Vite and TypeScript toolchain"
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
  - "Audit: vite 7.3.6 -> 8.1.4, published 2026-07-09T04:44:45.017Z"
  - "Audit: @vitejs/plugin-react 4.7.0 -> 6.0.3, published 2026-06-23T10:11:14.652Z"
  - "Audit: typescript 5.7.2 -> 7.0.2, published 2026-07-08T15:55:18.431Z"
depends_on: []
acceptance:
  - "Confirm vite 8.1.4 and typescript 7.0.2 are at least 72 hours old before upgrading."
  - "Review Vite 8, @vitejs/plugin-react 6, and TypeScript 7 migration notes."
  - "Bump exact pins together and refresh bun.lock."
  - "Run bun audit, bunx tsc --noEmit, bun run test, and a dev/build smoke check."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
The frontend build/typecheck toolchain has major updates available. Vite and TypeScript were still inside the 72-hour hold window during this audit, so this should be picked up after the age rule is satisfied and handled as a focused migration.
