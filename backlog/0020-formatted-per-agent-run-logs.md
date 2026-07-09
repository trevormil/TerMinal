---
id: 20
title: "Formatted per-agent run logs (structured, not a wall of text) — Runs, CI, all run views"
status: open
priority: medium
horizon: next
hitl: false
type: feature
source: brainstorm
created: 2026-07-09
updated: 2026-07-09
prs: []
refs: []
depends_on: []
acceptance:
  - "Run logs render as a structured, readable transcript (steps / tool calls / assistant messages / command output) instead of one raw scrollback blob"
  - "Formatting is engine-aware: claude (stream-json), codex/openrouter (exec), cursor, hermes — each parsed into the shared structured view via a per-engine adapter"
  - "Applies everywhere run output is shown: the Runs tab, in-process agent runs, cron/scheduled runs, and CI/forge job logs"
  - "Collapsible sections (per step / per tool call) with the raw text still one click away; long output is bounded/virtualized so huge logs stay responsive"
  - "Graceful fallback to the current raw view when a log can't be parsed"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

Run output today is a **wall of raw text** — the concatenated stdout/stderr
scrollback (`run.output` in `src/main/agents.ts`, the Runs tab, CI job logs).
It's hard to scan: you can't quickly see the steps, which tool ran, the final
result, or errors.

Build a **structured run-log view**: parse each run's output into a sequence of
typed entries (step boundary, assistant message, tool call + result, shell
command + output, error, final summary) and render them as a formatted,
collapsible transcript. The parsing is **engine-aware** via a per-engine adapter
(claude emits stream-json; codex/openrouter go through `codex exec`; cursor;
hermes `-z`) feeding one shared structured model — mirrors how
`createAgentStreamDecoder` already special-cases engines.

Must cover every surface that shows run output: Runs tab, in-process agent runs,
scheduled/cron runs, and forge CI job logs. Keep a raw-text fallback (and a
"show raw" toggle) for anything unparseable, and bound/virtualize very long logs.

## Notes
- The renderer already has `createAgentStreamDecoder` (src/main/agent-stream.ts)
  that strips harness noise per engine — the structured parser is the natural
  next layer on top of that.
- Consider reusing the observability transcript parsing (data.ts) for Claude
  sessions where a real transcript exists.
