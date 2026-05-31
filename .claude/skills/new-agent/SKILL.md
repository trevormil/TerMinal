---
name: new-agent
description: "Create or update a TerMinal agent from a natural-language request. Use when the user runs /new-agent, says to create an agent, or wants a reusable button/scheduled agent. Writes a script-first .agents/<id>.sh plus .agents/<id>.json sidecar."
---

# /new-agent — Create a TerMinal agent

Create a repo-local TerMinal agent as a bash script plus JSON sidecar. Agents
show up in the TerMinal Agents tab and can be run manually or scheduled.

## Target files

Default target is the current repo:

- `.agents/<id>.sh` — executable script body (`chmod 755`)
- `.agents/<id>.json` — metadata sidecar

If the user explicitly asks for a global agent, write to
`~/.config/TerMinal/scripts/<id>.sh` and `<id>.json` instead.

## Workflow

1. Read enough local context before writing:
   - `CLAUDE.md` / `AGENTS.md`
   - `.agents/scripts.md` if present
   - `.agents/forge.md` if the agent may open a PR/MR
   - existing `.agents/*.sh` and `.agents/*.json` to avoid duplicate ids
2. Pick a short kebab-case `id`, a clear `title`, a one-line `description`, and
   a lucide icon name.
3. Write the bash script. Prefer deterministic checks first, then call an LLM
   only when useful.
4. Write the sidecar JSON.
5. Verify the script is executable and summarize the paths.

## Script contract

Use this shape:

```bash
#!/usr/bin/env bash
set -uo pipefail

repo="${TERMINAL_REPO:-$(git rev-parse --show-toplevel)}"
worktree="${TERMINAL_WORKTREE:-$repo}"
engine="${TERMINAL_ENGINE:-claude}"
model="${TERMINAL_MODEL:-}"

# Do deterministic work first. For TerMinal helpers:
# terminal-cli ticket "<title>" "<body>"
# terminal-cli hitl "<title>" "<action>"
# terminal-cli activity <kind> "<title>" "<detail>"
# terminal-cli state get|set <key> [value]
```

When calling an engine from inside the script:

```bash
claude -p "<prompt>" --dangerously-skip-permissions ${model:+--model "$model"}
codex exec -s danger-full-access -C "$worktree" ${model:+--model "$model"} "<prompt>"
```

Rules:

- Never merge to `main`/`master`.
- Open a PR/MR only when the script creates concrete code changes.
- Use `terminal-cli ticket` for findings the agent should not fix in the same run.
- Use `terminal-cli hitl` only for true human blockers.
- Exit non-zero on real failure; `exit 0` for no-op success.

## Sidecar JSON

```json
{
  "id": "kebab-case",
  "title": "Short label",
  "description": "One-line summary",
  "icon": "Bot",
  "opensPr": false,
  "engine": "claude",
  "model": "",
  "inPlace": false
}
```

Set `opensPr: true` only if the agent is expected to commit and open a PR/MR.
Set `inPlace: true` only for agents that intentionally mutate the current repo
without a worktree; most agents should leave it false.

## Confirmation

End with the created/updated script path, sidecar path, and how to run it from
TerMinal.
