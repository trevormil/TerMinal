# 13. The morning briefing is an agent, and the app only records verdicts

Date: 2026-07-31
Status: accepted

## Context

Four automations were meant to run overnight — propose ticket ideas, backfill
tests, clean up dependabot PRs, research and teach something — and a viability
audit found roughly 80-85% of that vision was composition of machinery that
already shipped. `bin/terminal-cron` already does worktree isolation, budget
gating, retry/backoff, circuit-breaking, and failure→HITL+ticket. `/check` is
the uniform runner. Two of the four had complete written contracts.

The genuinely missing piece was not a runner. It was that **nothing rolled up
what the agents produced into one reviewable unit.** The outputs were real but
scattered: a PR here, a ticket there, a report artifact, a run record, an
activity event. Reviewing the night's work meant visiting five surfaces and
knowing which ones had changed. (`digest-run.ts` is a red herring — it is the
per-PR review digest, not a daily one.)

So the question was where a daily roll-up should live, and who should build it.

## Decision

**The aggregator is itself a scheduled agent**, not a new subsystem in main.
Every input it needs is already exposed through the MCP tools —
`recent_agent_runs`, `list_hitl`, `factory_health`, `list_activity` — plus report
artifacts on disk. Implementing aggregation inside `src/main/` would mean
re-deriving that in a place that cannot be changed without a release. As an
agent it is a bash script and a markdown contract you can edit at 7am when the
briefing says the wrong thing.

It also dogfoods: if scheduled agents are broken, the briefing is the first
thing that fails, and you find out on the surface you were going to look at
anyway.

**Review lives in the Inbox drawer, not a new tab.** Reports is per-repo; the
briefing is inherently cross-repo, which is the same reason it can't be a repo
tab. CLAUDE.md already establishes that human-needed items live in the drawer.
A "Today" section there rides the badge that already exists and adds no chrome.

**It files exactly one sub-threshold HITL.** `hitl-severity.ts` compares an
item's severity against `settings.inbox.notifyThreshold` (default `urgent`), so
a `low` item lands silently in the Inbox with a badge and no ping. That existing
gate gives us precisely the desired behaviour for free: the briefing is waiting
when you open the app, and never buzzes your phone. A per-item HITL would turn
the briefing into the notification spam it exists to replace.

**Two writers, two files.** The agent owns `briefings/<date>.md`; the app owns
`briefings/<date>.verdicts.json`. The app never rewrites the agent's markdown.
Round-tripping generated prose through a hand-rolled parser to flip one field is
how you lose a briefing to a formatting edge case, and keeping the `.md`
append-only-by-one-writer makes it trustworthy as the durable record. This is
the same instinct as ADR-0012's ticket comment log: every writer appends, and
nobody parses what they didn't write.

**Dismiss writes back to the producing agent's ledger.** A briefing item that
an agent *proposed* carries a `ledgerKey`; dismissing it appends that key to
`dismissed[]` in the agent's state, and the agent subtracts it forever after.
Without this the review surface would be decorative — the SHA gate prevents an
agent re-*running*, not re-*proposing*, so the same idea would return tomorrow.

## Consequences

**The Runs tab is deliberately not retrofitted.** At 4-6 automations/day
(~150-200 records/month) the Runs list scales fine; the gap was semantic, not
volumetric. Runs stays the debugging surface — "what did this process do" —
while the briefing answers "what should I look at." Conflating them would make
Runs worse at both.

The briefing's fidelity now depends on agents emitting `ledgerKey` correctly on
proposals and calling `set_run_outcome` at the end of a run. Both are stated in
every agent contract, but neither is enforced by a type, so a new agent can
silently degrade the briefing. That is the main cost of choosing composition
over a subsystem, and it is accepted: the alternative buys enforcement at the
price of a release cycle per change.

`set_run_outcome`'s existing four-value enum (`pr-opened | ticket-filed |
merged | none`) was kept rather than widened. A blocked run and a clean run both
tag `none`, so the briefing must open the artifact's `status:` frontmatter to
tell them apart. Widening the enum stays available if that proves annoying.
