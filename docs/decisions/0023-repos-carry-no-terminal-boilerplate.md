---
anchor: ADR-0023
status: accepted
date: 2026-08-08
supersedes: parts of ADR-0019/0021/0022 (extends the same trajectory)
---

# [23] Repos carry no TerMinal boilerplate

## [23.1] Context

ADR-0019 moved skills/hooks/bin to the global tm plugin, ADR-0021 moved agent
contracts into it, and ADR-0020/0022 moved workflow state to the per-project
sidecar. After all of that, bootstrap/scaffold still seeded five surfaces into
every repo: `.agents/` (default script agents + owned.yml), `.claude/`
(settings.json seed + forge selector), `.codex/` (stop hook + a
merge-by-hand hooks seed), and `.TerMinal/template.json` (the v2 layout
marker). None of them is repo-specific content — they were identical copies in
every repo, went stale the moment the source of truth moved, and made every
new repo start with four dot-directories of machinery.

## [23.2] Decision

A repo gets only what is genuinely repo-owned: CI, the docs skeleton,
CLAUDE.md, PR/MR templates, `.editorconfig`, and `.gitignore` entries.
Everything else resolves globally:

- **Default script agents** ship in `plugin/scripts/` and are seeded ONCE
  (never clobbering) into `~/.config/TerMinal/scripts` by the plugin install —
  the global scripts dir every runtime (registry, cron, MCP server, remote
  host) already reads. `.agents/` remains the per-repo override surface
  (repo-specific agents, contract overrides) but is never seeded.
- **Forge selection** is auto-detected from origin. Overrides live in the
  sidecar (`tm-state-dir forge`); the legacy `.claude/forge` is still honored
  but no longer seeded.
- **The Codex stop hook** is plugin-served (`plugin/hooks/stop-notify-codex.sh`
  + the `plugin/codex-hooks.json` snippet merged once into the user's global
  Codex hooks config), replacing the per-repo `.codex/hooks` seed.
- **`.claude/settings.json`** is not seeded — the merge gate and stop hooks are
  plugin hooks; the deny list belongs in the user's own global settings.
- **The v2 layout is the default**: `detectProjectLayout` (and its four
  hand-maintained mirrors in terminal-cli/cron/mcp-server/remote-host-script)
  reads v1 only on positive evidence of root-level v1 state dirs, so the
  `.TerMinal/template.json` marker — and with it the template's whole
  `.TerMinal/` dir — is unnecessary.

Existing repos are cleaned by a one-time sweep (`src/main/legacy-sweep.ts`),
surfaced as an in-session banner and in Settings → Updates: state files move
to the sidecar, retired seeds and plugin-identical copies are BANKED under
`.claude/pre-tm-backup/` (never deleted), and the forge choice is preserved
into the sidecar before its file is banked. `bootstrap.sh` performs the same
cleanup for CLI-driven retrofits.

## [23.3] Consequences

- A fresh scaffold contains no dot-directory machinery beyond `.github`/
  `.gitlab`; the bootstrap marker is the docs skeleton alone.
- Collaborators cloning a migrated repo resolve the same v2 layout with no
  marker file, because v2 is the default.
- `.TerMinal/` appears in a repo only when a project deliberately ships
  `widgets.json`/`tabs.json` (still gated by Settings → Security), and
  legacy `knowledge-rag/` stores stay put (absolute-path configs).
- The modules ledger that lived in `template.json` is gone with the modules
  framework; the dead `seed-module`/`apply-profile` CLI commands are removed.
