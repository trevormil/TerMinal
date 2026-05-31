# Security Policy

TerMinal is a local-first developer tool. It does not run a hosted service or
phone home, but it intentionally launches powerful local processes: terminal
sessions, agent scripts, command widgets, scheduled launchd jobs, forge CLIs,
and optional Telegram/OpenRouter calls. Treat it with the same trust model as an
integrated terminal plus task runner.

## Reporting Vulnerabilities

Please do not open a public issue for a vulnerability.

Use GitHub private vulnerability reporting if it is available on this repo. If
not, contact the maintainer directly and include:

- Affected version or commit
- macOS version and architecture
- Steps to reproduce
- Impact and any files/credentials exposed
- Whether the issue requires opening an untrusted repo

For non-sensitive bugs, use normal GitHub issues.

## Supported Versions

TerMinal is pre-1.0. Security fixes target `main`. If you are running an older
commit, update to the latest `main` before reporting unless the issue only
exists after a specific regression.

## Security Model

TerMinal is designed for repos and tools you trust.

- Terminal sessions run the real `claude` and/or `codex` CLIs under your user
  account.
- Agents can create git worktrees, edit files, run tests/builds, file tickets,
  and open PRs/MRs through your authenticated `gh` or `glab`.
- Codex agent runs are intentionally launched with `danger-full-access` for the
  local software-factory workflow.
- Schedules are real macOS launchd jobs derived from
  `~/.config/TerMinal/schedules.json`.
- Repo command widgets from `.TerMinal/widgets.json` execute shell commands in
  the attached repo.
- Repo-local skills and agents from `.claude/`, `.codex/`, and `.agents/` are
  executable workflow code.

Do not attach TerMinal to an untrusted repository unless you have inspected its
workflow files and scripts.

## Local Data And Credentials

Runtime state is stored under `~/.config/TerMinal/`, including settings,
schedules, activity logs, HITL items, run logs, and agent state. Project
artifacts live in the repo, such as `backlog/`, `sessions/`, `.reviews/`, and
`.TerMinal/notes.md`.

Sensitive values may include:

- Telegram bot token and chat id in `~/.config/TerMinal/settings.json`
- OpenRouter API key in `~/.config/TerMinal/settings.json`
- Forge auth managed by `gh` / `glab`
- Claude/Codex auth managed by their CLIs
- Claude usage access through local Claude Code credentials/keychain entries

TerMinal should not copy these secrets into repo files, logs, tickets, or PRs.
If you find a path that leaks them, report it as a vulnerability.

## Human Gate

The intended workflow keeps merges to `main`/`master` human-controlled. Agents
may open PRs/MRs, but they should not merge protected branches or push directly
to `main` unless the user has explicitly opted into a force/emergency path.

Security-sensitive changes should preserve that gate.

## Dependency And Supply Chain Expectations

- Dependencies should be pinned exactly in `package.json`.
- Commit the lockfile when dependencies change.
- Run `bun audit` when adding or upgrading dependencies.
- Avoid adding new dependencies for small tasks that can be solved with the
  standard library or existing packages.

## Out Of Scope

These are expected properties, not vulnerabilities by themselves:

- A trusted repo widget or agent can run arbitrary shell commands.
- A scheduled job runs while TerMinal is closed.
- Agents can spend tokens or call configured local/remote AI providers.
- The unsigned local DMG requires normal macOS Gatekeeper handling.
