---
id: 42
title: "schedules.json torn writes — make all writers atomic (tmp + rename) with a lock"
status: backlog
priority: high
horizon: next
hitl: false
type: bug
source: manual
created: 2026-07-23
updated: 2026-07-23
prs: []
refs:
  - src/main/schedules.ts
  - bin/terminal-cron
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

`schedules.json` was corrupted in the wild (truncated mid-entry, unterminated
string) by concurrent read-modify-write from three uncoordinated writers: the
app (`src/main/schedules.ts` `write()` uses a bare `writeFileSync`), the cron
runner's `stamp()` (`bin/terminal-cron`), and any external tooling. A torn
write silently loses every schedule after the truncation point; recovery
required manual reconstruction from `.bak-*` files and launchd labels.

## Acceptance criteria

- Every writer of `schedules.json` (app + terminal-cron) writes tmp-file +
  `renameSync` (atomic on the same volume), never in-place.
- Cross-process mutual exclusion for read-modify-write (e.g. an flock'd
  lockfile beside the JSON, or last-writer-wins on a per-entry store) so
  `stamp()` racing an app-side `updateSchedule()` cannot drop entries.
- `readSchedules()` on parse failure falls back to the newest parseable
  `.bak-*` and surfaces an Activity warning instead of returning `[]`.
- A timestamped `.bak` is written before any destructive rewrite (the current
  ad-hoc `.bak-*` files exist but are not written systematically).
- Test: two concurrent writers (simulated) never produce an unparseable file
  or lose an entry.

## Notes

Found during the health-checks e2e (2026-07-23): wiring three new schedules
while the app was running truncated the file to 3 of 8 entries. Same pattern
likely applies to `hitl.json` (app + terminal-cli + MCP server all write it) —
audit it in the same pass.
