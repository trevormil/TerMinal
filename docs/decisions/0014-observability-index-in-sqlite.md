# 14. The observability index is a local SQLite database

Date: 2026-07-31

Status: accepted

## Context

The Observability tab answers questions across *all* agent history: costliest
turns, tool-call bloat, low-yield sessions, per-model and per-repo rollups. The
raw material is the CLIs' own on-disk transcripts — many JSONL files under
`~/.claude` and friends, one per session, growing without bound.

Answering any of those questions by scanning the transcripts means re-reading and
re-parsing every file per query, in the main process, while the user waits. Every
sort, filter and rollup pays the full scan again. That is fine for "show me the
last 20 sessions" (which is what `data.ts` still does) and hopeless for
"top 50 tool calls by output bytes across a year of history".

The alternatives considered were: keep scanning and cache aggressively in memory
(unbounded RSS in a long-lived desktop process, cold on every launch); write our
own index file format (a database, badly); or use an embedded database.

## Decision

Build a **derived index in SQLite** at
`~/.config/TerMinal/observability.sqlite`, via `better-sqlite3`
(`src/main/observability-index.ts`).

- **Derived, never authoritative.** The transcripts remain the source of truth.
  The index is a cache that can be deleted at any time and rebuilt
  (`observability:index-rebuild`); nothing is stored there that isn't
  reconstructible from disk.
- **Synchronous by design.** `better-sqlite3` is synchronous, which suits a
  main-process query that is answering one IPC call — no connection pool, no
  async machinery, and the queries are indexed and bounded (`ROW_QUERY_CAP`).
  `journal_mode = WAL` so a rebuild doesn't block reads.
- **The schema is query-shaped**: `sessions` / `turns` / `tool_calls` /
  `token_snapshots` / `events`, with indexes on exactly the columns the tab's
  fixed query set sorts by. The query ids are a closed enum
  (`ObservabilityIndexQueryId`) — no user-supplied SQL crosses the IPC boundary.
- **Degrade, never crash.** `sqliteAvailable()` probes the native module and
  every status/query path returns `{ ok: false, sqliteAvailable: false }` instead
  of throwing, so an app whose native module failed to build still runs; the tab
  just loses the indexed views.

## Consequences

- **This is a native dependency, and native dependencies have packaging
  consequences.** `better-sqlite3` ships a `.node` binary that must be rebuilt
  against Electron's ABI (`postinstall` / `bun run rebuild` →
  `electron-rebuild -f -o node-pty,better-sqlite3`) and cannot be read from
  inside the asar archive, so it is listed in `asarUnpack` in
  `electron-builder.yml` alongside `node-pty` and `bindings`. Getting either
  wrong produces an app that builds, typechecks and tests clean but fails at
  runtime in the packaged bundle — which is precisely why CI gained a macOS
  packaging smoke job that installs *without* `--ignore-scripts` and launches the
  packaged app.
- Adding a second native dep raises the cost of ever supporting a platform
  beyond macOS (ADR-0003) and of any future Electron major bump.
- Queries that used to be impossible are now interactive, at the price of an
  explicit rebuild step: the index is stale until rebuilt, and the UI shows
  `indexedAt` so that staleness is visible rather than silent.
- The graceful-degradation path is a real, testable state, not a theoretical one
  — it is what a user with a broken rebuild actually sees.
