# project-template

A reusable, self-contained **workflow template** for private GitHub *or* GitLab
projects. Drop it into a new repo and you get a complete, in-repo development
loop: sessions → tickets → feature branches → PRs/MRs → code-review agent →
human merge, with a knowledge base, TDD gate, cadence checks, and autonomous/AFK
modes — all versioned with the code, no external tracker or dashboard.

Loads on top of your global agent guidance (`~/.claude/CLAUDE.md` for Claude,
Codex's AGENTS/CLAUDE fallback for Codex, and Cursor's project rules when you
run Cursor Agent). This repo's `.claude/skills/` and `.codex/skills/`
**override** any same-named global skill (project skills win), so a bootstrapped
repo gets the forge-agnostic, in-repo behavior in those native skill engines.
TerMinal agents and schedules can also run through `cursor-agent`. **Forge is per-repo**
(GitHub `gh`/"PR" or GitLab `glab`/"MR"), resolved by `.claude/bin/forge` —
switch with `.claude/forge`. Merge to `main` is **human-only** (global §8).

## Use it

**New repo** — make it a GitHub template repo, then:
```bash
gh repo create <name> --private --template <owner>/project-template --clone
cd <name>
echo gitlab > .claude/forge     # only if this repo lives on GitLab (default: github)
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

The skills in `.claude/skills/` and `.codex/skills/` are **project-scoped by
design** — Claude Code and Codex auto-load their own mirrors when you work in a
repo that has them, and they reference this repo's own `.agents/` contracts via
relative paths (`../../../.agents/…`). Cursor Agent is supported by TerMinal's
engine picker, background runs, schedules, and terminal instances; Cursor does
not currently use the Claude/Codex skill folders as native slash skills. So:

- **A scaffolded repo needs no global-skills setup.** The workflow is bundled
  and self-contained: the `code-review` agent, `/check`, and `/test-suite` delegate to
  Codex with self-contained prompts (they do **not** call Codex's global slash
  commands), so they work as long as `claude` + `codex` are installed. TerMinal
  one-click agents may use `cursor-agent` when selected.
- **Don't symlink these into `~/.claude/skills` / `~/.codex/skills`** — the
  relative `.agents/` refs would resolve to `~/.agents/` and break. Keep them
  per-repo.
- **Existing repo?** Drop the workflow in with `./bootstrap.sh /path/to/repo`
  (non-clobbering) — that's the supported "set it up" path.
- **Let Claude do it.** You already have a Claude instance: point it at this repo
  and ask it to run `bootstrap.sh` against your target, then walk you through CLI
  auth (`gh`/`glab`) and optional Telegram.

## What's inside

```
CLAUDE.md                     project workflow + conventions (fill placeholders)
bootstrap.sh                  inject the workflow into an existing repo
.claude/
  settings.json               deny secrets + pr/mr merge; wires the merge hook
  forge                       github | gitlab — the repo's forge selector
  bin/forge                   resolves the active forge (override > detect)
  bin/status                  prints the live human-facing status snapshot
  hooks/block-main-merge.sh   PreToolUse gate — blocks merge/push to main/master
  hooks/stop-notify.sh        Stop hook — files completion items into TerMinal Inbox
  skills/
    ticket/                   in-repo backlog tickets (+ horizon + hitl tags)
    session-start/            open a session: seed live doc + TDD checklist
    session-end/              close a session: document, clean up, file follow-ups
    pr-creation/              ticket → branch → PR/MR → link back to ticket
    code-review/              reviewer contract → in-repo .TerMinal/reviews artifacts
    digest/                   human-review digest → chunked, risk-ranked, code-first .chunks.json
    merge-sync/               reconcile tickets ↔ reality (close merged + drift sweep)
    test-suite/               ad-hoc chat-only test run (the cheap inner loop)
    check/                    cadence repo inspections → .TerMinal/checks (dead-code, …)
    security-scan/            deterministic security floor (CVE/secrets/SAST)
    document/ document-audit/ sidecar docs capture + rot check
    knowledge/                capture visual Knowledge Base links/media/snippets
    notify/                   on-demand AFK Telegram bridge
    stacked-mr/               autonomous overnight PR/MR stacking (batch-reviewed at the end)
    factory/                  continuous orchestrator: loops /stacked-mr (reconcile → pass → refill), HITL-gated
    new-agent/                create repo-local TerMinal agents (.agents/<id>.sh + .json)
    new-persistent-agent/     create global memory-aware TerMinal agents
    new-schedule/             add TerMinal launchd-backed schedules for existing agents
    new-knowledge/            add repo/global Knowledge Base links, media, snippets
    new-snippet/              add one-click TerMinal terminal snippets
    terminal-widget/          add repo-specific TerMinal sidebar widgets
.codex/
  hooks.json                  Codex hook template to merge/install for this repo
  hooks/stop-notify.sh        Codex Stop hook mirror for completion Inbox filing
  skills/                     mirror of .claude/skills for Codex
.agents/
  forge.md                    GitHub/GitLab detection + gh↔glab command mapping
  code-review.md              review contract: schema, six-axis rubric, verdicts
  digest.md                   human-review digest contract: chunk schema, classification, decisions
  testing.md                  test-runner detection
  dead-code.md                example cadence-check spec (+ pattern to copy)
.github/workflows/ci.yml      format + typecheck + test (+ optional eval gate)
.github/PULL_REQUEST_TEMPLATE.md  + .gitlab/merge_request_templates/  PR/MR checklist
.editorconfig                 uniform whitespace across editors
.TerMinal/
  template.json          project-template schema/version marker (v2 layout)
  widgets.json           repo-specific terminal sidebar widgets
  snippets.json          repo-owned quick prompt snippets (app presets stay app-owned)
  backlog/.next-id       ticket counter (tickets land here as NNNN-slug.md)
  sessions/              live session docs (central state), NNNN-slug/
  reviews/               in-repo code-review artifacts, per PR/MR
  checks/                in-repo cadence-inspection artifacts, per kind
  reports/               scheduled-agent run artifacts, per kind
.status.md                    live human status snapshot (gitignored, generated)
docs/
  decisions/                  ADRs (append-only; 0001 is the template)
  architecture.md             evergreen system overview (edit in place)
  runbooks/  learnings/        ops procedures + non-obvious findings
```

Layout note: v2 keeps TerMinal-owned workflow state under `.TerMinal/`.
Existing v1 repos with top-level `backlog/`, `sessions/`, `.reviews/`,
`.checks/`, or `reports/` continue to work; bootstrap repairs v1 in place and
does not move existing data.

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
- `gh` **or** `glab` (authenticated, matching `.claude/forge`) — PR/MR creation
  + resolution.
- `bun` — default toolchain (global §5).
- `jq` — used by the merge-block hook.
- Telegram scripts/creds in `~/.claude` (optional) — only for `/notify`.
