---
id: 35
title: "Task→model routing layer: wire modelTier + modelPolicy into a resolveModel() seam"
status: in-progress
priority: medium
horizon: next
hitl: false
type: feature
source: manual
created: 2026-07-20
updated: 2026-07-20
prs:
  - https://github.com/trevormil/TerMinal/pull/116
worked_by:
  - claude-fable-5
refs:
  - src/main/agents.ts:1376
  - src/main/backlog.ts:34
  - src/renderer/src/lib/engines.ts
  - docs/workflow/agent-process.md:87-123
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
model_tier: auto
---

## Description
TerMinal already has the full data model for routing tasks to models — it's just
not consumed at spawn time. This ticket wires the existing (but currently dead)
tier fields into an actual selection function so a task's declared tier picks the
model that runs it.

What exists today:
- **Agent-level policy.** Every agent spec carries
  `modelPolicy: { default, cheap, deep, judge, allowOverride }`
  (`Agent`/`AgentDefinition` in `src/main/agents.ts`, authored in
  `.agents/agents.json`). Declared, surfaced in the Agents tab, documented in
  `docs/workflow/agent-process.md:87-123` — but no code reads it to choose a model.
- **Ticket-level hint.** `Ticket.modelTier` (`auto | top | cheap-agentic |
  cheap-raw`, `src/main/backlog.ts:34`) is parsed from `model_tier` frontmatter,
  round-tripped, and rendered as a UI badge — but never consulted for selection.
- **Static resolution.** The only live resolution point is
  `src/main/agents.ts:1376`:
  `const launchModel = spec.model || engineDefaultModel(spec.engine) || ''`.
  The tier fields are carried past this line but ignored.

The gap is a single decision function: `(spec, ticket) → concrete model`. Adding
it turns fields we already display into fields that actually route, with no new
schema and no UI work.

## Scope
Ship the **deterministic** version only. An LLM-classifier that auto-assigns a
tier from task text is explicitly **out of scope** (follow-up) — this ticket just
maps an *already-chosen* tier to a model. Keep it to one testable seam.

## Acceptance criteria
- A new pure function (e.g. `resolveModel(spec, ticket?)` in `src/main/agents.ts`
  or a sibling module) resolves a concrete model string from, in priority order:
  1. explicit per-run override (unchanged — still wins over everything);
  2. the ticket's `modelTier` mapped through the agent's `modelPolicy`
     (`top→deep`, `cheap-agentic`/`cheap-raw`→`cheap`, `auto`→`default`);
  3. `spec.model`;
  4. `engineDefaultModel(spec.engine)`;
  5. empty (engine's own CLI default).
- `agents.ts:1376` is replaced by a call to this function; behavior is unchanged
  when no `modelTier`/`modelPolicy` is present (pure fallback to today's value).
- `modelPolicy.allowOverride === false` prevents a per-run override from
  superseding the policy-selected model (respect the flag that already exists).
- When a mapped tier is empty/undefined in the policy, it falls through to the
  next priority step rather than emitting an empty `--model` flag.
- Unit tests in `src/main/agents.test.ts` cover: each `modelTier` → expected
  model; missing policy → unchanged fallback; `allowOverride: false` blocking an
  override; empty-tier fallthrough.
- `bunx tsc --noEmit` clean; `bun run test` passes.

## Design notes
- **Catalog location.** `ENGINE_MODELS` lives only in the renderer
  (`src/renderer/src/lib/engines.ts`); the resolver runs in main. Validating the
  resolved slug against real options needs a main-process catalog. Cheapest path:
  resolve to the policy string as-is (no validation) for this ticket and file a
  follow-up to share/move the catalog. Call out the tradeoff in
  `docs/implementation-notes.md`.
- **Tier→policy mapping** is the one real design choice — put it in a small named
  map, not inline conditionals, so a follow-up can tune it. The current
  `cheap-agentic` vs `cheap-raw` distinction can both map to `cheap` for now;
  note that they collapse.
- The `code-review` agent in `.agents/agents.json` pins `engine: claude` /
  `model: sonnet` while its `modelPolicy.default/deep` name a Codex model — a
  pre-existing inconsistency. Don't try to fix engine/model coherence here; the
  resolver only picks a *model* within the already-chosen engine. Flag it as a
  separate cleanup if the mapping surfaces it.
- Keep the function pure (no I/O) so it's trivially testable and reusable by a
  future `recommendTicketAgent()` extension.

## Follow-ups (do not do here)
- Extend `recommendTicketAgent()` (`src/main/backlog.ts:191-214`) to also emit an
  engine/model hint from the same keyword/type signal it already uses.
- Share or relocate `ENGINE_MODELS` to a main-accessible module and validate
  resolver output against it.
- LLM-classifier that auto-assigns `modelTier` from ticket text, gated by an
  `ai_spend_today` budget cap.
