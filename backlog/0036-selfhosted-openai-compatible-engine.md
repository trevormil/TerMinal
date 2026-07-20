---
id: 36
title: "Route to a self-hosted / network model: configurable base URL + openai-compat engine"
status: in-progress
priority: medium
horizon: next
hitl: false
type: feature
source: manual
created: 2026-07-20
updated: 2026-07-20
prs: []
refs:
  - src/renderer/src/lib/types.ts:440
  - src/main/settings.ts:89
  - src/main/agents.ts:979
  - bin/or-agent
  - bin/or-exec
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
model_tier: auto
---

## Description
TerMinal can drive Claude, Codex, Cursor, OpenRouter, and Hermes, but it cannot
point an engine at a **self-hosted / network-connected model** (a box on the LAN
or behind a tunnel running vLLM, Ollama, LM Studio, TGI, llama.cpp server,
SGLang, etc.). The blocker is that there is no configurable **endpoint**:

- `EngineCfg = { path, defaultModel }` (`src/renderer/src/lib/types.ts:440`) has
  no base-URL field.
- The OpenRouter harness hardcodes the endpoint:
  `bin/or-exec` → `https://openrouter.ai/api/v1/chat/completions`;
  `bin/or-agent` drives Codex with `-c model_provider=openrouter`. Neither reads
  a base-URL override.

Since virtually all self-hosted inference servers expose an **OpenAI-compatible**
`/v1/chat/completions`, the natural design is one endpoint knob plus a first-class
`openai-compat` engine that reuses the existing Codex/or-agent harness.

Deliver two layers in this ticket:
- **Layer A — generalize the harness base URL.** Make `bin/or-agent` /
  `bin/or-exec` read an `OPENAI_BASE_URL` (default: the current openrouter.ai
  value), so the existing agentic loop can target any OpenAI-compatible endpoint.
- **Layer B — first-class `openai-compat` engine.** A configurable engine with a
  base URL + sealed API key in Settings, spawned through Layer A's harness.

**Route 1 (script-first agent) already works today** and is the documented
fallback — see Design notes; do not build it, just reference it.

## Scope
- OpenAI-compatible endpoints only (the common denominator for self-hosted
  servers). Anthropic-compatible or bespoke protocols are **out of scope**.
- No new agentic-loop implementation — reuse the Codex/or-agent harness.
- Model auto-tiering and ticket→model selection are a **separate concern**
  (ticket 0035); this ticket only adds the engine + endpoint axis. They compose
  but neither blocks the other.

## Acceptance criteria

### Layer A — harness base URL
- `bin/or-agent` and `bin/or-exec` resolve the endpoint from `OPENAI_BASE_URL`
  (env), falling back to the current `https://openrouter.ai/api/v1` when unset —
  existing OpenRouter behavior is byte-for-byte unchanged when the var is absent.
- The API key is read from `OPENAI_API_KEY` **or** the existing
  `OPENROUTER_API_KEY` (back-compat), documented in the script header.
- Codex `model_provider` base_url is threaded through so `or-agent` can target a
  custom provider, not just openrouter.

### Layer B — openai-compat engine
- `Engine` union gains `"openai-compat"` (or `"selfhosted"`) in
  `src/renderer/src/lib/types.ts` and the renderer catalog
  (`src/renderer/src/lib/engines.ts`): `ENGINE_LABEL`, `ENGINE_VENDOR`,
  `ENGINE_MODELS` (seed empty/free-text), and `engineAllowsCustomModel === true`
  (model is a free-text slug).
- `EngineCfg` is extended with `baseUrl: string` (and the engine's sealed
  `apiKey`), following the sealed-setting pattern already used for
  `openrouterApiKey` (`src/main/settings.ts:89,111,290,640`) — the key is sealed,
  never returned in plaintext to the renderer.
- `buildCmd`/`displayCmd` (`src/main/agents.ts:979`+) gain an `openai-compat`
  branch that spawns the Layer-A harness with `OPENAI_BASE_URL` + key injected
  into the spawn env (alongside the existing `OPENROUTER_API_KEY` injection at
  `agents.ts:1512`).
- Settings UI exposes the base URL + sealed key + default model for the new
  engine (mirror the existing per-engine config rows).
- An agent/ticket configured with `engine: openai-compat` runs end-to-end against
  a local OpenAI-compatible endpoint and its output streams into the run log like
  any other engine.

### Gates
- `bunx tsc --noEmit` clean; `bun run test` passes.
- A unit test covers base-URL resolution (env set → custom; env unset → openrouter
  default) and that the sealed key is never serialized to the renderer.

## Design notes
- **Route 1 (available today, do not build).** A script-first agent
  (`.agents/<id>.sh`, `agents.ts:1493`) already receives `TERMINAL_WORKTREE` /
  `TERMINAL_MODEL` / `TERMINAL_ENGINE` and can `curl` a local endpoint directly.
  Document it in the runbook as the zero-change fallback; it re-implements the
  agentic loop, which is exactly what Layers A/B avoid.
- **Why reuse the Codex harness** rather than a fresh client: Codex already
  supports arbitrary providers via `model_provider` + `base_url`; `or-agent`
  merely pins that to openrouter. Generalizing the base URL is a few lines and
  inherits tool-calling / the agentic loop for free.
- **Sealed key, not plaintext.** Follow `openrouterApiKey`
  (`settings.ts:89,111,290,640`): add to the sealed-keys list, strip on read-out
  to renderer, fall back to `process.env` when the sealed value is empty.
- **Trust / network.** Agents spawn with `danger-full-access` / `--yolo`. A
  network model means a base URL like `http://10.0.0.x:8000/v1` or a tunnel — the
  runbook must call out gating with an API key and/or network ACL, and that model
  output drives real tool calls. Note the plaintext-HTTP-over-LAN risk.
- **Interactive vs one-shot.** The OpenRouter one-shot path is not usable
  interactively (`index.ts:413`). Decide whether `openai-compat` supports
  interactive sessions or is one-shot/agent-only for v1; one-shot/agent-only is
  an acceptable v1 — state it in the notes.
- Record any deviation/tradeoff (e.g. deferring interactive support) in
  `docs/implementation-notes.md` per repo convention.

## Follow-ups (do not do here)
- Ties into ticket 0035: once `openai-compat` is a registered engine, a ticket's
  `modelTier` (e.g. `cheap-raw`) can resolve to the self-hosted model — "route
  bulk/cheap tasks local, frontier tasks cloud."
- Anthropic-compatible (`ANTHROPIC_BASE_URL`) endpoints as a second protocol.
- Health/readiness probe for the endpoint in `env:detect` so an unreachable
  self-hosted box surfaces in Settings like other engines.
