# 20. Workflow state lives in a per-project sidecar, not in the repo

Date: 2026-08-04

> Amended by [0021](./0021-agent-contracts-ship-with-the-plugin.md): default
> agent contracts ship with the plugin now (repo `.agents/<kind>.md` only as an
> override, resolved via `tm-agent-spec` — not relative `.agents` paths).
> Extended by [0022](./0022-personal-state-fully-out-of-the-repo.md): the
> personal files this ADR left behind as "repo config" (tickets.json, notes,
> knowledge, snippets, loops, agent-requests, the stamp) move to the sidecar
> too.
> Amended by the [Sunset](#sunset-2026-10-13) note appended below: the
> COMPATIBILITY half of this decision — legacy in-repo reads and the ambient
> migration banner — now ends on a fixed date. The decision itself stands.

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
  **The write rule is unconditional.** The first cut of this decision let a
  repo "opt out" implicitly: if it had a v1 state dir and no v2 marker, the
  shell helpers wrote there. Every repo predating the sidecar matches that, so
  the migration was a no-op on exactly the repos that had state to migrate —
  and because the app had no such branch, the two wrote to different places
  from different id counters. Two helpers resolve this now and neither has a
  branch: `tm-state-dir <area>` (the single write target) and
  `tm-state-dirs <area>` (every readable root, highest priority first).
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
- **Hand-written paths are the remaining risk.** A prompt or skill that names
  a literal state path writes back into the shared repo. A hygiene test fails on
  any such path in model-facing content, which is the only thing keeping 50+
  skill files honest. It must match BOTH spellings — `.TerMinal/<area>` and the
  bare v1 dirs (`backlog/`, `.reviews/`, `$ROOT/sessions`). The first version
  matched only the former and so caught none of the real leaks, all of which
  used the v1 spelling.
- **Every process that spawns a model against a repo must inject the vars.**
  There are more of these than the obvious three, and the guard that enforces
  it discovers them by walking the tree rather than from a list — a list only
  ever contains the sites already known, which is how loops, background tasks,
  the digest runner and the entire remote host script were each missed.
- Obsidian-provider repos are unaffected: the vault still wins for tickets, and
  that precedence is now consistent across the app, the CLI, cron and MCP
  (cron previously ignored it entirely — ticket 0281).

## Sunset (2026-10-13)

Appended 2026-08-13. The decision above is unchanged; this note gives its
transitional machinery an expiry.

"Migration is opt-in per repo and non-destructive" was the right call for the
cutover and the wrong shape to keep forever. The gradual path costs a legacy
branch in every resolver — `repoStatePathForRead`, the STICKY loop variant,
`existingProjectAreaPaths`, and the byte-identical copy of all three inside
`repo-state-inline.ts` — and each of those branches is a live route by which
personal state can be read out of (and so keep accreting in) a shared checkout.
An indefinite compatibility layer is also indefinitely untested against the
thing it enables: the longer it stands, the more repos never move.

So the window has an end date, `MIGRATION_SUNSET = 2026-10-13`, in
`src/shared/migration-sunset.ts`. Every consumer resolves it through
`migrationWindowOpen(now?)`, which takes an injectable clock so before/on/after
is unit-testable rather than a thing you wait for.

Before the date, nothing changes. From it:

- **Legacy reads stop.** Sidecar areas and personal state files resolve
  sidecar-only. Unmigrated files stay on disk, untouched — they are simply no
  longer a state root. `agents` is unaffected: it never moved.
- **The ambient offer stops.** The in-session banner does not appear and the
  legacy-seed sweep is no longer proposed unprompted.
- **The manual migrate does NOT stop.** `repoState:migrate` stays callable from
  Settings → Updates → Project state, with the same move/never-clobber rules. A
  repo that turns up years late must still be able to move its state; what
  sunsets is the flow that ran by itself, not the capability.
- **It is not silent.** A repo that still holds state files files one deduped
  Activity warning per repo on open, naming the count, the date, and where the
  manual move lives.

The app and the standalone scripts cut over on the same day by construction:
the sunset lives in the canonical inline block too, and a parity test drives
both implementations against one injected clock.

## Obsidian provider retired (2026-08-14)

Appended 2026-08-14. The decision above is unchanged; this note corrects one of
its consequences.

The `obsidian` ticket provider — the per-repo vault that `backlog.ts`'s `baseDir`
override existed to serve — is **retired**. Linear is always the preferred
external provider, and the vault backend was not worth its surface: a second
ticket store, its own deep-link scheme, its own session env vars, and a
precedence rule every resolver (app, CLI, cron, MCP, the plugin's shell helpers)
had to repeat.

So the Consequences bullet "Obsidian-provider repos are unaffected: the vault
still wins for tickets…" no longer describes reality. There is no vault
precedence anywhere. `baseDir` is gone with it, and the sidecar is the single
write target for `backlog`.

A repo whose saved `tickets.json` still says `provider: "obsidian"` is not
broken and is not silently reinterpreted: unknown provider values normalize to
`local` (ADR-0015), the repo reads and writes its sidecar backlog, and the app
files ONE Activity warning per repo naming the retirement and pointing at
Settings → Tickets. Vault folders on disk are never read, written, or deleted.
