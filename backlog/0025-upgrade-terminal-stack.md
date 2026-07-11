---
id: 25
title: "Upgrade terminal rendering dependency stack"
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
  - "Audit: @xterm/xterm 5.5.0 -> 6.0.0, published 2025-12-22T13:50:12.430Z"
  - "Audit: @xterm/addon-fit 0.10.0 -> 0.11.0, published 2025-12-22T13:50:25.004Z"
  - "Audit: @xterm/addon-web-links 0.11.0 -> 0.12.0, published 2025-12-22T13:50:56.509Z"
  - "Audit: node-pty 1.0.0 -> 1.1.0, published 2025-12-22T13:51:43.876Z"
depends_on: []
acceptance:
  - "Review xterm/node-pty changelogs for breaking behavior before upgrading."
  - "Bump exact pins and refresh bun.lock; confirm electron-rebuild succeeds for node-pty."
  - "Verify terminal launch, resize/fit, search, and web-link behavior manually or with targeted coverage."
  - "Run bun audit, bunx tsc --noEmit, and bun run test."
agent_id: dep-upgrade
agent_scope: global
agent_kind: classic
---

## Description
The terminal stack has coordinated minor/major updates available. This should be handled as one focused upgrade because the packages interact directly in the PTY and terminal renderer path.
