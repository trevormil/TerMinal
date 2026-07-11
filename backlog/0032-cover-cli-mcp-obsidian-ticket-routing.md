---
id: 32
title: "Cover CLI and MCP ticket routing for Obsidian vault provider"
status: open
priority: medium
horizon: next
hitl: false
type: testing
source: test-coverage-agent
created: 2026-07-11
updated: 2026-07-11
prs: []
refs:
  - "src/main/ticket-provider.ts"
  - "bin/terminal-cli"
  - "bin/terminal-mcp-server"
depends_on: []
acceptance:
  - "A CLI-level test exercises terminal-cli ticket or the shell-friendly MCP wrapper against a temp repo configured with provider: obsidian and asserts the ticket file lands under <vault>/<ticketsSubdir>."
  - "An MCP server tool test exercises the ticket creation/listing path for an Obsidian-configured repo and asserts returned provider metadata plus no repo backlog/ fallback."
  - "Missing-vault Obsidian config is covered at the CLI/MCP boundary with a clear failure and no local backlog writes."
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

Recent Obsidian ticket-provider work added routing for agent, MCP, and CLI ticket operations. Provider-level tests now cover vault create/list/update/get behavior, but CLI and MCP entry points still need coverage proving they write to the configured vault rather than falling back to repo backlog markdown.

## Design Notes

Keep the tests hermetic with temp repos/vaults and avoid requiring real Obsidian, GitHub, Linear, or network access.
