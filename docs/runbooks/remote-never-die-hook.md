# Runbook: TerMinal Remote never-die Stop hook

The remote-terminal feature keeps a phone-controlled session alive by parking it
in a **Stop hook** that blocks until the phone sends the next message. This is
what stops a session from going idle and "dying" after it finishes a task.

## What it is

- Script: `.claude/hooks/remote-check.sh` (source of truth in this repo; mirrored
  into `templates/project-template/.claude/hooks/`).
- It runs `terminal-cli remote check --wait`, which **blocks** polling the
  session's message log until:
  - a phone message arrives → the hook emits `{"decision":"block","reason":…}` so
    Claude Code hands it to the agent and the turn continues;
  - the session is ended (from the phone/app) → exit 0, the turn stops;
  - the wait times out with nothing new → exit 3 → the hook emits a **heartbeat**
    block so the turn ends and the hook immediately re-fires and re-parks. The
    per-run window is bounded by Claude Code's Stop-hook `timeout`; the *session*
    is not.

## Why it's not auto-installed globally

TerMinal deliberately does not write to `~/.claude` (it ships its own
`terminal-cli`/runner under `~/.config/TerMinal` and avoids touching global
Claude dotfiles). So the app will not silently edit `~/.claude/settings.json`.

Coverage without a global install:
- **Repos created from `project-template`** already register the hook in their
  own `.claude/settings.json` — never-die works there out of the box.
- A **phone-spawned session runs in whatever repo you picked**. If that repo has
  no `.claude/settings.json` Stop hook, the session will still respond to the
  first task (the agent posts on its own) but won't re-arm the listener.

For full cross-repo coverage, register the hook **globally**, once, by hand.

## Enable globally (one time, per machine)

1. Make sure the hook script is somewhere stable. Either point at a checkout, or
   copy it out:

   ```sh
   mkdir -p ~/.claude/hooks
   cp /path/to/TerMinal/.claude/hooks/remote-check.sh ~/.claude/hooks/remote-check.sh
   chmod +x ~/.claude/hooks/remote-check.sh
   ```

2. Register it as a `Stop` hook in `~/.claude/settings.json`. Add this object to
   the `hooks.Stop` array (create `hooks`/`Stop` if absent). **Merge — do not
   overwrite** any existing Stop hooks (e.g. a Telegram bridge):

   ```json
   {
     "hooks": [
       {
         "type": "command",
         "command": "/Users/<you>/.claude/hooks/remote-check.sh",
         "timeout": 3600
       }
     ]
   }
   ```

   `timeout` is in **seconds**. 3600 keeps heartbeats to ~1/hour while idle;
   raise it to make them rarer (no documented maximum; the default is 600).

3. It is safe to have **both** the repo-level and the global registration. The
   hook takes a PID lock keyed on the session id, so only one instance parks;
   the duplicate returns immediately.

## Verify

```sh
# Register a throwaway session, then confirm the wait blocks and delivers.
CLAUDE_CODE_SESSION_ID=probe terminal-cli remote register --id probe "probe" >/dev/null
# In another shell, after a few seconds, post a user message via the bridge/app,
# then:
printf '{"session_id":"probe"}' | ~/.claude/hooks/remote-check.sh
# → prints {"decision":"block","reason":"Message from your phone…"} on delivery,
#   or a heartbeat block after the timeout. Clean up: terminal-cli remote end --id probe
```

## Turn it off

Remove the object you added from `hooks.Stop` in `~/.claude/settings.json` (and,
per repo, from `.claude/settings.json`). No other state to clean up.
