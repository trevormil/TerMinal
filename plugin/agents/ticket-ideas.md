# ticket-ideas agent (in-repo contract)

A scheduled agent that brings **new work ideas** each day — the "what should we
build next" half of the daily automations. It reads the repo and the existing
backlog, then proposes a small number of genuinely new tickets.

**Workflow is uniform**: own worktree → analyze → propose tickets → human triages.

## Mode

`report` — files backlog tickets only. Never edits source, never opens a PR.

## The problem this agent has that no other cadence agent has

Every other `/check` agent is protected from repeating itself by the SHA gate:
if trunk hasn't moved, there is nothing new to find, so it exits. That gate
prevents re-**running**. It does not prevent re-**proposing**.

An idea agent is different. Trunk moves every day, so the gate always opens —
and the same three obvious gaps ("add integration tests for the auth flow",
"the settings module has no error boundary") get re-derived from the same
unchanged code and filed again, every single day. Within a week the backlog is
unusable.

So this agent carries a **dedup ledger** (see `tm-agent-spec scripts` →
"Dedup ledger"). Every idea it has ever proposed, and every idea the human has
ever dismissed, is remembered by a stable key. Before proposing anything it
subtracts both sets.

## Inputs

- Existing backlog, via `terminal-cli mcp list_tickets repo=<repo>` — including
  `closed` tickets. A closed ticket is a decision, not a vacancy.
- The dedup ledger in agent-state: `proposedIdeas[]` and `dismissed[]`.
- Recent commit range and changed surfaces (the same range the SHA gate computes).
- The repo's own docs: `README.md`, `docs/architecture.md`, `docs/decisions/`,
  `CLAUDE.md`. Ideas should follow the project's stated direction, not fight it.
- Any `TODO(idea)` / `FIXME` clusters.

## Early-exit fast path

State at `~/.config/TerMinal/agent-state/<repo-basename>/ticket-ideas.json`:

```json
{
  "lastScannedSha": "abc1234",
  "lastRunAt": 1760000000000,
  "proposedIdeas": [{ "key": "auth-flow-integration-tests", "ticket": 91, "at": 1760000000000 }],
  "dismissed": [{ "key": "rewrite-settings-in-solidjs", "at": 1760000000000, "reason": "not our direction" }]
}
```

Unlike the other agents there are **two** gates, and the second matters more:

1. `HEAD == lastScannedSha` → exit 0, as usual.
2. **Budget gate**: if `proposedIdeas` already contains 3 or more entries
   created in the last 24h, exit 0. This is what actually keeps the backlog
   habitable — see "Hard rules" below.

## Process

1. **Worktree**: standard `/check` isolation.
2. **Load the ledger** — `proposedIdeas` + `dismissed` keys.
3. **Load the backlog** — every ticket title, open and closed.
4. **Generate candidates** grounded in what actually changed plus the repo's
   stated direction. Breadth over depth: an idea nobody had is worth more than
   a well-specified restatement of an open ticket.
5. **Subtract**: drop any candidate whose key matches the ledger or whose title
   is a near-duplicate of an existing backlog ticket (open *or* closed).
6. **Rank and cap at 3.** Fewer is better; **zero is a valid and common
   outcome.**
7. **File** each surviving idea as `horizon: future`, `priority: low`.
8. **Append to the ledger** — key + ticket id + timestamp.
9. **Write artifact** to `$TERMINAL_REPORTS_DIR/ticket-ideas/<short_sha>.md`.
10. **Activity + run outcome** — `terminal-cli activity check` and
    `terminal-cli mcp set_run_outcome runId=$TERMINAL_RUN_ID outcome=<...>`,
    using the existing four-value enum (`pr-opened` | `ticket-filed` |
    `merged` | `none`). `ticket-filed` when anything was filed, `none`
    otherwise. Nuance beyond those four lives in the artifact's `status:`
    frontmatter, which is where the morning briefing reads it from.

## Idea keys

The ledger key is a slug of the idea's *subject*, not its phrasing — otherwise
rewording defeats dedup. Normalize: lowercase, strip articles and filler verbs
(`add`, `improve`, `refactor`, `consider`), keep the nouns, join with `-`,
truncate to 60 chars.

```
"Add integration tests for the auth flow"  → auth-flow-integration-tests
"Consider improving auth flow test coverage" → auth-flow-test-coverage
```

These two are *not* identical keys, which is why step 5 also does a semantic
near-duplicate check against backlog titles rather than relying on the key
alone. The key is a cheap exact-match guard; the LLM pass is the fuzzy one.

## Output artifact

`$TERMINAL_REPORTS_DIR/ticket-ideas/<short_sha>.md`:

```yaml
---
kind: ticket-ideas
generated: 2026-06-01T08:00:00Z
sha: abc1234
last_scanned: 9b3de89
candidates_generated: 7
suppressed_by_ledger: 4
suppressed_by_backlog: 1
tickets_filed: [$TERMINAL_BACKLOG_DIR/0130-cache-invalidation-test.md]
status: ok
---
```

`suppressed_by_ledger` is the number worth watching: if it climbs while
`tickets_filed` stays at 0 for a week, the agent has run out of ideas and the
cadence should be lengthened.

## Hard rules

1. **At most 3 per day.** The active queue belongs to the human and to the
   agents actually doing work. Ideas are a trickle, not a firehose.
2. **`horizon: future`, `priority: low`, always.** An idea agent does not get
   to set the day's priorities. Promotion is a human act.
3. **Never re-propose a ledger key.** Both `proposedIdeas` and `dismissed`.
   Dismissal is permanent unless the human clears the ledger.
4. **A closed ticket is a decision.** Do not resurrect it as a fresh idea.
5. **Report mode.** No source edits, no PRs.
6. **Zero ideas is success.** Never pad to reach the cap.
