# project-template

A reusable, self-contained **workflow template** for private GitHub *or* GitLab
projects. Drop it into a new repo and you get a complete, in-repo development
loop: sessions → tickets → feature branches → PRs/MRs → code-review agent →
human merge, with a knowledge base, TDD gate, cadence checks, and autonomous/AFK
modes — all versioned with the code, no external tracker or dashboard.

Loads on top of your global agent guidance (`~/.claude/CLAUDE.md` for Claude,
Codex's AGENTS/CLAUDE fallback for Codex, and Cursor's project rules when you
run Cursor Agent). For Claude Code the workflow skills ship globally via the
**tm plugin** (installed by the TerMinal app, invoked as `/tm:<skill>` in every
repo — nothing to copy per repo), and the same skills sync to
`~/.codex/skills/tm-*` for Codex. No repo carries a copy for either harness.
TerMinal agents and schedules can also run through `cursor-agent`.
**Forge is per-repo** (GitHub `gh`/"PR" or GitLab `glab`/"MR"), resolved by the
tm plugin's `bin/forge` — auto-detected from origin; switch with
`echo gitlab > "$(tm-state-dir forge)"`. Merge to `main` is
**human-only** (global §8).

## Use it

**New repo** — make it a GitHub template repo, then:
```bash
gh repo create <name> --private --template <owner>/project-template --clone
cd <name>
echo gitlab > "$(tm-state-dir forge)"  # only for self-hosted GitLab (auto-detected otherwise)
# fill the placeholders in CLAUDE.md, then:
/session-start "scaffold the project"
```
(GitLab has no `--template` flow — clone/copy the files in and `git remote add`
your GitLab origin, or use `bootstrap.sh` below.)

**Existing repo** — retrofit with the bootstrap (non-clobbering; writes
`*.workflow` alongside anything it would overwrite):
```bash
./bootstrap.sh /path/to/your-repo
```

## Skills & global setup

For **Claude Code** the workflow skills are global, not per-repo: the TerMinal
app installs the **tm plugin** once (`~/.config/TerMinal/plugin`, linked as
`~/.claude/skills/tm`), and every repo gets the same `/tm:*` skills, hooks
(merge gate, completion Inbox, remote-check), and helper `bin/` — no bootstrap
step, no drift. Repos may still add their own `.claude/skills/` for
project-specific extras; plugin skills are namespaced so nothing collides.

**Codex** loads the same skills globally as `~/.codex/skills/tm-*`, synced by
the app from the one plugin source — invoke them as `tm-ticket`, `tm-check`,
and so on. Cursor Agent is supported by TerMinal's engine picker, background runs,
schedules, and terminal instances; Cursor does not use the skill folders as
native slash skills. So:

- **A scaffolded repo needs no global-skills setup beyond the TerMinal app.**
  The `code-review` agent, `/tm:check`, and `/tm:test-suite` delegate to Codex
  with self-contained prompts, so they work as long as `claude` + `codex` are
  installed.
- **Existing repo?** `./bootstrap.sh /path/to/repo` seeds the repo data
  (tickets/sessions state, docs skeleton, CI, `.codex` mirror) and cleans up
  machinery older bootstraps copied in — the Claude skills themselves come from
  the plugin.
- **Let Claude do it.** You already have a Claude instance: point it at this repo
  and ask it to run `bootstrap.sh` against your target, then walk you through CLI
  auth (`gh`/`glab`) and optional Telegram.

## What's inside

```
CLAUDE.md                     project workflow + conventions (fill placeholders)
bootstrap.sh                  inject the workflow into an existing repo
.github/workflows/ci.yml      format + typecheck + test (+ optional eval gate)
.github/PULL_REQUEST_TEMPLATE.md  + .gitlab/merge_request_templates/  PR/MR checklist
.editorconfig                 uniform whitespace across editors
.status.md                    live human status snapshot (gitignored, generated)
docs/
  decisions/                  ADRs (append-only; 0001 is the template)
  architecture.md             evergreen system overview (edit in place)
  runbooks/  learnings/        ops procedures + non-obvious findings
```

That's it — everything else is global or personal, not repo boilerplate:

- **Skills, hooks, helper bin** — the tm plugin (`~/.config/TerMinal/plugin`),
  loaded as `/tm:*` for Claude and `~/.codex/skills/tm-*` for Codex.
- **Agent contracts** — plugin defaults, resolved with `tm-agent-spec <kind>`;
  create `.agents/<kind>.md` in a repo only to override one. Repo-specific
  script agents can still live at `.agents/<id>.sh` (+ `<id>.json`).
- **Default script agents** (health, drift, coverage, ticket-ideas,
  ci-watchdog) — seeded once into `~/.config/TerMinal/scripts` by the plugin.
- **Workflow state** (tickets, sessions, reviews, checks, reports, notes) —
  the per-project sidecar (`tm-state-dir <area>`), never the repo.
- **Forge selector** — auto-detected from origin; sidecar override for
  self-hosted GitLab.

Layout note: existing v1 repos with top-level `backlog/`, `sessions/`,
`.reviews/`, `.checks/`, or `reports/` continue to be read; a clean repo is
the current layout by default. Bootstrap banks retired per-repo seeds under
`.claude/pre-tm-backup/` and does not move existing state (the app's
Settings → Updates → Project state does that).

## The loop

```
/session-start "<goal>"  →  /ticket  →  feature branch  →  TDD  →
/pr-creation  →  code-review agent (background)  →  /digest (human read)  →
<human merges>  →  /merge-sync  →  /session-end
```

See [`CLAUDE.md`](./CLAUDE.md) for the full conventions: the TDD gate, the
`horizon` ticket tag, the code-review merge bar, the doc-anchoring convention
(`[N]` / `[N.M]` greppable headings + per-doc `anchor:` codes), the
"when picking back up" checklist, and the autonomous/AFK modes.

## Requirements

- [Claude Code](https://claude.com/claude-code) — runs the skills.
- [`codex`](https://github.com/openai/codex) CLI — code-review agent, `/check`,
  `/test-suite` delegate to it (`-s danger-full-access`).
- [`cursor-agent`](https://cursor.com) CLI — optional TerMinal engine for
  agents, schedules, and terminal instances.
- `gh` **or** `glab` (authenticated, matching the resolved forge) — PR/MR creation
  + resolution.
- `bun` — default toolchain (global §5).
- `jq` — used by the merge-block hook.
- Telegram scripts/creds in `~/.claude` (optional) — only for `/notify`.
