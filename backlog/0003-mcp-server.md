---
id: 3
title: "MCP server: expose cross-session harness state to in-session agents"
status: closed
priority: high
horizon: next
hitl: false
type: feature
source: research
created: 2026-05-30
updated: 2026-05-30
prs: []
refs: []
depends_on: []
---

Ship a small local MCP server that exposes the cross-session state Claude/
Codex sessions can't see from their own context: backlog tickets, PR review
artifacts, schedule + agent-run ledger.

**Filter applied:** sessions are sandboxed to one cwd; they cannot reach
backlog across repos, review-artifact history, or the launchd schedule
ledger. MCP is the standard protocol for surfacing that persistent state
into any tool that speaks MCP (Claude Code, Codex CLI, Cursor, Zed,
Claude.ai). Read-only — sessions still mutate via `terminal-cli` / `glab`
/ `gh` like today.

## Tools exposed

Read-only set, deliberately narrow:

```
list_tickets({ repo?: string, status?: string, type?: string }) → Ticket[]
get_ticket({ slug: string }) → Ticket | null

list_prs({ repo?: string, status?: 'opened' | 'closed' | 'merged' }) → Mr[]
get_pr_artifact({ host: string, repo: string, number: number, sha?: string })
  → { review: ReviewArtifact, tests: TestArtifact } | null
  # default sha = latest commit on the PR

list_scheduled_agents({ repo?: string }) → Schedule[]
recent_agent_runs({ repo?: string, status?: string, limit?: number }) → UnifiedRun[]

# Once #0001 lands, append:
ai_spend_today({ repo?: string, agent?: string }) → { totalUsd, byModel, byAgent }
```

No `read_file`, no `grep`, no `write_*` — the session's own tools cover code
access; the MCP surface only exists for the harness's persistent layer.

## Transport

Stdio MCP server. In-session agents launch it as a subprocess via their
MCP config. Local-only — no network port, no auth needed (single-user
boundary).

`bin/terminal-mcp-server` runs the JSON-RPC loop. Same Bun-script pattern
as `bin/terminal-cli` + `bin/terminal-cron`.

## Wiring agents

Per the user's session: each agent's `.sh` already runs `claude -p` / `codex
exec`. We extend the runner to write a temporary MCP config naming this
server, and pass `--mcp-config <path>` (or env equivalent) to the CLI. Then
in-session `claude` / `codex` see harness tools alongside their built-ins.

For interactive (non-headless) sessions started via TerMinal's terminal pane,
we drop a global MCP entry in `~/.claude/mcp_settings.json` (or codex
equivalent) at bootstrap-or-app-launch so every Claude/Codex session in any
shell gets it for free.

## Source-of-truth mappings

Each tool reads the same files the dashboard reads — no new store:

| Tool | Source |
|---|---|
| `list_tickets` / `get_ticket` | `src/main/backlog.ts` `listTickets` / `getTicket` |
| `list_prs` / `get_pr_artifact` | `src/main/mrs.ts` + `prs/<host>/<repo>/<num>/<sha>.md` |
| `list_scheduled_agents` | `src/main/schedules.ts` `readSchedules` |
| `recent_agent_runs` | `src/main/cron-runs.ts` `listAllRuns` |
| `ai_spend_today` (later) | `~/.config/TerMinal/ai-stats/<today>.json` from #0001 |

Server initializes by importing those modules' read functions (no fork of
the logic). When schema evolves, the MCP layer adapts.

## Multi-repo dispatch

The dashboard knows about every tracked repo via `prs/config.yml` +
schedules.json. The MCP server reads the same configs — so a session running
inside vellum-project can call `list_prs({ repo: 'agentforge' })` and get
results for a sibling repo without leaving its sandbox.

## Bootstrap integration

`project-template/bootstrap.sh` extended to drop a small note in the new
repo's CLAUDE.md: "This repo is part of a TerMinal harness — call
`list_tickets`, `list_prs`, etc. via MCP to query cross-session state."

## Stage plan

**Stage 1** — server skeleton (`bin/terminal-mcp-server`) + JSON-RPC loop +
stdio transport + 2 simplest tools (`list_tickets`, `get_ticket`). Verify
via `mcp` CLI inspector.

**Stage 2** — full read-only set (`list_prs`, `get_pr_artifact`,
`list_scheduled_agents`, `recent_agent_runs`).

**Stage 3** — wiring: extend `runSpec` + `bin/terminal-cron` to pass MCP
config; drop global MCP entry at bootstrap. Test end-to-end with an
agent that calls a harness tool mid-run.

**Stage 4 (after #0001 lands)** — append `ai_spend_today`.

## Non-goals

- No write tools. Sessions mutate via existing CLIs (`terminal-cli` for
  HITL/tickets, `glab`/`gh` for MRs).
- No code-access tools. `read_file` / `grep` already live in the session.
- No remote/network MCP. Local stdio only — single-user boundary.
- No auth/permissioning. Boundary is "this user's machine."
- Not a wrapper for the dashboard's REST endpoints. The dashboard serves
  humans; MCP serves agents. Different lanes, same data source.

## Risk

Low. Read-only kills the blast radius. Maintenance is keeping the tool
schema honest as ticket/PR/schedule shapes evolve — one file co-located
with the existing IPC handlers makes the parity check obvious.

## Follow-up ideas (don't file yet)

- An MCP server EXPOSED by external knowledge tools the harness consumes
  (e.g. read Greptile/Augment via MCP if/when it makes sense) — but not as
  a build for us.
- A read-only "live activity feed" tool for agents to react to other
  agents' work in real time. Defer until there's a concrete use case.
