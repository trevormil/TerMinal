---
name: factory
description: "Continuous autonomous orchestrator — the perpetual loop around /stacked-mr. /stacked-mr does ONE pass (build a stack → batch-review to the bar → hand off); /factory keeps doing it: reconcile with /merge-sync, run a stacked-mr pass, optionally refill the queue with discovery agents, repeat — parking HITL on decisions/blockers, until the backlog is dry or you stop. NEVER merges to main/master (the human gate is the point). It reuses every skill; it does not reimplement build or review. Use when the user runs /factory or asks to run the factory / continuously / autonomously work the backlog until it's empty."
---

# /factory — continuous autonomous orchestrator

The perpetual loop. `/stacked-mr` is the **primitive** — one pass: build a stack of
PRs, batch-review them to the bar at the end, hand off. `/factory` is the **loop
around it**: reconcile, run a stacked-mr pass, (optionally) refill the queue, repeat
— parking HITL on anything that needs a human, until the backlog is dry or you stop.

It **reuses** every skill — especially `/stacked-mr` (the build + batch-review
engine), `/merge-sync` (reconcile), the discovery agents (refill), and `/notify`
(AFK). It adds **no new build/review logic and no new quality gate** — the bar lives
in `/stacked-mr`. Output is reviewed, merge-ready stacks; **the human merges**
(global §8, hook-enforced).

## [1] Invocation

```
/factory                      # loop the now/next backlog until it's dry
/factory "vault + payments"   # scope to a goal (passed through to each pass)
/factory --discover           # when the queue empties, refill from discovery agents instead of stopping
/factory --max-stack 12       # cap each stacked-mr pass's depth (default: stacked-mr's default)
```

AFK mode: **arm `/notify`** at kickoff; ping at each pass boundary and on every
HITL/blocker/stop.

## [2] The loop

```
   ┌─► /merge-sync (reconcile)
   │        │
   │        ▼
   │   /stacked-mr pass  (build the stack → batch-review to the bar → handle verdicts)
   │        │
   │        ▼
   │   in-scope queue empty?
   │     ├─ no  ──────────────────────────────► loop
   │     └─ yes → --discover? ─ yes → file work ─► loop
   │                          └ no ────────────► handoff ([6])
   └────────────────────────────────────────────┘
```

1. **Reconcile.** Run `/merge-sync` so the backlog is truthful — closes any PRs the
   human merged since the last pass and fixes status drift (CLAUDE.md [4.1]).
2. **Run a `/stacked-mr` pass** over the in-scope queue. That skill owns the
   mechanics: build the stack (each branch off the prior tip, no per-PR review),
   then one batch review of all PRs to the bar, then handle verdicts (fix +
   restack). `/factory` does not duplicate any of this.
3. **Refill or finish.** If the in-scope queue is now empty: with `--discover`, run
   the discovery agents to file new tickets ([5]) and loop; without it, go to
   handoff. If tickets remain, loop.

Across passes the stack keeps growing on the prior (unmerged) tip — the human
typically merges at the end, so reconcile mostly matters at the start of a run and
whenever the human merges mid-run.

## [2.5] Context hygiene — `/compact` aggressively at pass boundaries

A continuous loop is the *highest-bloat* surface in this workflow: each pass
accumulates `/merge-sync` output, `/stacked-mr` build logs, per-PR diffs, test
output, and N review verdicts. After ~2–3 passes the context is dominated by
stale tool results that no future step will read.

**Rule:** state of record lives on disk — `backlog/`, in-repo `.reviews/`, the
ledger (`sessions/<id>/stacked-mr.md`), and the forge — so the conversation does
*not* need to hold any of it. Compact aggressively; re-read from disk on demand.

Checkpoints — at each of these, run `/compact` (or summarize-and-purge) before
proceeding:

1. **End of every loop iteration**, before the next `/merge-sync` — the only
   thing the next iteration needs is "which tickets remain in scope," which is
   on disk.
2. **After `/merge-sync` returns**, before kicking off `/stacked-mr` — keep the
   short reconcile summary, drop the per-ticket diffs it printed.
3. **After filing a HITL item** — once `.claude/bin/hitl` has logged it, the
   conversation context around that decision is no longer load-bearing.
4. **Before discovery** (`--discover`) — discovery agents fan out fresh; they
   don't benefit from prior-iteration churn.

Prefer **out-of-process delegation** for heavy steps so their output never
enters the orchestrator's context in the first place: `/code-review` already
runs in a `codex exec` subprocess (the artifact is on disk; only the verdict
needs to come back), and each batch review runs in its own worktree. When
spawning sub-agents, ask them for a structured summary, not a transcript.

## [2.6] Orchestrator pattern — the factory agent stays thin

