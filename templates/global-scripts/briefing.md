# briefing agent (global contract)

The morning roll-up. Once a day it reads what every other agent did overnight
and produces **one reviewable unit**: `~/.config/TerMinal/briefings/<date>.md`.

## Why this is an agent and not a subsystem

Every input it needs is already exposed — cron/agent runs, run outcome tags,
report artifacts, filed tickets, open HITL, `factoryHealth()`. Building a
"briefing service" in main would mean re-implementing aggregation that the MCP
tools already do, in a place that can't be edited without a release.

As an agent it is a text file you can open and change at 7am when the briefing
says the wrong thing. That is the whole argument. It also means the briefing
dogfoods the machinery it reports on: if scheduled agents are broken, the
briefing is the first thing that fails, and you find out immediately.

## Scope

**Global**, not per-repo. The briefing is inherently cross-repo — that is
precisely why it lives in the Inbox drawer rather than the (per-repo) Reports
tab. It runs against a designated home repo for worktree purposes only.

## Mode

`report`. It writes exactly one markdown file and files exactly one HITL. It
never edits source, never opens a PR, never merges.

## Inputs

All via `terminal-cli mcp`:

| Tool | For |
|---|---|
| `recent_agent_runs` | last 24h of runs across every repo, with status |
| `list_tickets` | tickets filed in the window (agents as author) |
| `list_hitl status=open` | anything still blocking |
| `factory_health` | the 24h/7d roll-up, cycle stats, recent failures |
| `list_activity` | `check` events, which is how cadence agents report in |

Plus, from disk: new `.TerMinal/reports/<kind>/<sha>.md` artifacts written in
the window, and any `artifacts/<date>/report.md` from persistent agents.

## The one HITL

It files **exactly one** HITL per day:

```
terminal-cli hitl --severity=low "Morning briefing — N items" "Review in the Inbox drawer."
```

`--severity=low` is load-bearing. The severity gate in `hitl-severity.ts`
compares against `settings.inbox.notifyThreshold` (default `urgent`), so a
`low` item lands **silently** in the Inbox with a badge and no ping. That is
exactly the desired behaviour: the briefing should be waiting when you open the
app, not buzzing your phone at 8am.

**Never file more than one.** A per-item HITL turns the daily briefing into the
notification spam it exists to replace.

If there are zero items, still write the file, and still file the HITL with
`N=0`. "The agents ran and found nothing" is information.

## Output — `~/.config/TerMinal/briefings/<date>.md`

This exact shape. The app parses it (`src/main/briefings.ts`) and the parser is
deliberately forgiving, but it only recognizes items under an `## Items`
heading with a `### [kind] Title` line.

```markdown
---
kind: briefing
date: 2026-07-31
generated: 2026-07-31T08:00:00Z
items: 3
status: ok
---

# Morning briefing — 2026-07-31

Two PRs opened overnight, one idea proposed, one run failed on beacon.

## Items

### [pr] Backfill 6 tests in ticket-provider
- agent: coverage
- repo: TerMinal
- link: https://github.com/owner/repo/pull/201
- nav: mrs
- detail: Coverage rose 72.1% to 74.8%.

### [idea] Cache invalidation test for the workspace daemon
- agent: ticket-ideas
- repo: TerMinal
- ledgerKey: workspace-daemon-cache-invalidation
- link: ticket:0130
- nav: tickets
- detail: Proposed as horizon:future.

### [run] deps-quality failed on beacon
- agent: deps-quality
- repo: beacon
- nav: runs
- detail: bun audit exited 1.
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `[kind]` | yes | `pr` `ticket` `idea` `hitl` `run` `report` `lesson` `note`. Unknown → `note`. |
| `agent` | yes | Producing agent id. Half of the ledger address. |
| `repo` | yes | Repo basename. The other half. |
| `ledgerKey` | **only for proposals** | The key this agent wrote into its `proposedIdeas` ledger. |
| `link` | no | `https://…`, `ticket:<id>`, or `run:<id>`. |
| `nav` | no | Tab id for the Open button. Defaults per kind. |
| `detail` | no | One line. It is truncated in the UI — put the number, not the prose. |

**`ledgerKey` is the field that matters most.** It is what makes Dismiss mean
something: the app appends that key to the producing agent's `dismissed[]`
array, and the agent subtracts it forever after. Emit it on **every** item that
an agent *proposed* (ideas, suggested tickets, lessons) and on no item that
merely *happened* (a PR that opened, a run that failed — those are facts, and
dismissing a fact should not teach anything).

Getting this wrong is quiet: dismissing a proposal with no `ledgerKey` records
the verdict and teaches nothing, so the same idea comes back tomorrow.

## Ordering

Rank by *what would he want to see first if he only read three lines*:

1. Failures and blockers — anything that needs a decision.
2. PRs awaiting review (they're the throughput bottleneck; global §8 means
   nothing merges without him).
3. Proposals — ideas, lessons.
4. Everything else.

## Process

1. Compute the 24h window (or since the last briefing, whichever is longer —
   a missed day must not silently drop its items).
2. Gather from the MCP tools above.
3. Deduplicate: one item per *thing*, not one per *event*. A run that opened a
   PR is ONE `[pr]` item, not a `[run]` and a `[pr]`.
4. Rank and cap at 12. Beyond that nobody reads it; roll the tail into a single
   `[note]` item saying how many were elided.
5. Write `~/.config/TerMinal/briefings/<date>.md`.
6. File the single `--severity=low` HITL.
7. `terminal-cli activity check "Briefing · N items" "<date>"`
8. `terminal-cli mcp set_run_outcome runId=$TERMINAL_RUN_ID outcome=none`

## Hard rules

1. **One HITL per day.** Never per-item.
2. **`--severity=low`.** Anything louder defeats the design.
3. **Never write `<date>.verdicts.json`.** That file belongs to the app. The
   agent owns the `.md`; the app owns the verdicts. Neither parses the other.
4. **Never edit source, open a PR, or merge.**
5. **Always write the file**, even on a zero-item day.
6. **Emit `ledgerKey` on every proposal.** See above.
