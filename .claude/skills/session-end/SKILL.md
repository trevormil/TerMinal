---
name: session-end
description: "Close a work session: reconcile what happened into the live session doc, clean up (dead code, scratch, stale branches), run a code-quality/refactor pass, suggest new tickets for follow-ups, capture documentation (ADRs/learnings/runbooks/architecture), and mark the session closed. Use when the user runs /session-end or says they're wrapping up."
---

# /session-end — Close a session, leave the repo + docs clean

The bookend to `/session-start`. Takes the active session doc and brings it (and
the repo) to a clean, well-documented resting state. The single most important
output is **proper documentation** — in the session doc, in `docs/`, and in
runbooks — so nothing learned this session is lost.

**This is not a quick wrap.** `/session-end` *starts* a closing process that is
often **15–30 minutes of real work**: it can trigger cleanups, small refactors,
consistency fixes, ticket filing, and documentation writes. Don't rush it or
treat it as a one-shot summary — work through the steps until the repo and docs
are genuinely clean. Use the session doc to track progress through the close.

## Process

### 1. Find the active session

```bash
ROOT="$(git rev-parse --show-toplevel)"
"$ROOT/.claude/skills/session-start/bin/sessions" active
```

Open its `sessions/<id>-<slug>/session.md`. If none is active, ask the user
which session to close. If more than one is active, surface them and ask.

### 2. Reconcile what happened → update the doc

Compare the session's plan to reality:

- `git log --oneline <started-or-base>..HEAD` and `git diff --stat` for the
  session's commits/branches.
- `gh pr list --author @me` / the branches in frontmatter for PRs opened or
  advanced.
- Walk the **Checklist**: tick done items; leave undone ones for Follow-ups.

Fill the session doc:
- **Outcomes** — commits, branches, PRs (urls), tickets moved to `closed`.
- **Decisions** — decisions made this session + reasoning (ADR candidates).
- **Log** — backfill any meaningful turns/blockers not already noted.
- Update frontmatter `branches` / `prs` if new ones appeared.

### 3. TDD + test verification pass

This workflow is TDD-first — verify it held:
- Every behavior change shipped this session has a corresponding test. Run
  `/test-suite` to confirm green at HEAD.
- **Tests are adversarial, not rigged.** Spot-check that the session's new tests
  actually pin meaningful behavior (not tautologies, weak assertions, or
  over-mocking that would pass even if the feature were broken). A rigged test is
  a gap, not coverage — see `.agents/testing.md` "Test quality".
- **Features are wired (tests passing ≠ shipped).** Each feature shipped this
  session is reachable from a real production entry point (route/CLI/job/UI/
  export/ABI), ideally proven by an automated e2e/integration test — not just
  unit-passing. A symbol reachable only from tests is unwired.
- Any behavior added **without** a (meaningful) test, or shipped **unwired**, is
  a gap → file a follow-up `/ticket` (testing type) and note it under
  Follow-ups. Do not paper over it.

### 4. Cleanup pass

Leave the tree cleaner than you found it — but **only your own mess** (global
§3). Identify and handle:
- Dead code introduced this session (unreachable branches, unused exports,
  commented-out blocks, debug logging) → remove.
- Scratch files in the session dir or repo that aren't worth keeping → remove.
- Stray `TODO`/`FIXME` added this session without a linked ticket → either fix
  or file a `/ticket` and reference it.
- Merged/abandoned local branches from this session → offer to prune.

Pre-existing dead code you didn't create: **mention it, don't delete it** (file
a ticket if worth it).

### 5. Code-quality / refactor pass

Scan this session's diff for quality issues (the anti-slop checklist in
`.agents/code-review.md`): speculative flexibility, over-abstraction, vague
names, WHAT-comments, unnecessary error handling. Fix small/local ones now;
for anything larger than a quick cleanup, file a refactor `/ticket` rather than
expanding scope at session end. If open PRs from this session haven't been
reviewed, recommend running `/code-review` on them (background — it's the
dev-speed bottleneck; ~4 min).

### 6. Consistency check (architecture + conventions)

Verify the session's changes are consistent with the documented design — drift
here is how a codebase rots silently:

- **`docs/architecture.md`** — does the code still match it? If the session
  added/moved a folder, service, or major dep, or changed a data flow, the code
  and the doc must agree. Reconcile by **either** fixing the code back to the
  documented design **or** updating `architecture.md` to reflect the new reality
  (and recording *why* as a Decision / ADR). Never leave them contradicting.
- **ADRs (`docs/decisions/`)** — did anything this session contradict an
  `accepted` ADR? If so, that's a deliberate decision: supersede the ADR (new
  ADR with `supersedes:`) rather than silently diverging.
- **CLAUDE.md conventions** — root + nested. Library choices, naming, error
  handling, file organization, comment policy (global §6 + project rules). Fix
  divergences now or file a `/ticket`.
- **Cross-file coherence** — terminology, patterns, and abstractions introduced
  this session match the rest of the codebase, not just internally consistent.

Run `/document-audit` if the session touched docs heavily — it flags broken
refs, stale runbooks, and ADR contradictions.

### 7. Reconcile ticket statuses (periodic cleanup)

Make the backlog match reality — this is the workflow's **periodic ticket
cleanup** (CLAUDE.md [4.1]). Run `/merge-sync` first (closes any ticket whose
PR/MR has merged + scrubs the URL), then sweep `bin/tickets`:

- **Touched this session:** every ticket worked is `in-progress` (still WIP) or
  `closed` (merged) — never left `open`.
- **Merged but still open/in-progress:** close it (or let `/merge-sync` do it).
- **`in-progress` with no open PR and no active work:** move back to `open`, or
  to `stuck` (with a why) / `icebox` — don't leave it falsely "in flight".
- **Long-stale `open`** (untouched, out of scope): `icebox` or `future`, or
  confirm it's still wanted.

The bar: after this step, `bin/tickets in-progress` is exactly the work actually
in flight. Note any status changes in the session doc's Outcomes / Follow-ups.

### 8. Suggest new tickets

For every follow-up, discovered bug, deferred item, or refactor: file a
`/ticket` (present them **one at a time** and confirm — don't batch-dump). Record
the resulting ids under the session doc's **Follow-ups**.

### 9. Capture documentation (most important)

Decide what this session produced that's worth preserving, and route each via
`/document` (one candidate at a time):
- **Non-obvious decision** → ADR in `docs/decisions/`.
- **Surprising finding / subtle invariant / gotcha** → learning in
  `docs/learnings/`.
- **Repeatable manual ops sequence** → runbook in `docs/runbooks/`.
- **Structural change** (new folder, major dep, service) → edit
  `docs/architecture.md`; add a per-folder `CLAUDE.md` for new folders.

Then fill the session doc's **Documentation** section: what was captured (with
paths) and what still needs documenting (as a follow-up).

### 10. Close the session

Set `status: closed`, `ended:` now. Confirm every anchored body section
(`[1]`–`[8]`) is filled (no stub headings left) and any new subsections you
added carry `[N.M]` anchors. Refresh the live snapshot
(`.claude/bin/status > .status.md`) so it shows no active session. Commit the
session doc + any doc/cleanup changes on a feature branch (never main).

### 11. Summarize

A tight wrap-up: what shipped (PRs/tickets), what was cleaned, what was
documented (paths), and the top follow-ups for next session.

## Quality bar

- **Nothing learned is lost.** If you can't point to where a decision/learning/
  gotcha was written down, it isn't done.
- **The repo is cleaner, not just bigger.** Session end removes this session's
  cruft.
- **Follow-ups are real tickets, not vibes.** "We should refactor X" becomes a
  filed ticket with acceptance criteria, or it didn't happen.

## What NOT to do

- Don't delete pre-existing code you didn't write this session (global §3).
- Don't merge to main (global §8) — commit docs/cleanup on a branch.
- Don't batch-dump a wall of suggested tickets — one at a time, confirm each.
- Don't leave the session `active` with stub sections — finish or mark
  `abandoned` with a one-line why.

## Activity

After closing the session doc, emit a feed event:

```bash
.claude/bin/activity session-end "Session closed · <slug>" "<one-line summary>"
```