**The main `/factory` agent is a coordinator, not a worker.** It knows the
*state* of the work — which tickets are in scope, which PRs are stacked, which
verdicts are in — but it never holds the *content* of any individual step (a
file's diff, a review body, a test log). Anything heavy is delegated to one of
the patterns below; the orchestrator gets back a small, structured result and
re-reads from disk on demand.

Pick the delegation pattern by the shape of the work:

| Pattern | When to reach for it | Tradeoffs |
|---|---|---|
| **In-process subagent** (Claude Code Task / Agent tool) | Single-shot research, audit, multi-file scan, "find me X across the codebase" — work that needs Claude's tools + skills but no long edit loop. Parallel fan-out across N items. | + Easy invocation, parallelizable, shares the parent's model session. − The *return value* still consumes parent context — keep the schema/summary tight. − Stateless: brief it like a fresh colleague; the prompt **is** its memory. |
| **`codex exec` subprocess** (Bash) | Code review, test runs, deterministic-output passes. Anything where you want adversarial-different-model eyes + an on-disk artifact. | + Fully isolated context — parent only sees stdout. + Different model family (useful for adversarial review). + Artifact persists to disk = natural memory. − Cold start, slower per call. − Separate auth/billing. − Limited to codex's toolset. |
| **`claude -p` subprocess** (Bash) | A focused implementation/refactor step you want isolated from the orchestrator but still in Claude's hands. One-shot, no UI. | + Out-of-process, no parent bloat. + Same model family as parent (consistent behavior). − Separate session — uses your Claude credits independently. − One-shot: no multi-turn refinement. |
| **Spawn a session in a worktree** (TerMinal's Agents/Factory tabs; or `git worktree add` + a fresh `claude` session) | A full ticket-to-PR loop that needs many turns (TDD, fix cycles, commit + push). The heavyweight option — use when the work genuinely needs a sustained loop. | + Maximum isolation; visible + cancellable in the Agents tab. + Persists across many turns; can iterate. − Heavyweight to spin up; needs cleanup. − Each adds an active session to manage. |

**Briefing rule — feed in enough memory, no more.** Treat each delegated step
as a fresh colleague who knows nothing about this run. Hand over: (a) the
ticket id(s) and one-line goal, (b) the parent branch / base SHA, (c) the
specific files or paths that matter, (d) the `CLAUDE.md` slice(s) relevant to
*this* step (not the whole file), (e) explicit, verifiable success criteria.
**Let the delegate re-read the rest from disk** — don't pre-load it, that just
moves the bloat from the orchestrator into the subagent's prompt.

Anti-patterns:

- Returning a full diff / full review / full test log to the orchestrator.
  Return the verdict + an artifact path; the orchestrator can re-read iff
  needed.
- Pre-loading a giant context "just in case." If the delegate doesn't need it
  to satisfy the success criteria, leave it on disk.
- Choosing a Task subagent for work that runs many turns. Use a subprocess or
  a real worktree session instead — Task summaries get expensive fast.

## [3] What `/factory` adds vs `/stacked-mr` (and what it does NOT)

| | `/stacked-mr` | `/factory` |
|---|---|---|
| Build + batch-review to the bar | ✅ (owns it) | reuses it |
| Run shape | one pass, then stop | continuous loop |
| Reconcile first (`/merge-sync`) | — | ✅ each iteration |
| Refill the queue | — | ✅ optional (`--discover`) |
| Quality bar | defines it | unchanged — never altered |
| Merge to main | never | never |

`/factory` is **purely orchestration** — a loop + reconcile + refill + HITL. It adds
no new way to build or review, and never changes the bar.

## [4] HITL — park and continue

When a pass surfaces something a human must decide — ambiguous spec, design fork, a
destructive/cost-bearing action, a PR that can't reach the bar after stacked-mr's
fix cycles, or a dependency on a human-only action (approve a merge, provision
creds, an OAuth/browser flow) — raise it to the **global HITL inbox** with
`.claude/bin/hitl "<title>" "<action needed>"` (CLAUDE.md [4.2]; this pings the
operator), then continue independent work; pause only if nothing else can proceed.
The human resolves it from the HITL tab; the next loop picks it up once unblocked.
Do **not** raise HITL for review `request-changes` — that's the iterative loop's job.

## [5] Discovery (optional — `--discover`)

When the in-scope queue empties, refill it instead of stopping: run the discovery
agents (deep-audit / security-sweep / `/check` kinds) to file new `open` tickets,
then loop. **Off by default** — `/factory` does not invent infinite scope; without
`--discover` it drains the existing backlog and stops.

## [6] Handoff

Use `/stacked-mr`'s stack summary (PRs in dependency order with verdict, tests, and
any `stuck`/HITL flags), plus a one-line factory tally (passes run, total PRs at the
bar vs stuck). The human merges bottom-up; `/merge-sync` reconciles; capture
learnings via `/document`; close with `/session-end`.

## Hard rules

1. **Never merge to main/master** (global §8, hook-enforced) — the human gate is the
   point of the factory.
2. **Never change the review bar** — `/stacked-mr` owns it; `/factory` only runs more
   passes.
3. **Destructive / cost-bearing actions → HITL,** never autonomous.
4. **Reuse, don't reimplement** — `/factory` calls `/stacked-mr`, `/merge-sync`,
   discovery, `/notify`; it never duplicates build/review logic.
5. **Emit activity + `/notify`** at pass boundaries and on HITL/blockers so the run
   is observable live.

## What this is NOT

- **Not a build/review engine** — it's the loop *around* `/stacked-mr`.
- **Not a merge bot** — humans merge.
- **Not a bar-skipper** — the gate is `/stacked-mr`'s and is absolute.
- **Not a scope inventor** — without `--discover` it only works existing tickets.
- **Not budgeted** — there is no token/cost cap; the run is bounded by the backlog
  (finite unless `--discover`) and by you stopping it.

## Activity

```bash
.claude/bin/activity info "Factory started · <scope>" "looping the backlog"
# each pass: /stacked-mr emits pr-opened + review verdicts per PR
.claude/bin/hitl "Factory blocked · <title>" "<action needed / options>"   # true human-needs → global inbox
.claude/bin/activity task-complete "Factory done · <P> passes · <N> PRs" "<X at bar, Y stuck>"
```
