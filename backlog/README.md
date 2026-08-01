# Frozen: this is history, not the live backlog

Tickets filed today live in `.TerMinal/backlog/` (gitignored). This directory is
the **v1 layout**, kept for the record of the project's first month — all 41
tickets here are closed and nothing new is ever written here.

`status: closed` in this directory means "no longer tracked here", **not**
"verifiably shipped": most of these tickets carry `prs: []`, and their real
provenance is the git history (`git log --grep "ticket #0002"`). A couple of the
features they describe were built and later removed.

If something here is still wanted, re-file it in `.TerMinal/backlog/` with
current evidence rather than reviving the old ticket.

Rationale: [ADR-0018](../docs/decisions/0018-legacy-backlog-is-frozen-history.md).
