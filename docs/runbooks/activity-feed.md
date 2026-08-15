---
title: Activity feed — the workflow event contract
last-verified: 2026-08-14
---

# Activity feed contract

The Activity tab is a **shared, append-only event log** that anything in the
workflow can write to — the terminal itself *and* your skills/scripts. The
terminal tails the log live, so whatever appends shows up immediately (and
raises a macOS notification for the notable kinds).

## The log

```
~/.config/TerMinal/activity.jsonl     # global, one JSON event per line
~/.config/TerMinal/activity-1.jsonl   # previous generation (rotated)
~/.config/TerMinal/activity-2.jsonl   # the one before that
```

Override the path with `GT_ACTIVITY_LOG`. Events are tagged with
`repo`/`repoRoot` so the tab can filter all / this repo / this session.

**Rotation.** Once the live log passes 5 MB the app renames it to
`activity-1.jsonl` and starts a fresh one, keeping two generations behind it.
Writers are unaffected — they open the path and append, exactly as before.
Rotation is the app's job (`maybeRotateActivityLog` in `src/main/events.ts`),
fired after its own appends and after it drains an external one. It replaced a
compaction that ran inside the *read* path and silently deleted everything past
the newest 2000 events.

**Reads are paginated, never whole-file.** `src/shared/activity-log.ts` is the
one reader the app, the CLI bundles and the MCP server all share. It reads the
log BACKWARDS in 64 KB blocks, so:

- a page costs the size of the page, not the size of the history, and comes back
  with a byte-offset cursor for the next (older) page — spanning generations;
- the tab badge's "unseen since" count early-exits at the first event older than
  `since`, and is memoized against the log's size;
- live tailing is a forward byte-delta read of the newly appended bytes only.

A half-written trailing line is never parsed: every reader stops at the last
complete line and picks the rest up on the next pass.

## Emitting an event

Use the helper (shipped at `bin/activity`, and globally via the tm plugin at
`~/.config/TerMinal/plugin/bin/activity`):

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
