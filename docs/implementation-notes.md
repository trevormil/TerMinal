# Implementation notes

Human-facing running log of non-obvious decisions and deviations, per
CLAUDE.md §2. Newest first.

## 2026-07-20 — Ticket #36: openai-compat engine (self-hosted models)

- **The ticket's "sealed key never returned to the renderer" claim doesn't
  match the existing pattern**: `settings:get` returns the full decrypted
  Settings (including `openrouterApiKey`) to the renderer for the Settings
  input fields. The new `openaiCompatApiKey` follows the actual
  `openrouterApiKey` pattern — sealed at rest (tested), decrypted in-process,
  visible to the renderer's Settings panel. Hardening the IPC surface for ALL
  sealed keys would be its own change; deliberately not invented here for one
  key.
- **Interactive sessions shipped too** (ticket allowed one-shot-only): the
  Codex TUI accepts the same inline `model_providers.openai-compat.*` overrides
  or-agent uses, so interactive support was ~15 lines. `wire_api = chat`
  because self-hosted servers implement chat completions, not the responses
  API.
- **or-agent requires `--model` with a custom base URL** — the registry
  `defaults.agentic` is an OpenRouter slug a private server won't know; failing
  fast beats a confusing 404 from vLLM.
- **Cron runs**: base URL is plain in settings.json so the headless runner
  reads it, but the sealed key is not decryptable out-of-process (same
  constraint that created the telegram sidecar). Keyed servers need
  OPENAI_API_KEY in the shell profile or per-schedule env; the command guard
  fails loudly when the base URL is unconfigured rather than letting or-agent
  silently fall back to OpenRouter.
- **EngineModelPicker shows only "Default" for this engine** (empty catalog by
  design); the full free-text slug input lives in the run dialog's model step.
  Set the engine default model in Settings for pickers without free-text.
- Engine cost attribution: `openai-compat` joined cursor/openrouter/hermes in
  the `recordRunnerInvocation` exclusion — there is no cloud spend to record.
- **Composes with #35's resolver:** the missing-model fail-fast consults the
  full resolveModel chain (override → owner policy/tier → agent model → engine
  default), so a policy-supplied model satisfies it.

## 2026-07-20 — Ticket #35: resolveModel() — tier→model routing seam

- **No catalog validation.** `resolveModel` returns the policy string as-is;
  `ENGINE_MODELS` lives renderer-side only (`src/renderer/src/lib/engines.ts`),
  so validating resolved slugs against real options would need the catalog
  shared into main. Deliberately deferred to a follow-up ticket — a bad slug
  fails loudly at engine launch, which is acceptable for v1.
- **Cross-engine guard (not in the original ticket).** Policy slugs are
  engine-specific (`gpt-5-codex`), but the run dialog can relaunch a ticket on
  a different engine. `resolveModel` therefore drops the policy (and its
  `allowOverride` lock) when the run engine differs from the agent's own
  engine, instead of emitting e.g. `claude --model gpt-5-codex`.
- **Intended behavior changes** (the point of the ticket): agents that declare
  a `modelPolicy` now launch with `policy.default` even when the per-engine
  Settings default differs; `allowOverride: false` is enforced for the first
  time. Agents without a policy resolve exactly as before. `AgentRun.model` now
  records the *resolved* model rather than the raw override, so the Runs tab
  shows what actually launched.
- `cheap-agentic` and `cheap-raw` both map to the policy's single `cheap` slot
  (documented in `TIER_TO_POLICY`); remote-host daemon ticket runs don't thread
  `modelTier` yet (separate protocol surface).

## 2026-07-07 — Ticket #14: Structural (difftastic) diff mode

- **Content source is the forge API, not local git.** difft needs both full
  file versions; the PR's commits may not be fetched into the local clone, so
  `forge.fileContent()` pulls blobs via `gh api .../contents` / `glab api
  .../repository/files` (base64-decoded). Required adding `baseRefOid` to
  `GH_VIEW_FIELDS` and surfacing `baseShort` on `RawMrDetail`.
- **Rendering reuses xterm** (`StructuralFileDiff` in `MrDetail.tsx`) rather
  than a custom ANSI→HTML converter — difft's `--color=always` output drops
  straight into a read-only `@xterm/xterm` instance, matching the app's
  terminal look. `xtermThemeFromCss` was exported from `Terminal.tsx` for
  reuse (light/dark parity for free).
- **Added `--width` threading (beyond the original ticket plan).** difft
  spawned without a TTY defaults to 80 columns, cramped in a wide pane. The
  renderer passes its fitted xterm `cols` through `getStructuralDiff(iid,
  path, width)` → `runDifft`, clamped to [80, 400]. Width is part of the
  structural-diff cache key. Follow-up: reflow-on-resize (currently a remount
  on file switch re-runs; live pane-resize does not re-fetch).
- **Transient failures are not cached.** Only definitive outcomes (a real
  diff, or "binary") are memoized by `(iid, path, headShort, width)`. A
  rate-limited/auth-failed fetch or difft hiccup returns uncached so a
  switch-away-and-back retries instead of being stuck until app restart.
- **Binary detection** is a NUL-byte scan on the decoded content
  (`looksBinary`), falling back to the Unified/Split views with a message.
- **Remote (ssh) workspaces**: structural diff returns a "not supported on
  remote workspaces yet" error, mirroring how digest is handled — the blob
  fetch + difft run are local-only for now.
- **Out of scope (deferred):** not wired into `DigestView`'s Changes tab; the
  `difft` binary is not bundled in the Electron build (required on PATH, same
  as `gh`/`glab`); structural output is not persisted into `.reviews/`.

