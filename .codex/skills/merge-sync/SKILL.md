---
name: merge-sync
description: "Reconcile ticket + backlog state with reality: close tickets whose PR(s) merged and scrub the merged URL from prs:, plus a periodic drift sweep (in-progress with no open PR, closed-but-still-linked, long-stale open). Read-only on git (never merges); only edits backlog files. The standalone periodic ticket cleanup; also runs inside /session-end. Use after merging a stack or anytime PRs have landed."
---

# /merge-sync — Reconcile tickets with merged PRs

The merge is human-only (global §8), so after the human merges, ticket state is
stale: tickets still say `in-progress` and still list the now-merged PR/MR in
`prs:`. This skill closes the loop. It **never merges** — it only reads PR/MR
state from the forge and updates `backlog/` files.

Forge is detected per repo: `forge="$(.claude/bin/forge)"`. Use `gh` (GitHub) or
`glab` (GitLab) accordingly; command mapping in
[`.agents/forge.md`](../../../.agents/forge.md). Examples below show GitHub.

## Process

### 1. Find tickets with linked PRs

Scan `backlog/*.md` for tickets whose `prs:` array is non-empty (any
`status` other than `closed`).

### 2. Check each linked PR's merge state

For each PR/MR URL in a ticket's `prs:`:

```bash
gh pr view <pr-url-or-number> --json state,mergedAt,number,url   # GitHub
glab mr view <mr-number>                                         # GitLab (parse state: merged)
```

`state == "MERGED"` (GitHub, or a non-null `mergedAt`) / `state: merged`
(GitLab) means it landed.

### 3. Reconcile the ticket

For each ticket whose PR(s) merged:

- **Scrub** the merged PR URL from `prs:` (set `prs: []` if it was the only
  entry). The `prs:` list is for *active* tracking — git history preserves the
  trail.
- If **all** of the ticket's PRs have merged and the work is complete, set
  `status: closed` and bump `updated:` to today.
- If a ticket had multiple PRs and only some merged, scrub the merged ones but
  leave `status` as-is (work continues on the rest).
- A single PR may close **multiple tickets** (its body listed `Closes #a #b`) —
  close each linked ticket, not just one.

Leave tickets whose PRs are still open/closed-unmerged untouched.

### 4. Sweep for drift (periodic cleanup)

Beyond merge-driven closes, do a quick hygiene pass so the backlog matches
reality (CLAUDE.md [4.1] — this is the workflow's periodic ticket cleanup, and
the same sweep `/session-end` runs):

- **`in-progress` with no open PR** and no active session on it → move back to
  `open`, or to `stuck` (note why) / `icebox`. Don't leave it falsely in flight.
- **`closed` but still listing a `prs:` URL** → scrub the URL.
- **Long-stale `open`** (untouched, clearly out of scope) → surface it and
  suggest `icebox`/`future`; change it only with confirmation, since `open` may
  just mean "not started yet".

### 5. Report

List what changed: which tickets were closed, which PR URLs were scrubbed, any
status drift fixed, and any ticket left open because not all its PRs merged. Refresh the live snapshot
(`.claude/bin/status > .status.md`) to reflect the closed tickets. Don't
auto-`/document` or file new tickets — this is pure reconciliation.

## When to run

- After merging a `/stacked-mr` batch in the morning (the common case — ~N PRs
  merged at once).
- At the top of `/session-start` (context-seeding can detect merged-but-open
  tickets and suggest running this).
- Anytime `gh pr list --state merged` shows recent merges not yet reflected in
  the backlog.

## Hard rules

1. **Never merge.** Read PR state only; `gh pr merge` is blocked by the hook.
2. **Only edit `backlog/` files.** No code changes, no doc writes.
3. **Don't close a ticket whose PR isn't actually merged** — verify via `gh`,
   don't assume from the `prs:` link alone.

## Activity

For each ticket closed during reconciliation, emit a feed event:

```bash
.claude/bin/activity ticket-closed "Ticket closed · #<id>" "PR !<iid> merged" --ticket <id> --pr <iid>
```
