---
id: 4
title: "Background-agent UX: /bg <prompt> — fire task, walk away, Telegram-ping when done"
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

Make "fire a task, get a Telegram ping when the PR is ready" a first-class
entrypoint. Convert async AI work from "schedule a cron" (needs forethought)
to "fire and forget" (zero ceremony).

**Filter applied:** Claude/Codex cannot notify after their own session ends.
The harness's persistent Telegram bridge + launchd runner + worktree
convention is the only layer that survives the session and closes the loop.
Background agents (Devin, Cursor cloud, Codex async) are the 2026 norm —
this is TerMinal's version using infra already shipped.

## Entrypoints

Three ways to fire a background task:

**1. Telegram** (primary — already a mobile-first surface):
```
/bg vellum-project fix the flaky drift snapshot test
/bg @agentforge document the new auth flow
/bg list                  # in-flight + recent completions
/bg cancel <id>           # SIGTERM the task
```

**2. CLI** (`bin/bg-task`):
```
bin/bg-task --repo vellum-project --prompt "fix the flaky drift snapshot test"
bin/bg-task list
```

**3. Dashboard button** (later — add a "+ Background task" button on the
Runs tab once Telegram + CLI prove the pattern).

## Mechanism

When `/bg <repo> <prompt>` fires:

1. Resolve repo via `knownRepos()` (same path Telegram already uses).
2. Create a worktree at
   `<worktrees-root>/<repo>/bg-<short-id>/` (reuses existing
   worktree convention).
3. Pick engine + model from agent defaults (or Telegram args: `/bg vellum
   claude opus fix the flaky test`).
4. Spawn detached: `nohup claude -p "$prompt" --dangerously-skip-permissions
   --model "$model" > <task-log> 2>&1 &` with `disown`.
5. Register the task in `~/.config/TerMinal/bg-tasks.json`:
   ```json
   {
     "id": "uuid",
     "repo": "vellum-project",
     "prompt": "fix the flaky drift snapshot test",
     "engine": "claude",
     "model": "sonnet",
     "worktree": "~/.worktrees/vellum-project/bg-abc1234",
     "pid": 12345,
     "startedAt": 1700000000000,
     "logFile": "~/.config/TerMinal/bg-tasks/abc1234.log",
     "status": "running"
   }
   ```
6. A post-run hook is appended to the prompt: "When finished, run
   `terminal-cli notify '✅ ${repo}: <result>'`" — leverages the existing
   notify skill so success/failure surface uniformly.
7. On exit, a small watcher (one-shot poll or `wait $pid`-style) updates
   the task record, parses the last few lines for an MR URL (regex on
   common patterns), and pings Telegram with the result.

## Watcher

Single watcher process (Bun, launched at app start) polls
`bg-tasks.json` every 5s for tasks where `status === 'running'`. For each,
it checks if the pid is alive (`kill -0`). On exit:
- Tail the task log for `https://.*/(merge_requests|pull/)/N` — extract MR URL
- Update status to `done` or `failed`
- Set `endedAt`, `exitCode`
- Send Telegram ping via existing helper:
  - ✅ MR !72 opened: "fix the flaky drift snapshot test" → link
  - ⛔ Failed (exit 1) — last 5 log lines

If the watcher itself dies, app-restart picks up where it left off (state
file is the source of truth, not the watcher's memory).

## Dashboard surface

New section on the **Runs tab** (above the unified runs list):

```
🌙 Background tasks (3 in flight, 12 done today)
  ┌────────────────────────────────────────────────┐
  │ ⏳ fix flaky drift snapshot test               │
  │    vellum-project · claude/sonnet · 4m running │
  │    [tail] [cancel]                             │
  │ ✅ document the new auth flow → MR !72         │
  │    agentforge · claude/sonnet · 8m → done      │
  └────────────────────────────────────────────────┘
```

Click [tail] → opens the task log inline (reuses the log-tail component
from the Runs tab). Click [cancel] → SIGTERM the pid.

## Cancellation

`/bg cancel <id>` or [cancel] in dashboard:
1. SIGTERM the pid
2. Wait 5s
3. SIGKILL if still alive
4. Update state to `canceled`
5. Worktree retained (user might want to inspect)
6. Telegram ping: "🛑 Canceled: <prompt>"

## Failure handling

If the task crashes (non-zero exit, no MR detected):
- File a HITL item with the task prompt + last 20 log lines + worktree path
- Telegram ping with the HITL summary
- HITL has standard [✅ Resolve] [🪵 Tail run] buttons

## Worktree lifecycle

Background tasks reuse the same worktree convention as `/code-review`,
`/iterate`, etc. Cleanup is opt-in: `bin/bg-task clean` removes worktrees
for completed tasks older than N days. Don't auto-delete on success —
keeps the diff available for review.

## Stage plan

**Stage 1** — `bin/bg-task` (spawn + register + watcher in one process for
v0, no detach). Telegram `/bg` command wraps it. Verify end-to-end with a
trivial task.

**Stage 2** — true detach + standalone watcher process. State persistence
across watcher restarts.

**Stage 3** — dashboard surface on Runs tab.

**Stage 4** — cleanup CLI + Telegram `/bg cancel`.

## Non-goals

- No new scheduler — `nohup` is enough; launchd is the cadence layer, not
  the one-shot layer.
- No queue depth limits in v1 (add if it becomes a problem).
- No retry-on-failure logic. Failed task → HITL, human re-fires.
- No "stream output to Telegram" — too chatty. Final ping only.
- No prompt templating / saved prompts. That's snippets territory.

## Risk

Low. Failures land in HITL with full context. Tasks register in a state
file, so even if the watcher dies, restart picks up the truth. SIGTERM on
cancel is graceful; worktree retained for inspection.

## Pairs naturally with

- #0001 (observability): bg-task spend rolls into the AI-fleet ledger
- #0002 (cost guardrails): a bg-task spawn checks the gate before forking
- #0003 (MCP): a background agent can call `list_tickets` to figure out
  what to work on if given a vague prompt
