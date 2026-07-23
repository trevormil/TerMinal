---
id: 41
title: "Phone-sent multi-line prompts: bracketed paste / newline handling in autoSubmit"
status: backlog
priority: low
horizon: later
hitl: false
type: bug
source: manual
created: 2026-07-23
updated: 2026-07-23
prs: []
refs:
  - src/renderer/src/components/Terminal.tsx
depends_on: [34]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

`autoSubmit` writes prompt bytes raw plus a trailing `\r`. In most agent TUIs
a raw `\n` inside a multi-line prompt acts as Enter, so the prompt submits at
the first newline and the trailing `\r` fires an empty second submission.

Fix: send via bracketed-paste framing (`ESC[200~ … ESC[201~`) or normalize
newlines; also clear the nested timers on unmount.

## Acceptance criteria

- A multi-line prompt sent from the phone lands as ONE submission.
- Covered by a unit test on the write-framing helper.

## Notes

Only reproduces with multi-line prompts from the phone; single-line prompts
are unaffected.