## 2026-07-08 — `/feature`: Telegram idea → ticket → PR

Added a `/feature <description> [@repo]` Telegram command. It drafts a real
ticket from free text (haiku via `cheapCall`), files it, and offers a
`🚀 Start work` inline button that hands the ticket to a background agent. The
bg watcher links the resulting PR back onto the ticket.

**Decisions not in the original sketch:**

- **The ticket body is embedded in the work prompt, not read from disk.**
  `spawnBgTask` branches its worktree off `main`, where a just-created ticket
  file is still untracked and therefore absent. Rather than commit the ticket or
  copy it into the worktree, `featureWorkPrompt` inlines title/body/acceptance —
  matching the existing convention in `runTicketAgent` (`agents.ts`). The agent
  is explicitly told *not* to edit the ticket file; TerMinal links the PR itself
  via `linkTicketPr`, which makes the link deterministic instead of depending on
  the agent remembering.

- **Draft-then-confirm, with the ticket filed up front.** The ticket is written
  before the buttons are shown, so a lost draft (app restart) loses only the
  button, never the request. `☑️ File only` is therefore a no-op ack rather than
  a delete path.

- **Callback keys are integers, not slugs.** Bot API caps `callback_data` at 64
  bytes and slugs can exceed it. `featureDrafts` is a bounded `Map` keyed by a
  counter — the same lifetime tradeoff as the existing `lastRunIds`/`lastHitlIds`.

- **LLM failure falls back to a title-only ticket** rather than dropping the
  request, and says so in the reply.

- **Failed runs hand the ticket back.** The sweep resets a `ticketSlug` task's
  ticket to `open` on failure, so it doesn't sit `in-progress` with nothing
  working it (a HITL item already carries the failure).

**Bug found and fixed en route (pre-existing, not caused by this work):**

Main bundles to ESM, where the `createRequire(import.meta.url)` shim resolves
relative to the *emitted bundle*. Every `require('./sibling')` in `src/main`
therefore throws `MODULE_NOT_FOUND` in the packaged app. Verified against
`out/main/index.js`. Consequences:

- `/bg`, `/bg list`, `/bg cancel`, `/budget` over Telegram were **silently dead**
  in `/Applications/TerMinal.app` — `handle()`'s exception is swallowed by
  `pollTelegramOnce`'s catch, so the user just got no reply.
- `bg-tasks.spawnBgTask`'s budget gate never ran: `require('./budgets')` threw
  into its own `catch { /* fall through and allow */ }`, so the daily cap did
  **not** gate background tasks.

Converted those seven call sites in `telegram.ts` + `bg-tasks.ts` to static
imports. The lazy-require comment ("avoid pulling bg-tasks into telegram-parse
tests") was stale — no test imports `telegram.ts`, and it already statically
imports `./agents` and `./settings`.

**Still broken, deliberately out of scope** (both are `try`/`catch`-guarded
silent degradations in other subsystems, so they fail soft):

- `events.ts:187` — `require('./event-classifier')`: activity events silently
  skip LLM kind-inference and fall back to the heuristic.
- `agents.ts:1351` — `require('./ai-collectors')`: `recordRunnerInvocation` never
  fires, so agent-run token/cost attribution may be under-recorded.

Worth a follow-up ticket; a lint rule banning `require('./` under `src/main`
would prevent regressions.

## 2026-07-22 — `terminal-cli routing`: a dry-run explainer for model_tier

Added `terminal-cli routing [<repo>] [<ticket>]`, which prints which model each
`model_tier` would resolve to for a ticket without spawning a run. Motivated by
#120: the write path shipped, but there was no way to confirm a tier actually
changes anything short of launching a real agent and reading the run log.

**Decision — mirror rather than import.** `bin/terminal-cli` is copied to
`~/.config/TerMinal/bin` and is deliberately self-contained (see its header), so
it cannot import `src/main/resolve-model.ts`. `routing` therefore mirrors
`TIER_TO_POLICY` + `resolveModel` + `modelPolicyFrom`, the same tradeoff the file
already made for `MODEL_TIERS`.

A mirror of the code under test is a useless oracle if it drifts, so the mirror
is pinned by `src/main/terminal-cli-routing.test.ts`: 32 parity cases
(4 policies × 4 tiers × override/no-override) assert the CLI's `WOULD LAUNCH`
line equals the real `resolveModel()`. Verified non-vacuous by mutation —
flipping `top: 'deep'` to `top: 'cheap'` in the CLI fails 3 cases.

**Known fidelity gap, surfaced rather than hidden.** `readAgents()` merges five
layers; this script can read four of them (global `agents/global.json`, global
scripts, repo `.agents/agents.json`, repo `.agents/*.json`). The app's
compiled-in `DEFAULT_AGENTS` are invisible, and two of them
(`1000x-ai-engineer`, `code-review`) carry a `modelPolicy`. When the owner agent
is not found in a readable layer, `routing` prints `NOT FOUND in global/repo
files` plus a note that the table may understate the routing, rather than
reporting a confident "no policy". On this machine both agents also exist in
`agents/global.json`, so the gap is narrow in practice.

Persistent-kind owners are likewise reported as out of reach.

**Follow-ups (not in this branch):**
- No UI affordance sets `model_tier` — `TicketsBrowser.tsx:486` only renders a
  badge. A human still cannot pick a tier in the app.
- `ticket-provider.ts:361,563` hardcode `modelTier: 'auto'` for GitHub/Linear
  tickets, so tier routing is inert for those repos.
