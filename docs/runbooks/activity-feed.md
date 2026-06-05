---
title: Activity feed — the workflow event contract
last-verified: 2026-05-28
---

# Activity feed contract

The Activity tab is a **shared, append-only event log** that anything in the
workflow can write to — the terminal itself *and* your skills/scripts. The
terminal tails the log live, so whatever appends shows up immediately (and
raises a macOS notification for the notable kinds).

## The log

```
~/.config/TerMinal/activity.jsonl     # global, one JSON event per line
```

Override the path with `GT_ACTIVITY_LOG`. The terminal caps + reads the tail;
events are tagged with `repo`/`repoRoot` so the tab can filter all / this repo /
this session.

## Emitting an event

Use the helper (shipped at `bin/activity`, and in project-template at
`.claude/bin/activity`):

```bash
activity <kind> "<title>" ["<detail>"]
```

`kind` ∈ `deploy` · `ticket-filed` · `pr-verdict` · `session-start` · `session-end` ·
`agent-run` · `task-complete` · `info` · `error`. It derives `repo`/`repoRoot`
from git in the cwd, JSON-encodes, and appends one line. It **always exits 0** —
logging never breaks the calling skill.

Or append the JSON line yourself:

```
{"id":"<uuid>","ts":<epoch_ms>,"kind":"ticket-filed","title":"…","detail":"…","repo":"owner/repo","repoRoot":"/abs/path"}
```

## Engraining it in the workflow (project-template)

The convention is engrained in project-template's `CLAUDE.md` and skills: emit
an event at each meaningful milestone. Wire points:

| moment                         | call                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| ticket filed (`/ticket`)       | `activity ticket-filed "Ticket filed · #<id>" "<title>"`         |
| deploy shipped                 | `terminal-cli deploy production "$GIT_SHA" "v1.2.3"`             |
| review done (`/code-review`)   | `activity pr-verdict "Review · <verdict> · !<n>" "<repo> #<sha>"` |
| MR/PR opened (`/pr-creation`)  | `activity pr-verdict "PR opened · !<n>" "<title>"`               |
| session start (`/session-start`)| `activity session-start "Session · <goal>"`                      |
| session end (`/session-end`)   | `activity session-end "Session closed · <slug>" "<summary>"`     |

New skills should follow suit — one `activity` call at the milestone is the
whole integration.

For MCP callers, use the existing generic `emit_activity` operation with
`kind: "deploy"` rather than a provider-specific deploy tool.
