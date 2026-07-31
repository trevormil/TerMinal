# deps-quality agent (in-repo contract)

A scheduled agent that handles **dependency hygiene** and **code-quality
sweeps** in one pass: outdated/vulnerable deps, lockfile freshness, formatter
drift, lint regressions, and TODO/FIXME aging.

**Workflow is uniform**: own worktree → analyze → propose PR / ticket / HITL → human merges.

## Mode

`writer` — opens PRs for safe automated fixes (lint/format/dep bumps that pass
the 3-day-age rule). HITLs for critical CVEs. Tickets for everything else.

## Inputs

- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` per ecosystem.
- Lockfile (`bun.lock`, `Cargo.lock`, etc.) — must exist and be committed.
- `bun audit` / `cargo audit` / `pip-audit` output.
- `npm-time-machine` data (or equivalent) — checks each candidate version is
  ≥3 days old per global `~/.claude/CLAUDE.md` §10.
- Linter / formatter output (`prettier --check`, `eslint`, `tsc --noEmit`,
  `ruff`, `cargo clippy`, etc.).
- `grep -rn "TODO\|FIXME"` with `git blame`-derived ages.

## Early-exit fast path

State at `~/.config/TerMinal/agent-state/<repo-basename>/deps-quality.json`:

```json
{
  "lastScannedSha": "abc1234",
  "lastRunAt": ...,
  "lastAuditAt": ...,
  "lastDeps": { "react": "19.0.0", "typescript": "5.7.2", ... }
}
```

If `HEAD == lastScannedSha` AND last advisory feed update was before
`lastAuditAt` (cache CVE feeds) → exit 0.

## Process

1. **Worktree**: `git worktree add "${WORKTREES_DIR:-$HOME/.worktrees}/<repo>/deps-quality-<short_sha>" main`.
2. **Dependency audit** — run `bun audit` (or ecosystem equivalent). Critical
   CVEs trip the HITL fast path.
3. **Identify safe bumps** — minor/patch versions ≥3 days old, no breaking
   semver, lockfile-resolvable. Apply in the worktree.
4. **Run formatter + linter** with auto-fix. Capture before/after diff.
5. **TODO/FIXME aging** — flag entries >90 days old (via `git blame`).
6. **Decide**:
   - Safe bumps + auto-fix changes → single PR `chore: deps + lint sweep`.
   - Critical CVE that can't be auto-fixed → HITL via `.claude/bin/hitl`.
   - Aging TODO/FIXME (>90d) → ticket per cluster.
7. **Run the bot-PR janitor** (see below) — must happen *after* the sweep PR is
   opened, because "superseded by the sweep" is the main reason to close one.
8. **Write artifact** to `.TerMinal/reports/deps-quality/<short_sha>.md`.
9. **Update state** — `lastScannedSha`, `lastAuditAt`, `lastDeps`.
10. **Activity** — `.claude/bin/activity check "Deps+quality · <N> bumps · <C> CVEs · <J> bot PRs closed" "@ <short_sha>"`.

## Bot-PR janitor (dependabot / renovate)

Dependabot and Renovate open one PR per dependency and never clean up after
themselves. Left alone for a month the PR list is 40 bot PRs deep and the human
stops looking at it — which is worse than having no bot at all, because the real
PRs are now buried too.

This agent already computes the authoritative answer to "which of these bumps
are safe" in steps 3-4. The janitor is just spending that answer on the bot's
backlog. It runs in the same pass.

### List

```bash
# GitHub
gh pr list --state open --json number,title,author,headRefName,createdAt \
  --jq '[.[] | select(.author.login | test("dependabot|renovate"))]'
# GitLab
glab mr list --author=dependabot --json
```

### Decide, per bot PR

| Situation | Action |
|---|---|
| The dep is at or above this version on `main` already | **Close** — "already on `<version>` as of `<sha>`." |
| The bump is included in this run's sweep PR | **Close** — comment linking the sweep PR. |
| Patch/minor, ≥3 days old, not otherwise handled | **Leave open.** It is a legitimate candidate; the human decides. |
| Major version bump | **Close + file a ticket.** Majors need a migration plan, not a merge button. The ticket carries the changelog/breaking-changes link. |
| Fails CI, open >14 days | **Close** — "stale + red; reopen from a fresh sweep if still wanted." |
| Any Critical CVE fix | **Never close.** Escalate to HITL. |

Always leave a one-line comment saying *why* before closing. A silently closed
bot PR is indistinguishable from a bug, and the human will have to re-derive the
reasoning.

### Hard rules for the janitor

1. **Never merge a bot PR.** Global §8 — the human gate applies to bot PRs
   exactly as it applies to agent PRs. This agent closes and tickets; it does
   not merge.
2. **Never close a security PR.** Critical/High CVE fixes escalate to HITL even
   when they look superseded — the sweep may have missed a transitive path.
3. **Cap at 20 closes per run.** A first run against a year of accumulated bot
   PRs should not produce 200 notifications. Close the 20 oldest that qualify;
   the next run gets the rest.
4. **Record what was closed** in the artifact's `bot_prs` block, with the reason
   per PR. This is the audit trail for a destructive-ish action.

## Output artifact

`.TerMinal/reports/deps-quality/<short_sha>.md`:

```yaml
---
kind: deps-quality
generated: 2026-06-01T08:00:00Z
sha: abc1234
last_scanned: 9b3de89
deps:
  bumped: 4
  pending_age_lock: 2
  critical_cves: 0
quality:
  lint_fixes: 12
  format_fixes: 8
  aging_todos: 5
bot_prs:
  open_before: 14
  closed_superseded: 6
  closed_major_ticketed: 2
  left_open: 6
pr_opened: https://github.com/owner/repo/pull/N
hitl_items: []
tickets_filed: [.TerMinal/backlog/0126-todo-cleanup.md]
status: ok
---
```

Each closed bot PR is listed in the body with its number, the dep, and the
one-line reason it was closed.

## Hard rules

1. **3-day-age rule** for any bump (per global §10). No `@latest` adoption.
2. **No major-version bumps.** Patch + minor only; major is a ticket.
3. **HITL for Critical CVEs.** Don't silently downgrade severity.
4. **Ticket + MR workflow** — every PR through human merge.
5. **Worktree isolation**.
6. **Idempotent.**
7. **Never merge anything** — including bot PRs (global §8).
