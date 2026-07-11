---
id: 24
title: "Upgrade UIW CodeMirror packages to 4.25.11"
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
  - "Audit: @uiw/codemirror-extensions-langs 4.25.10 -> 4.25.11, published 2026-07-08T16:41:42.889Z"
  - "Audit: @uiw/react-codemirror 4.25.10 -> 4.25.11, published 2026-07-08T16:38:37.346Z"
depends_on: []
acceptance:
  - "Confirm both 4.25.11 packages are at least 72 hours old before upgrading."
  - "Bump both package.json pins exactly to 4.25.11 and refresh bun.lock."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
The UIW CodeMirror packages were safely bumped from 4.25.9 to 4.25.10 in the dependency hygiene pass, but the latest 4.25.11 releases were still inside the 72-hour hold window at audit time. Upgrade them once the age rule is satisfied.
