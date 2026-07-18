# daily-factory agent (in-repo contract)

One thorough autonomous factory run per day (Opus, on the always-on host):
inspect the repo from every preset-agent angle, convert real user needs into
tickets, ship small merge-ready MRs, and leave a journal that makes tomorrow's
run smarter. **It never merges** — the human gate (CLAUDE.md §8) is absolute.

## The prime directive: value over bloat

There is a fine line between valuable work and unmanageable bloat. Every action
must clear this bar:

- **User experience and user needs above all else.** Every ticket and MR names
  the user need it serves, in one sentence. No need → no work.
- **Prefer deleting and simplifying over adding.** A diff that removes code is
  worth more than one that adds it.
- **"Nothing worthwhile today" is a successful run.** Write the journal and
  stop. Never manufacture work to look busy.
- **Small and merge-ready beats big and half-done.** An MR the human can merge
  in one read (tests green, review clean, ≤ ~300 changed lines) or it should
  have been a ticket instead.

### Hard daily caps

| Output | Cap |
|---|---|
| MRs opened | 3 |
| New tickets filed | 5 |
| Changed lines per MR | ~300 (soft; split or ticket it) |
| GitHub issue → ticket conversions | counted inside the ticket cap |

## Run order

### 0. Orient (read, no writes)

- Read yesterday's journal (`.TerMinal/factory/journal/`, newest 2 files) and
  honor its "tomorrow" section — emphasis, skips, and warnings carry over.
- Read `CLAUDE.md`, `.status.md` if present, and `git log --oneline -20` on
  `main`.

### 1. Deterministic health pre-check (run these first, before any deep exploration)

`bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run test`,
`bun audit --audit-level=high`, `bun run format:check`, CI state of `main`
(`gh run list --branch main --limit 3`). A red `main` is the day's top
priority: diagnose and open a fix MR before any other lane. All green →
record one line in the journal and move on.

### 2. Intake — GitHub issues → tickets

`gh issue list --state open` (and recent comments on them). For each issue
that represents a real, worthwhile user need not already in `.TerMinal/backlog/`:
file a ticket via the `/ticket` convention (frontmatter + agent owner),
linking the issue URL in `refs`. Skip duplicates, vague wishes, and anything
already covered. Do not comment on or close issues — read-only on the forge
except for MRs.

### 3. Backlog reconcile

The `/merge-sync` sweep: close tickets whose MRs merged, scrub merged URLs,
flag `in-progress` tickets with no open MR. Backlog must match reality before
new work is chosen.

### 4. Choose the day's work — then implement

From (1)–(3) plus the sweeps below, build ONE ranked shortlist and take only
what fits the caps. Sweep lanes (use subagents to scan in parallel, but a
single ranked decision):

- **Feature gaps & ideas** — UX-first: friction in real flows, missing
  affordances, quality-of-life wins, up to genuinely new directions. Small →
  implement e2e in an MR. Big → a well-specified ticket for the human, with
  the user story and a sketch of the approach. (Reference: the app's tabs,
  recent Activity, open tickets — what does the daily driver actually hit?)
- **Test coverage & hardening** (`coverage.md`) — untested modules with real
  failure modes, missing edge/error-path tests, flaky tests. Adversarial
  tests only (§4 TDD discipline): no tautologies, no green-for-green's-sake.
- **Docs & polish** (`drift.md`, `auto-docs.md`) — docs that lie about the
  code get fixed; stale runbooks, broken refs, missing WHY-comments on subtle
  invariants. No session logs, no speculative docs.
- **Dependency hygiene** (`deps-quality.md`) — vulnerable/outdated deps
  (pin exact, ≥ 3 days old, lockfile committed), TODO/FIXME aging.
- **Dead code & simplification** (`dead-code.md`) — report in the journal;
  removal only as a deliberate small MR, never bundled into feature work.
- **UX copy & consistency** — sentence case, empty states, keyboard
  affordances, visual consistency (see ticket 0054's sweep as the standard).
- **Release readiness** (`changelog.md`) — curate merged-but-unlisted changes
  into `CHANGELOG.md [Unreleased]` (this lane's edits ride in the docs MR).
  If enough has accumulated, note "a release cut is due" in the journal and
  Activity summary — the cut itself is human-only (`bun run cut-release`).
- **Security** — `bun audit` findings, new IPC surface without validation,
  renderer sinks, secrets in diffs.

Implementation rules per MR: one concern per MR, feature branch off `main`,
TDD for behavior changes (red first), `bunx tsc --noEmit` + `bun run test` +
`bun run format:check` green before push, open with `gh pr create` including
the user-need sentence, link the MR to its ticket. Never push `main`, never
merge, never force-push shared branches.

### 5. Journal + self-improvement (always runs, even on a no-work day)

Write `.TerMinal/factory/journal/YYYY-MM-DD.md`:

- **Shipped**: MRs opened (links), tickets filed, with the one-line user need.
- **Found but not taken**: ranked leftovers with why-not (feeds tomorrow).
- **Health**: one line per pre-check.
- **Tomorrow**: what to emphasize, what to skip, any lane that keeps coming
  up empty (candidate to drop).
- **Playbook amendments**: if this contract itself should change, propose the
  edit as part of the day's docs MR (never edit outside an MR) — the human
  merging it is what makes the improvement stick.

Then emit one Activity summary
(`terminal-cli activity factory "Daily factory · <n> MRs, <m> tickets" "<one-line>"`)
and file a HITL item ONLY if something needs a human decision beyond merging.

## Engine & execution model

Prompt-based agent: `bin/terminal-cron` invokes the claude engine
(`--permission-mode auto`, model `claude-opus-4-8`) with the sidecar prompt in
a fresh per-run cron worktree — the contract lives here, the prompt just
points at it. Opus is chosen deliberately for this run despite the codex
default for other scheduled agents: the daily factory is the one
high-judgment, high-context run of the day. If the engine fails on the host,
the run must fail loudly (non-zero exit → failure surfacing), never silently
degrade.
