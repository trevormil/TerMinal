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
11. **Run outcome** — tail-call
    `terminal-cli mcp set_run_outcome runId=$TERMINAL_RUN_ID outcome=<...>` with
    one of the four allowed values (`pr-opened` | `ticket-filed` | `merged` |
    `none`). This is how the morning briefing classifies the run without
    re-deriving it, so it is not optional. Nuance beyond those four lives in
    this artifact's `status:` frontmatter.

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
  --jq '[.[] | select((.author.login // "") as $l
        | (["dependabot","dependabot[bot]","app/dependabot",
            "renovate","renovate[bot]","app/renovate"] | index($l) != null)
          or ((.author.is_bot // false) == true))]'
# GitLab
glab mr list --author=dependabot --json
```

Note the **exact-login** comparison. An unanchored `test("dependabot|renovate")`
is a substring match and will happily select a human.

### This half is implemented in the script, NOT delegated to the engine

**Closing a PR is the only irreversible write this factory makes to the forge.**
Everything else is proposal-shaped and gated by a human merge. Dependabot reads
a human-closed PR as *"never offer this version again"*, so a wrong close
silently removes a bump — possibly a security bump — from the queue forever.

So the janitor lives in `.agents/deps-quality.sh` and runs **deterministically,
before and independently of the engine.** The engine is explicitly told not to
touch pull requests. Every rule below is a filter in that pipeline, not an
instruction an LLM with a `gh` token is trusted to follow.

### Preconditions — evaluated first, and absolute

1. **Exact bot login, or a verified bot account.** Matched against an explicit
   allowlist (`dependabot`, `dependabot[bot]`, `app/dependabot`, `renovate`, …)
   or `author.is_bot == true`. **Never a substring match**: `test("renovate")`
   also matches a human named `renovate-fan` or an org member `acme-renovate`,
   and closing a person's PR on a substring collision is unacceptable.
2. **Security PRs are removed from the candidate set entirely**, by label or by
   title. This is a *precondition*, not a lower row in a precedence table —
   precisely so a major-version bump that is *also* a CVE fix can never reach a
   close rule. (A top-down table gets this wrong the first time the two
   coincide, which is exactly when it matters most.)

### The only close rule

| Situation | Action |
|---|---|
| The dep is already at or past this version on the default branch | **Close**, after commenting why. The bump has genuinely landed. |
| Everything else | **Leave open.** |

That is deliberately the whole list. Three rules were considered and rejected:

- **"Superseded by this run's sweep PR" → close.** Rejected: the sweep PR is
  unmerged *by design* (global §8 human gate). If the human then rejects the
  sweep, the bump would already have been destroyed. **Never close against an
  unmerged PR.**
- **"Major version bump" → close + ticket.** File the ticket, but leave the PR
  open. A major is exactly the case where the human most wants the diff still
  reachable.
- **"Fails CI, open >14 days" → close.** Rejected: CI is red for unrelated infra
  reasons all the time, and that is not the bump's fault.

### Hard rules for the janitor

1. **Dry-run by default.** `DEPS_JANITOR_APPLY=1` is required to actually close.
   A first run against a year of accumulated bot PRs produces a reviewable list
   plus one HITL, not 20 immediate closes.
2. **The close list is written to the artifact BEFORE anything executes**, so
   the audit trail survives a run that dies mid-close.
3. **Comment before closing, always.** A silently closed bot PR is
   indistinguishable from a bug.
4. **Never merge a bot PR.** Global §8 applies to bot PRs exactly as to agent PRs.
5. **Hard cap** (`DEPS_JANITOR_CAP`, default 20) enforced by a counter in the
   loop, not by asking nicely.

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
