# 19. Claude workflow skills ship as a global tm plugin, not per-repo copies

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
  `~/.config/TerMinal/plugin` (staged swap), symlink `~/.claude/skills/tm`.
  Settings → Updates shows the version + a Sync action. Skills are invoked as
  `/tm:<skill>` everywhere; hooks apply globally.
- `templates/project-template` no longer ships `.claude/{skills,bin,hooks}`.
  `bootstrap.sh` seeds repo *data* (`.TerMinal/`, docs skeleton, CI,
  `.agents` contracts) plus the `.codex` mirror, and migrates old repos by
  removing the machinery earlier bootstraps copied in (name-scoped) and
  stripping the matching hook entries from `.claude/settings.json`.
- `.claude-plugin/marketplace.json` at the repo root makes the plugin
  installable without the app: `claude plugin marketplace add <repo>` →
  `claude plugin install tm@terminal`.

## Consequences

- One source of truth; updating TerMinal updates every repo's workflow at
  once. No more per-repo skill drift, no shadowing of global skills.
- **Codex is deliberately out of scope**: `codex exec` agents keep the
  per-repo `.codex/skills` mirror (bootstrap still installs it) because
  `~/.codex/skills` already holds different same-named global skills and
  agent specs address skills by bare name. Follow-up: globalize the Codex
  side once a namespacing story exists.
- Repos bootstrapped before this change keep working (their local copies
  remain, un-namespaced) and are cleaned up the next time `bootstrap.sh`
  runs against them.
- Skill invocations change name: `/ticket` → `/tm:ticket`, etc. Agent specs
  and docs shipped by the template were updated; personal muscle memory will
  lag for a while.
- The repo's own `.claude/bin` + `.claude/hooks` copies remain for
  contributors who don't run the app (settings.json still wires them);
  the plugin's global hooks double-fire harmlessly on machines with the app.
