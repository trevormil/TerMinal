---
name: new-persistent-agent
description: "Create a global TerMinal persistent memory agent. Use when the user runs /new-persistent-agent or asks for a memory-aware agent that keeps its own INSTRUCTIONS.md, MEMORY.md, STATE.md, JOURNAL.md, and artifacts directory."
---

# /new-persistent-agent - Create a persistent memory agent

Create one global, directory-backed TerMinal persistent agent.

## Target

Persistent agents live outside repos:

```text
~/.config/TerMinal/persistent-agents/<id>/
```

Create exactly one new directory with:

- `agent.json`
- `INSTRUCTIONS.md`
- `MEMORY.md`
- `STATE.md`
- `JOURNAL.md`
- `artifacts/`

## Schema

`agent.json`:

```json
{
  "id": "kebab-case",
  "title": "Short label",
  "description": "One-line purpose",
  "engine": "claude",
  "model": "",
  "tags": [],
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```

`engine` may be `claude`, `codex`, or `cursor`.

## File Guidance

- `INSTRUCTIONS.md`: stable operating guidance for this agent.
- `MEMORY.md`: durable facts, preferences, decisions, and recurring lessons.
- `STATE.md`: current status, open threads, and next actions.
- `JOURNAL.md`: append-only run history. Add an initial creation entry.
- `artifacts/`: empty directory for future outputs.

## Rules

- Do not create repo-local `.agents` files for this skill.
- Do not open a PR/MR.
- Do not modify the current repo unless explicitly requested.
- Keep initial memory sparse; durable memories should come from later runs.
- End with the created agent id and absolute directory path.
