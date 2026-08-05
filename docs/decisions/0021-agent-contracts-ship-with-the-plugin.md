# 21. Agent contracts ship with the plugin, overridable per repo

Date: 2026-08-05

Status: accepted

Amends [ADR-0020](0020-workflow-state-in-a-per-project-sidecar.md), which kept
all of `.agents/` in the repo. Extends the layering [ADR-0019](0019-global-tm-plugin.md)
established for skills. Ticket 0283.

## Context

ADR-0020 drew the line at `.agents/`: agent contracts are shared with the team
the same way CI config is, so they stay in the repo. That reasoning is sound for
a contract a project has actually *decided* something about.

It does not describe what was happening. `bootstrap.sh` copied all 17 contracts
into every repo, byte-identical, and nothing ever refreshed them — the same
mechanism, and the same failure, that ADR-0019 removed for skills. They are the
largest single thing bootstrap wrote: 17 files and ~100KB per repo, of which the
overwhelming majority were never edited. TerMinal's own copies had already
drifted from the template's, which is how the duplication was noticed.

The distinction that matters is not "contract vs skill" but **default vs
decision**. A copied default is duplication; an edited contract is a decision
worth committing and sharing.

## Decision

Contracts layer, exactly like agent scripts already do (`agent-registry.ts`:
per-repo `.agents/<id>.sh` wins over the global one):

1. `<repo>/.agents/<kind>.md` — this project's contract, when it has one
2. `<plugin>/agents/<kind>.md` — the shipped default

- Resolved by `agentContract()` (`src/main/agent-contracts.ts`) in the app and
  `tm-agent-spec <kind>` in a shell, which is linked onto PATH beside
  `tm-state-dir`. Nothing hardcodes `.agents/<kind>.md` any more.
- `bootstrap.sh` no longer copies contracts. For existing repos it removes only
  those **byte-identical to the shipped default** and reports how many it kept:
  a customized contract is the repo's decision and must survive. Comparison is
  by content — never a timestamp, never a heuristic.
- What stays per-repo: the agent config (`.agents/<id>.json`), the executable
  bodies (`.agents/<id>.sh`), `owned.yml`, and any contract a repo overrides.

## Consequences

- A bootstrapped repo drops from ~36 files to ~19, and from ~150KB of `.agents`
  to the handful that describe *this* project. TerMinal's own `.agents/` went
  from 24 files to 9 — the 15 it carried unmodified were removed, leaving only
  its genuinely repo-specific agents (`daily-factory`, `ux-taste`).
- Updating TerMinal updates every repo's contracts, which is the same win, and
  the same risk, as ADR-0019: a contract change now reaches every project at
  once. Contracts are advisory prose read by a model rather than executed code,
  so the blast radius of a bad edit is a worse run, not a broken build.
- **Overriding is now a deliberate act with a visible cost.** Previously every
  repo held a copy, so editing one looked free and invisible; the edit then
  drifted from the default forever. Now a file in `.agents/` means someone chose
  to diverge, and `tm-agent-spec` reports which layer answered.
- Contracts cross-reference each other in prose (`per .agents/testing.md`).
  Those references resolve within whichever directory answered, and since the
  defaults sit together in the plugin, a model that opened one finds its
  siblings. Only the call sites that *instruct* a model to open a contract were
  rewritten to resolve it.
- A repo whose contracts were customized keeps every one of them, and keeps
  winning. That is the case this decision is most careful about: silently
  replacing a team's edited contract with a default would be far worse than the
  duplication being removed.
