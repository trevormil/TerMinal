# 20. Workflow state lives in a per-project sidecar, not in the repo

Date: 2026-08-04

Status: accepted

Amends [ADR-0012](0012-ticket-log-in-markdown.md) (the comment log stays in the
ticket markdown; only the file's location moves) and
[ADR-0018](0018-legacy-backlog-is-frozen-history.md) (the read-merge/write-one
rule it established is what makes this migration free). Records the cross-host
consequence flagged in [ADR-0002](0002-multi-host-scheduled-agents.md). Ticket
0280.

## Context

Tickets, sessions, reviews, checks and reports lived inside the target repo
(`.TerMinal/…`, or the legacy v1 dirs). That was fine while every repo was a
solo project: state travelled with the code, `git log` attributed it, and an
agent reading a ticket file got the context for free.

It stops being fine the moment a repo is shared. A collaborator pulls and gets
another developer's tickets, half-finished session docs, and code-review
artifacts — none of which mean anything to them, all of which show up in
diffs. TerMinal's own repo had already quietly opted out by gitignoring
`.TerMinal/` (ADR-0018 notes this in passing), which is the clearest evidence
that the default was wrong.

The pieces to build on already existed: `settings.harnessDir` stored review
artifacts cross-repo keyed `<host>/<owner>/<repo>`, and `backlog.ts` accepted a
`baseDir` override so the Obsidian provider could keep tickets in a vault.

## Decision

Workflow state for a repo lives in a **per-project sidecar** at
`<config>/repos/<host>/<owner>/<repo>/`, containing `backlog/`, `sessions/`,
`reviews/`, `checks/` and `reports/`.

- **Keyed off the origin remote**, so the key is identical on every machine and
  across worktrees of the same repo — two worktrees share one backlog, which is
  what you want when a worktree is just another branch. Repos with no origin
  fall back to a hash of the canonical root, so two projects sharing a basename
  don't collide.
- **The sidecar is itself a git repo.** Each migration commits, so tickets keep
  the `git log` / `git blame` history ADR-0012 valued, and a private remote can
  carry one backlog between this Mac and the remote workstation.
- **Reads merge, writes go to one place** — the exact asymmetry ADR-0018
  established for v1→v2. The sidecar is the highest-priority read root and the
  only write root, so state already committed in a repo stays visible with no
  migration step, while nothing new lands in the shared checkout.
- **`.agents/` and `docs/` stay in the repo.** Agent contracts are shared with
  the team the same way CI config is, and skills reference `../../../.agents`
  relatively.
- **Agents resolve paths, they don't hardcode them.** The app injects
  `TERMINAL_{BACKLOG,SESSIONS,REVIEWS,CHECKS,REPORTS}_DIR` into every session it
  spawns, and `tm-state-dir <area>` resolves the same paths in a shell the app
  did not spawn.
- **One canonical inline resolver.** `terminal-cli`, `terminal-cron` and
  `terminal-mcp-server` cannot import from the app bundle, so their copy is
  generated from `src/main/repo-state-inline.ts` by `bin/sync-repo-state` and
  pinned byte-for-byte by a parity test.

## Consequences

- A repo shared with collaborators receives none of this. That was the goal.
- **Migration is opt-in per repo and non-destructive.** Settings → Updates
  shows how many files are still in the repo and offers the move; it renames
  rather than deletes, refuses to overwrite, and leaves the repo copy when it
  refuses. Committing the resulting deletions is the user's call — it stays a
  reviewable change rather than something that happens behind their back.
- **Multi-host sync is now possible but not automatic.** ADR-0002 left tickets
  per-repo and explicitly not cross-host; a git-backed sidecar makes one shared
  backlog achievable by adding a remote, but nothing pushes or pulls yet. Until
  that lands, a ticket filed by a scheduled agent on another host stays on that
  host — the same gap ADR-0002 already documented, in a new location.
- **Hand-written paths are the remaining risk.** A prompt or skill that says
  `.TerMinal/reviews/` writes back into the shared repo. A hygiene test fails on
  any literal state path in model-facing content, which is the only thing
  keeping 50+ skill files honest.
- Obsidian-provider repos are unaffected: the vault still wins for tickets, and
  that precedence is now consistent across the app, the CLI, cron and MCP
  (cron previously ignored it entirely — ticket 0281).
