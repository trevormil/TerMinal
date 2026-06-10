# TerMinal Loop Protocol

This is the role contract for paired loop-engineering sessions. It is intentionally transport-agnostic so it works before and after TerMinal grows a first-class websocket router.

## Roles

- `supervisor`: listens for implementer requests, reads session logs, researches when useful, and sends the next human-style prompt.
- `implementer`: does the work, emits status/events, waits for supervisor prompts when blocked or complete, and treats supervisor prompts as user input.

## Transport Order

Use the first available transport:

1. Websocket loop channel if TerMinal provides a loop URL in env or prompt context.
2. TerMinal MCP/CLI loop command if available.
3. Activity/HITL events for coarse requests plus explicit session log lookup.
4. Shared file fallback: `.TerMinal/loops/<loop-id>.jsonl` in the repo, or `~/.config/TerMinal/loops/<loop-id>.jsonl` for cross-repo loops.

If no transport exists, report the exact missing transport and continue manually in chat.

## Message Shape

Every loop message should be JSONL-compatible:

```json
{
  "loopId": "repo-or-task-id",
  "role": "supervisor|implementer",
  "kind": "ready|request|prompt|status|blocked|complete|error|heartbeat",
  "sessionId": "agent-session-id",
  "terminalKey": "terminal-key-if-known",
  "cwd": "/repo/path",
  "summary": "one-line state",
  "detail": "bounded context or prompt",
  "createdAt": "ISO-8601 timestamp"
}
```

## Session Logs

When supervising, read logs in this order:

1. Exact transcript file for `sessionId`.
2. TerMinal run/session log for `sessionId` or `terminalKey`.
3. Recent activity/HITL entries for the same session.
4. Event-provided scrollback excerpt.

When implementing, include enough detail in `request` events that a supervisor can answer even if full transcript lookup fails.

## Safety Rules

- A supervisor prompt is advisory human input, not blanket permission.
- The implementer still follows repo instructions, tests, branch/merge rules, and destructive-command safeguards.
- The supervisor must tell the implementer to stop and ask the user for explicit approval on destructive operations, protected-branch merges, credential handling, or unclear product choices.
