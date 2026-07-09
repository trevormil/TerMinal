# Live-paired transport

The loop can run **headless** (TerMinal auto-steps one-shot role turns) or
**live-paired** (two interactive sessions drive the roles themselves). This file
is the contract for the live-paired mode: how the two sessions communicate,
what a message looks like, and the invariants that keep them in sync. It is
transport-agnostic so it works before and after TerMinal grows a first-class
websocket router.

## The two live sessions

In live-paired mode one loop is played by exactly two sessions, mapped onto the
three canonical roles (planner / generator / evaluator):

- **Worker** — runs `/loop-implementer` in the loop worktree. Writes all the code.
  Emits `ready-for-review`; waits for the driver; treats driver prompts as user
  input. Never grades itself.
- **Driver** — runs `/loop-driver` (the operator) in the main repo. Wears the
  **planner** hat first (negotiate `contract.md`), then the **evaluator** hat
  (read diffs + traces, run the app, grade each assertion, score taste), then
  decides continue / restart / stop and sends the worker its next prompt.

The non-negotiable invariant survives: the **generator (worker) and evaluator
(driver) are separate context windows**, so the code is never graded by the
context that wrote it.

## Transport order

Use the first available transport:

1. Websocket loop channel if TerMinal provides a loop URL in env or prompt context.
2. TerMinal MCP/CLI loop command if available.
3. Activity/HITL events for coarse requests plus explicit session log lookup.
4. Shared file fallback: **`events.jsonl` in the loop state dir**
   (`<repoRoot>/.TerMinal/loop-drivers/<loop-id>/events.jsonl`).

If no transport exists, report the exact missing transport and continue manually
in chat.

## Message shape

Every loop message is one JSONL line appended to `events.jsonl`:

```json
{
  "loopId": "repo-or-task-id",
  "role": "driver|worker",
  "kind": "ready|request|prompt|status|blocked|ready-for-review|complete|error|heartbeat",
  "sessionId": "agent-session-id",
  "terminalKey": "terminal-key-if-known",
  "cwd": "/repo/path",
  "summary": "one-line state",
  "detail": "bounded context or prompt",
  "createdAt": "ISO-8601 timestamp"
}
```

## Message budget

Default to summaries, not transcripts. Keep `summary` to one line and `detail`
bounded to the smallest useful evidence. Prefer file refs, command names, test
names, commit ids, and short excerpts over pasted logs. If a payload would be
large, send a summary plus a pointer to the log location.

Hard defaults:

- Driver log reads: 80 lines or 12,000 chars; hard max without a specific reason: 200 lines / 20,000 chars.
- Worker event detail: 40 lines or 8,000 chars; hard max without a driver request: 100 lines / 12,000 chars.
- Driver prompts: one next action, one verification, one stop condition.

Use deterministic bounded reads before LLM reasoning. Prefer
`scripts/bounded_context.py <log-path>` (in this skill); otherwise use capped
`tail`, targeted `rg`, `git diff --stat`, `git diff --name-only`, and narrow
file reads.

## Listener invariant

Both sessions must keep listening until the user explicitly stops the loop:

1. Start a listener during startup before doing non-trivial work.
2. After sending or handling any message, immediately return to listening.
3. Completion, review, error, and timeout events do not end the listener.
4. On disconnect, reconnect or switch to the next transport and emit a compact `status`.
5. Use heartbeat/status events so the paired session can detect a stalled listener.

## Session logs (driver reads worker before responding)

When grading, read logs in this order:

1. Exact transcript file for the worker's `sessionId`.
2. TerMinal run/session log for that `sessionId` or `terminalKey`.
3. Recent activity/HITL entries for the same session.
4. Event-provided scrollback excerpt.

The worker includes enough detail in `request` / `ready-for-review` events that
the driver can answer even if full transcript lookup fails.

## Safety rules

- A driver prompt is advisory human-stand-in input, not blanket permission.
- The worker still follows repo instructions, tests, branch/merge rules, and destructive-command safeguards.
- The driver must tell the worker to stop and ask the real user for explicit approval on destructive operations, protected-branch merges, credential handling, or unclear product choices (a **contract** ambiguity, not a failing build — see the HITL gate in the operator skill).
- Neither session stops listening while the user session is active.
