---
name: listener-inbox
description: "Queue local TerMinal automation listener events. Use when an integration, script, agent, or user wants to drop a JSON request into TerMinal's local automation inbox to trigger Activity, tickets, HITL, agent runs, or background tasks."
---

# Listener Inbox

Use TerMinal's local automation inbox when work should be requested by writing a
durable JSON file instead of running immediately. The app watches:

`~/.config/TerMinal/automation-inbox/new/`

Files move through `processing/`, then `done/`, `failed/`, or `dead-letter/`.
The Schedules tab shows queue counts and recent request -> action results.

## Preferred enqueue command

```bash
terminal-cli listener enqueue '{"source":"local-script","type":"automation.requested","title":"Run repo health","repoRoot":"'"$(pwd)"'","requestedAction":{"kind":"run-agent","agentId":"health","engine":"codex","mode":"agent"}}'
```

You may also write a `.json` file directly into `automation-inbox/new/`.

## Envelope

Required:
- `source`: integration or producer id, such as `local-script`, `slack`, `github`.
- `type`: event type, such as `automation.requested` or `merge_request.opened`.

Recommended:
- `id`: stable event id. If omitted, the CLI assigns one.
- `dedupeKey`: stable idempotency key for external events.
- `repoRoot`: absolute repo path for actions that touch a repo.
- `title`, `body`: human-readable request text.
- `requestedAction`: one allowlisted action.

## Actions

```json
{ "kind": "activity", "activityKind": "info", "title": "Observed event", "detail": "..." }
{ "kind": "file-ticket", "title": "Fix webhook", "body": "...", "type": "bug", "priority": "medium" }
{ "kind": "file-hitl", "title": "Approval needed", "action": "Approve deploy" }
{ "kind": "run-agent", "agentId": "health", "engine": "codex", "mode": "agent" }
{ "kind": "run-agent", "agentId": "health", "engine": "codex", "mode": "background", "prompt": "..." }
{ "kind": "background-task", "engine": "claude", "prompt": "..." }
```

Do not put arbitrary shell in listener events. If shell is needed, create an
agent/script first and trigger it by id.

## Safety

- Use `dedupeKey` for polling/webhook integrations.
- Unknown or invalid events should be allowed to land in `failed/` or
  `dead-letter/`; do not retry by rewriting the same bad file in a loop.
- For destructive/costly actions, file HITL instead of running directly.
