---
id: 27
title: "Upgrade React runtime and type packages"
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
  - "Audit: react 19.0.0 -> 19.2.7, published 2026-06-01T18:00:48.323Z"
  - "Audit: react-dom 19.0.0 -> 19.2.7, published 2026-06-01T18:01:02.438Z"
  - "Audit: @types/react 19.0.2 -> 19.2.17, published 2026-06-05T20:10:24.692Z"
  - "Audit: @types/react-dom 19.0.2 -> 19.2.3, published 2025-11-12T04:37:39.524Z"
depends_on: []
acceptance:
  - "Review React 19.1/19.2 and type-package release notes for app-facing changes."
  - "Bump exact pins together and refresh bun.lock."
  - "Smoke test renderer startup and core tabs after the automated suite passes."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
React and its DOM/type packages are on the initial 19.0 line while newer 19.2 releases are available. Bundle these together so runtime and type surfaces stay aligned.
