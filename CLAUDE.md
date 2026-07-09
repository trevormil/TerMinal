# CLAUDE.md — TerMinal

<!-- Loaded on top of global ~/.claude/CLAUDE.md (§1–11). Don't restate global
     rules here — reference them as "global §N". Keep this lean. -->

TerMinal is a standalone macOS Electron app that hosts Claude Code / Codex CLI
sessions with a software-factory layer on top: tabs for tickets, MRs, scheduled
agents, runs, HITL, docs, and per-session plugin widgets. See
[`README.md`](./README.md) and [`docs/architecture.md`](./docs/architecture.md).

**Status:** Shipped, actively iterating. Daily-driver tool — Trevor uses it as
the primary terminal across every other project in `~/CompSci/gauntlet/`.

## TerMinal follows the full PR + human-merge flow (global §8)

TerMinal has graduated from its old direct-to-main exception. It is now a mature
daily-driver, so **agents follow global §8 in full**: work on a feature branch
(prefer a `git worktree` under `~/CompSci/gauntlet/.worktrees/TerMinal/<branch>/`),
push the branch, open a PR (`gh pr create`), and **stop for a human merge**.
Never commit or push directly to `main`.

This is enforced: the `block-main-merge.sh` PreToolUse hook IS wired in
`.claude/settings.json` — it blocks `gh pr merge`, `git push … main`, and bare
`git push` while on `main`. (The `TERMINAL_FORCE_MAIN=1` inline override still
exists for human-approved emergency direct-main work, per global §8's FORCE
exception — use it only when explicitly approved.)

**Merge-ready bar** (global §8): code-review verdict `approve` + tests pass +
zero findings at severity ≥ medium. The human runs the merge.

## Release + version discipline (important now that we're PR-first)

Because we no longer release on every commit, the installed
`/Applications/TerMinal.app` can lag `main`. Keep them reconciled:

- **Release from `main`, after a PR merges** — not from feature branches. Pull
  `main`, then `bun run release`, so the installed app reflects merged code.
- **Know what's installed:** the build stamp (commit sha + build time) is baked
  in at build (`electron.vite.config.ts`) and shown in **Settings** (top-right).
  Compare it against `git log` on `main` to see if the installed app is current.
  A `-dirty` suffix means it was built from an uncommitted working tree.
- While iterating on a branch, `bun run release` builds *that branch* — the stamp
  will show the branch name; re-release from `main` once merged.

Runbook: [`docs/runbooks/build-and-release.md`](./docs/runbooks/build-and-release.md).

## Commands

```bash
bun install               # at repo root
bun run dev               # dev server with HMR
bun run release           # FULL rebuild → sign → reinstall /Applications/TerMinal.app (from main, post-merge)
bun run test              # test suite
bunx tsc --noEmit         # typecheck
```

## Architecture pointers

- `src/main/` — Electron main: IPC handlers, agents runtime, schedules, settings.
- `src/renderer/src/tabs/` — one folder per tab. Each tab exports a `Tab` spec
  with `appliesTo` + `Component` + optional `badge`.
- `src/renderer/src/lib/nav.ts` — cross-tab navigation bus
  (`navigateTo(tabId, payload?)`). Used for HITL → Runs, Activity → Tickets, etc.
- `bin/terminal-cron` — the headless runner launchd fires. Self-contained Bun
  script; reads `~/.config/TerMinal/schedules.json`.
- `bin/terminal-cli` — helper script exposed inside agent `.sh` bodies for
  ticket/hitl/activity/notify/state subcommands plus MCP passthroughs such as
  `terminal-cli mcp list_agents ...` and
  `terminal-cli mcp request_agent_artifact ...`.
- `~/.config/TerMinal/` — runtime state (schedules, cron-runs, agent-state,
  hitl, settings). Use Settings → Open TerMinal config dir to inspect.

## Ticket and agent workflow

Every backlog ticket is owned by exactly one agent via `agent_id`,
`agent_scope` (`repo` | `global`), and `agent_kind` (`classic` | `persistent`).
If work needs multiple agents or phases, split it into linked tickets with
`depends_on`.

The end-to-end owner, knowledge-gathering, delegated-artifact, and follow-up
contract lives in [`docs/workflow/agent-process.md`](./docs/workflow/agent-process.md).

**Two modes.** Quality mode is the default (TDD → review → human merge). Vibe
mode is explicit, temporary, gates-off exploration in a disposable worktree/
`vibe/*` branch — output is disposable signal, never shipped directly. Enter
with `/vibe`; full contract in
[`.claude/skills/vibe/SKILL.md`](./.claude/skills/vibe/SKILL.md) (and template
CLAUDE.md §14). This is also where the persona/lanes machinery
(`src/main/personas.ts`, `runTicketLanes`) earns its keep.

## Conventions specific to this repo

- **ESM main.** `src/main/index.ts` bundles to ESM at build time. `__dirname`
  and `require` throw at runtime. Use `fileURLToPath(import.meta.url)`. After
  release, verify the packaged binary actually opens a window (stderr free of
  `ReferenceError`). See `learnings_gauntlet_terminal_esm_main_dirname`.
- **No silent narration.** This is a UI app; user-visible messages come from
  the tabs themselves. Don't add `console.log` for "feedback" — wire to the
  Activity feed via `emitActivity` if it's worth surfacing.
- **Tab order matters.** Lower `order:` numbers come first. The current rough
  ordering is Terminal (0) → Tickets (1) → MRs (2) → Agents (3) → Runs (3.45)
  → Schedules (3.5) → Browser (4) → Notes/Files/Activity/Docs → Sessions
  → Help → Reports. Human-needed items live in the top-right Inbox drawer, not
  a repo tab.

## Where to read before touching X

| You're touching | Read |
|---|---|
| A new IPC | `src/main/index.ts` (handler) + `src/preload/index.ts` + `src/renderer/src/lib/types.ts` (Gt API surface) — all three must agree |
| Agent runtime | `src/main/agents.ts` is the heart; `runSpec` is the spawn entry |
| Schedules | `src/main/schedules.ts` + `bin/terminal-cron` — keep state shapes in sync |
| Per-(repo, agent) state | `.agents/scripts.md` in `project-template` — the canonical convention doc |
| Run records | `src/main/cron-runs.ts` (cron) + `agents.ts` (in-process) — `UnifiedRun` type bridges both for the Runs tab |
