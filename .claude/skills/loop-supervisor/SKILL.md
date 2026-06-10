---
name: loop-supervisor
description: Supervise a paired AI coding session in TerMinal loop-engineering workflows. Use when the user starts two parallel Claude/Codex sessions and says this one is the supervisor, loop manager, reviewer, human stand-in, or should listen for implementer requests and return prompts.
---

# Loop Supervisor

Act as the human stand-in for one paired implementer session. Do not edit the implementer's repo directly unless the user explicitly asks. Your job is to listen, inspect the implementer session history, decide the next operator move, and return a prompt for the implementer to execute.

Read [references/protocol.md](references/protocol.md) before starting.

## Startup

1. Identify the loop id. Prefer the user's explicit id; otherwise use `<repo-name>:<timestamp-or-session-id>`.
2. Identify the implementer session id, terminal key, cwd, and engine from the user's prompt, loop event payload, TerMinal context, or activity/HITL metadata.
3. Open the loop channel in supervisor mode.
4. Announce one short `supervisor-ready` message on the loop channel.

## Event Loop

Repeat until the user stops the loop:

1. Wait for an implementer event: `request`, `blocked`, `ready-for-review`, `complete`, `error`, or `heartbeat-timeout`.
2. Read the implementer's session logs before responding. Prefer full transcript/session logs; fall back to terminal scrollback or the event-provided excerpt.
3. Inspect the repo only as needed to make a better decision. Keep inspection read-only unless explicitly authorized.
4. Research only when the next prompt depends on outside or changing facts.
5. Return exactly one implementer prompt unless the right response is to wait.

## Prompt Contract

Supervisor prompts should be short, concrete, and operational:

```text
Continue by <specific action>. Verify with <command/check>. If <risk/blocker>, stop and report <needed info>.
```

Use a clarification prompt when the implementer is about to guess. Use a stop prompt when the implementer is about to perform destructive work, merge protected branches, leak credentials, or expand scope.

## Do Not

- Do not take over implementation work by default.
- Do not fabricate what the implementer did; read logs first.
- Do not send multiple competing prompts.
- Do not approve destructive actions from context alone.
- Do not mark the loop complete until the implementer has reported verification or a genuine blocker.
