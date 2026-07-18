---
title: HITL Inbox & Automation Inbox — contracts
anchor: INBOX
last-verified: 2026-06-05
---

# [INBOX] Inbox contracts

Detail extracted from `CLAUDE.md` [4.2]/[4.3] so the always-loaded CLAUDE.md
stays lean. CLAUDE.md keeps the one-line summary + a pointer here; the full
mechanics live below and load only when an agent actually needs them.

## [1] HITL Inbox — agents reaching the human

**One GLOBAL inbox**, not per-repo. Any skill/agent in any repo:

```bash
.claude/bin/hitl "<title>" "<action needed>" "<optional detail>"
```

Use the helper only; do not write `~/.config/TerMinal/hitl.json` directly.
It files to the TerMinal **Inbox** drawer (with an unresolved count), mirrors to
the activity feed, and **pings Telegram** directly when bot/chat are configured.
If Telegram is not set up or delivery fails, filing still succeeds; Telegram is
never a hard dependency. Failed cron runs auto-file one.

The agent-side HITL API is append-only. Agents and skills may file Inbox items
and query their status, but resolution is a human/operator action from TerMinal
Inbox or Telegram Resolve. To wait on a human decision, query the item/list
status or periodically re-check the original blocker; when it no longer blocks,
update any related `stuck` ticket back to `open` (or `in-progress` if resuming
it now), then continue the workflow. Do not leave stale blocked state behind.
Do not self-resolve your own HITL item.

Claude/Codex Stop hooks, and Cursor completion flows launched through TerMinal,
can file deterministic completion Inbox items by default. Disable only those
completion items from TerMinal Settings → Inbox, or with:

```json
{
  "inbox": {
    "completionHook": false
  }
}
```

in `~/.config/TerMinal/settings.json`. Manual/blocker Inbox filing still works.

**Reserve HITL for true human-needs** — spec forks, approvals, credentials,
OAuth/browser flows, hard blockers. **Not** for review `request-changes`
or test failures inside a workflow — those iterate.

## [2] Automation Inbox — local automation requests

For local integrations or scripts that need to request automation later, queue a
JSON event instead of running arbitrary shell inline. This is the always-on
intake path: use agents for manual runs, schedules for time-based runs, and the
Automation Inbox for external events.

```bash
terminal-cli inbox enqueue \
  --source-id local-script:repo-health \
  --source-name "Local repo health" \
  --source local-script \
  --type automation.requested \
  --repo-root "$PWD" \
  --action run-agent \
  --agent health \
  --engine codex
```

TerMinal watches `~/.config/TerMinal/automation-inbox/new/` by default,
validates and dedupes files, then moves them through `processing/`, `done`,
`failed`, or `dead-letter`. The Runs tab's Automation Inbox view shows grouped
request sources, queue counts, and recent request-to-run outcomes. Use
`terminal-cli inbox example`, `terminal-cli inbox status`, and the
`enqueue-request` skill for one-off requests. Use `new-inbox-source` to build a
durable adapter/poller/webhook bridge. Do not put arbitrary shell in inbox
events; trigger an existing agent/script or file HITL for human approval.
