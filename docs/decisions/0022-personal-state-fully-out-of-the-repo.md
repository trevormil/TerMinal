# 0022 — Personal state moves fully out of the repo (sidecar, second wave)

- Status: accepted
- Extends: [0020](./0020-workflow-state-in-a-per-project-sidecar.md) (same
  mechanism, wider boundary), [0021](./0021-agent-contracts-ship-with-the-plugin.md)
- Date: 2026-08-07

## Context

ADR-0020 moved the five workflow *areas* (backlog, sessions, reviews, checks,
reports) into the per-project sidecar, but drew the boundary at "repo config":
`.TerMinal/tickets.json`, notes, knowledge, snippets, loop/artifact runtime
state and the bootstrap stamp stayed in the repo. Auditing after the stack
landed showed most of that remainder is *personal*, not project config:

- `tickets.json` carries which provider **you** read tickets through, your
  Linear team/workspace pick, and your custom/saved views.
- `notes.md`, `knowledge.json`, `snippets.json` are personal scratch state.
- `loops/`, `agent-requests/`, `knowledge-rag/` are pure runtime state.
- `meta.json` records when **this machine** last bootstrapped.

None of that belongs in a repo a collaborator pulls. The template also seeded
`widgets.json` + `snippets.json` boilerplate into every repo — doubly wrong
after the Settings → Security flag made repo widgets inert by default.

## Decision

Everything personal resolves through the sidecar, using ADR-0020's exact
read-merge/write-one rule, via two new resolvers beside the area ones:

- `repoStatePathForWrite(repoRoot, rel)` — always `<sidecar>/<rel>`.
- `repoStatePathForRead(repoRoot, rel)` — sidecar copy if present, else the
  legacy in-repo `.TerMinal/<rel>`, else the (missing) sidecar path.

The catalog (`SIDECAR_STATE_RELS`): `tickets.json`, `notes.md`,
`knowledge.json`, `snippets.json`, `meta.json`, `loops/`, `agent-requests/`,
`knowledge-rag/`. Loops resolve **per loop id** so an in-flight loop finishes
where it started.

Deliberately still in the repo:

- `.TerMinal/template.json` — the layout marker is a fact about the repo.
- `.TerMinal/widgets.json` / `tabs.json` — repo-provided extension surfaces a
  project ships on purpose (Security-gated) — but no longer *seeded*.
- `.agents/`, `docs/`, CI, PR templates — team contracts (ADR-0020/0021).

The one-time migration (Settings → Updates) moves the new rels with the same
guarantees: rename never delete, refuse to overwrite, idempotent, committed
into the sidecar. The standalone bins (`terminal-cli`, `terminal-cron`,
`terminal-mcp-server`, `remote-host-script`) share the resolver through the
generated inline block; `tm-state-dir` accepts the rel names so skills resolve
the same paths (`tm-state-dir tickets.json`).

## Consequences

- New repos get a `.TerMinal/` containing only `template.json`.
- Legacy in-repo copies stay readable until migrated; writes stop accreting
  immediately.
- The state-path hygiene test now rejects model-facing literals for the new
  rels, same as areas.
- Remote-host notes/agent-requests resolve to the *host's* sidecar; the
  cross-machine sync gap is unchanged from ADR-0020.
