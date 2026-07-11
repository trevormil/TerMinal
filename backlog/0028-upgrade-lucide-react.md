---
id: 28
title: "Upgrade lucide-react to 1.24.0 once age-eligible"
status: open
priority: low
horizon: next
hitl: false
type: chore
source: dependency-hygiene
created: 2026-07-11
updated: 2026-07-11
prs: []
refs:
  - "Audit: lucide-react 1.16.0 -> 1.24.0, published 2026-07-09T13:25:23.345Z"
depends_on: []
acceptance:
  - "Confirm lucide-react 1.24.0 is at least 72 hours old before upgrading."
  - "Bump the exact package.json pin to 1.24.0 and refresh bun.lock."
  - "Smoke test icon-heavy renderer surfaces for missing or renamed icons."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
lucide-react has a same-major update available, but the latest release was still inside the 72-hour hold window during the audit. Upgrade it after the age rule is satisfied.
