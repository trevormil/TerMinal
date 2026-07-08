# Implementation notes

Human-facing running log of non-obvious decisions and deviations, per
CLAUDE.md §2. Newest first.

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
