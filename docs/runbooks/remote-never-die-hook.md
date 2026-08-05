# Runbook: TerMinal Remote never-die Stop hook

The remote-terminal feature keeps a phone-controlled session alive by parking it
in a **Stop hook** that blocks until the phone sends the next message. This is
what stops a session from going idle and "dying" after it finishes a task.

## What it is

- Script: `plugin/hooks/remote-check.sh` (source of truth in this repo; shipped
  globally by the tm plugin's hooks.json — no per-repo install needed. TerMinal's
  own `.claude/hooks/remote-check.sh` copy remains for app-less contributors).
- Only **phone-spawned** sessions park (`origin: phone`, set by registering
  with `--origin=phone`). A session registered locally via `/remote-terminal`
  stays `origin: local`: the hook hands it any queued replies and returns
  immediately, so it never blocks someone working at the Mac.
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

For full cross-repo coverage the hook must be registered **globally**. The tm
plugin does that for you — nothing below is needed if you run the app.

## Enable globally (one time, per machine)

**If you use TerMinal, this is already done.** The app installs the tm plugin on
launch and its `hooks/hooks.json` registers `remote-check.sh` as a `Stop` hook in
every session, in every repo. Check Settings → Updates → tm plugin, or
`claude plugin details tm`. The manual steps below are only for a machine
running Claude Code without the app.

<details>
<summary>Manual registration (no TerMinal app)</summary>

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

3. It is safe to have **several** registrations at once — the plugin's, a
   repo-level one, and a hand-made global one. The hook takes a PID lock keyed
   on the session id, so only one instance parks; the duplicates return
   immediately.

</details>

## Verify

```sh
# Register a throwaway session, then confirm the wait blocks and delivers.
# --origin=phone is required: the hook only PARKS phone-spawned sessions. A
# plain (local) registration makes the hook drain any queued replies and
# return immediately — it never blocks someone sitting at the Mac — so
# without the flag this probe exits at once instead of parking.
CLAUDE_CODE_SESSION_ID=probe terminal-cli remote register --id probe --origin=phone "probe" >/dev/null
# In another shell, after a few seconds, post a user message via the bridge/app,
# then:
printf '{"session_id":"probe"}' | ~/.claude/hooks/remote-check.sh
# → prints {"decision":"block","reason":"Message from your phone…"} on delivery,
#   or a heartbeat block after the timeout. Clean up: terminal-cli remote end --id probe
```

## Turn it off

Remove the object you added from `hooks.Stop` in `~/.claude/settings.json` (and,
per repo, from `.claude/settings.json`). No other state to clean up.
