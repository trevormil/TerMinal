# 19. Workflow skills ship as a global tm plugin, not per-repo copies

Date: 2026-08-04

Status: accepted

Amends the bootstrap story in [ADR-0005](0005-embed-project-template.md)
(the template stays embedded; what it carries shrinks). Ticket 0279.

## Context

Every repo used to receive ~177 bootstrapped files: 35 Claude skills plus a
`.codex` mirror, hooks, and helper `bin/` scripts, copied by `bootstrap.sh` /
`scaffoldProject`. The copies drifted three ways (repo ↔ template ↔ other
repos), 8 skill names shadowed unrelated global skills, and the bootstrap
stamp was write-only — no drift detection or refresh UX. Ahead of
open-sourcing, per-repo machinery was the main adoption friction.

Claude Code supports **skills-dir plugins**: a directory at
`~/.claude/skills/<name>/` with `.claude-plugin/plugin.json` auto-loads in
every session as `<name>@skills-dir`, with skills namespaced `/<name>:<skill>`
and support for bundled agents, hooks, and arbitrary files referenced via
`${CLAUDE_PLUGIN_ROOT}`.

## Decision

- The Claude-side workflow machinery lives once in the TerMinal repo at
  `plugin/` — the **tm plugin**: 35 skills, the 3 hooks (merge gate,
  completion Inbox, remote-check) wired via `hooks/hooks.json`, and the 12
  helper `bin/` scripts. The personal `notify` skill (Telegram dotfile deps)
  is excluded.
- The app installs it on launch (`plugin-install.ts`): copy to
  `~/.config/TerMinal/plugin` (staged swap) — the **vendor-neutral canonical
  source** — then per-harness adapters expose it:
  - **Claude Code**: symlink `~/.claude/skills/tm` (skills-dir plugin,
    `/tm:<skill>` everywhere; hooks apply globally).
  - **Codex**: skills sync into `~/.codex/skills/tm-<name>` with
    `${CLAUDE_PLUGIN_ROOT}` rewritten to the literal plugin path (Codex has no
    plugin/namespace mechanism; only `tm-*` dirs are managed, and the adapter
    no-ops when `~/.codex` doesn't exist).
  - **Cursor** has no native skill loading — it is covered via TerMinal's
    engine picker, not file sync. New harnesses = new adapters over the same
    canonical dir.
  Settings → Updates shows the version + a Sync action.
- `templates/project-template` no longer ships `.claude/{skills,bin,hooks}`.
  `bootstrap.sh` seeds repo *data* (`.TerMinal/`, docs skeleton, CI,
  `.agents` contracts) plus the `.codex` mirror, and migrates old repos by
  moving the machinery earlier bootstraps copied in to a recoverable
  `.claude/pre-tm-backup/` (name-scoped; per-repo `notify` is left in place)
  and stripping the matching hook entries from `.claude/settings.json`.
- `.claude-plugin/marketplace.json` at the repo root makes the plugin
  installable without the app: `claude plugin marketplace add <repo>` →
  `claude plugin install tm@terminal`.

## Consequences

- One source of truth; updating TerMinal updates every repo's workflow at
  once. No more per-repo skill drift, no shadowing of global skills.
- **No repo carries a skill copy for EITHER harness.** An earlier draft of
  this decision kept the per-repo `.codex/skills` mirror because agent specs
  address skills by bare name. That was a mistake of scope: the mirror was 52
  of the ~104 files bootstrap wrote into every repo, and being a hand-synced
  duplicate of `plugin/skills` it drifted the same way the Claude copies did.
  Bootstrap now installs neither and migrates both to `.claude/pre-tm-backup/`.
  Bare names in agent specs are resolved by the harness, not by a directory:
  Claude sees `/tm:<skill>`, Codex sees `tm-<skill>`, and the template
  CLAUDE.md documents that mapping once rather than rewriting every mention.
- Repos bootstrapped before this change keep working (their local copies
  remain, un-namespaced) and are cleaned up the next time `bootstrap.sh`
  runs against them.
- Skill invocations change name in Claude Code: `/ticket` → `/tm:ticket`,
  etc., and `tm-ticket` in Codex. The template CLAUDE.md documents the bare
  names with a namespacing note rather than rewriting every mention; personal
  muscle memory will lag for a while.
- **The merge gate now runs in every repo, so its false positives cost more.**
  Matching is textual: the pattern fires wherever the trigger text appears in a
  command, including inside quotes, a heredoc, or a grep — so writing a doc that
  mentions the command is blocked too. Kept deliberately: a blocked harmless
  command is recoverable, an unnoticed push to a protected branch is not. The
  block message tells the caller how to rephrase. Narrowing the pattern would
  turn the gate into a bypass.
- The merge gate keeps two escape hatches: the per-command
  `TERMINAL_FORCE_MAIN=1` override and a machine-local allowlist
  (`~/.config/TerMinal/allow-direct-main`, one absolute repo path per line)
  for repos that are legitimately direct-to-main (global §8's carve-out) —
  machine-specific paths never ship inside the public plugin.
- **TerMinal's own** `.claude/bin` + `.claude/hooks` copies remain for
  contributors who don't run the app (its settings.json still wires them);
  the plugin's global hooks double-fire harmlessly on machines with the app.
  Bootstrapped repos, by contrast, have theirs migrated to the backup.
