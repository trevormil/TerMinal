# 9. Cursor's model catalog is read from the CLI, not hand-maintained

Date: 2026-07-22

## Status

Accepted

## Context

Cursor announced **Cursor Router** on 2026-07-22 — a server-side classifier that
routes an `auto` request to whichever model it judges best for the task, at
lower cost, on Teams/Enterprise plans. It's available "across desktop, web, iOS,
CLI, and our SDK" ([cursor.com/blog/router](https://cursor.com/blog/router)).

We already offer `auto` in the Cursor engine's model list, so **Router already
applies** for Teams/Enterprise users with no change — `cursor-agent --model auto`
is the entry point.

Two real problems remained:

1. **The catalog drifts.** `ENGINE_MODELS.cursor` in `lib/engines.ts` is
   hand-maintained. `cursor-agent --list-models` on this account returns **174**
   models; the hardcoded list had **14**, already missing `gpt-5.3-codex-low`,
   `cursor-grok-4.5-high`, and the `gpt-5.6-sol-*` tier. Cursor ships new ids
   continuously, so a static list is stale the day it's written — and any ids
   Router introduces would never appear.

2. **The optimization modes have no CLI surface.** Intelligence / Balance / Cost
   are chosen in Cursor's model picker or the team admin dashboard. There is no
   `cursor-agent` flag, no model-string suffix, and no trace of the mode strings
   in the latest CLI binary (verified by grepping `2026.07.20-8cc9c0b`). They are
   account/team settings inherited by CLI sessions.

## Decision

- **Read Cursor's catalog from the CLI.** A `cursor:models` IPC shells
  `cursor-agent --list-models`, parsed by a pure `parseCursorModels()` and
  memoised for 30 minutes. The `EngineModelPicker` fetches it when the menu first
  opens (not on mount — most pickers are never opened) and uses it for the
  `cursor` engine only.
- **Fall back to the static catalog** whenever the CLI is missing, logged out, or
  slow — the fetch returns `[]` and the picker keeps `ENGINE_MODELS.cursor`, so a
  failure degrades to today's behaviour rather than an empty picker. `[]` is
  never cached, so a transient failure doesn't pin the fallback.
- **Label `auto` as the Router entry point** ("auto · Router") in both the live
  and static lists.
- **Do not model the optimization modes.** There is no CLI surface for them;
  anything we built would be a guess. Users pick their mode in Cursor.

## Consequences

- New Cursor models — and any Router variants Cursor exposes as ids — appear the
  same day, with no release. The client is a dumb renderer of the server's list.
- One `cursor-agent` invocation per picker-open per 30 min. Bounded by the 8s
  timeout; a hung CLI degrades to the static list.
- We surface Router without pretending to control its modes. If Cursor later adds
  a CLI flag for Intelligence/Balance/Cost, that's a follow-up — this decision is
  intentionally silent on it rather than inventing an interface.
- The static `ENGINE_MODELS.cursor` list stays as the offline fallback; it can go
  stale without harming users who have the CLI, but it should still be refreshed
  occasionally for the CLI-less case.
