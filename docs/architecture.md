# Architecture

Evergreen overview of how TerMinal is put together. Edit in place as
the system changes.

## Shape

An Electron app in three layers, built with **electron-vite**:

- **main** (`src/main/`) — Node. Spawns PTYs, owns all filesystem/CLI reads,
  exposes everything over IPC. No DOM.
- **preload** (`src/preload/index.ts`) — the single `gt` bridge, published to the
  renderer via `contextBridge`. Every renderer↔main call goes through it.
- **renderer** (`src/renderer/src/`) — React 19 + Tailwind v4. The UI: the
  multi-session shell, per-session cockpit + tabs, plugins, editors.

```
renderer  ──(window.gt.*)──►  preload  ──(ipcRenderer/ipcMain)──►  main  ──►  fs / pty / gh·glab / git
```

## Multi-session model

One window hosts N Claude sessions. `App.tsx` keeps a list of sessions and a
top **session tab bar**; each session is rendered by a `SessionView` that stays
mounted (so its terminal/scrollback survives backgrounding) and is shown/hidden
by visibility.

In **main**, sessions live in a `Map<key, { pty, pinned }>` with an `activeKey`.
PTY IPC (`pty:input/resize/data/exit`) is routed by session key; the data IPC
(`data:*`, tickets, notes, files…) reads the **active** session via `cur()`. The
renderer calls `session:setActive(key)` whenever the active tab changes.

Each `SessionView` mounts:

- a **TerminalPane** (xterm.js) — always mounted; its PTY runs `claude`.
- a **cockpit** aside — the widget stack (rendered only when the session is
  active, so backgrounded sessions don't poll).
- the **tab** overlay — full-screen surfaces that sit over the terminal grid.

## Remote sessions (TerMinal Remote for iOS)

A session **opts in** by running the `/remote-terminal` skill; nothing is
scraped and the phone never touches a pty. The agent posts what it wants you to
see and reads what you send back, so this is identical for claude, codex, or
anything else that can run a shell command.

- **`src/main/remote-sessions.ts`** is the store: two files per session under
  `~/.config/TerMinal/remote/` — a JSON record and an append-only JSONL log.
  Plain files on purpose, so `bin/terminal-cli` can read and write them without
  importing the app.
- **`bin/terminal-cli remote`** is the agent's side: `register`, `post`,
  `ask` (blocks until the phone replies, printing it on stdout), `check`
  (non-blocking), `end`.
- **Replies queue behind a delivery cursor**, so a message sent while the agent
  is busy is handed over at its next check — exactly once — rather than needing
  the agent to be blocked at that moment.
- **`.claude/hooks/remote-check.sh`** is the always-on listener: a Stop hook
  that blocks the turn ending when something is waiting, so replies arrive
  without the agent polling. Silent and exit 0 wherever no session is
  registered, which is most sessions.
- **`src/main/bridge/`** is a small authenticated JSON API — no streaming.
  Sessions: `GET /v1/remote` (sessions + HITL), `POST /v1/remote/new`,
  `DELETE /v1/remote/:id`, `GET /v1/remote/:id/messages`,
  `POST /v1/remote/:id/reply`, `POST /v1/remote/:id/end`,
  `GET /v1/remote/:id/image/:name`. HITL: `GET /v1/hitl`,
  `POST /v1/hitl/read`, `POST /v1/hitl/:id`. Workspaces: `GET /v1/repos`,
  `GET /v1/workspaces`, `GET /v1/workspaces/:kind` (lists),
  `GET /v1/workspace/:kind` (drill-downs), `GET /v1/engines`. Push:
  `POST /v1/devices`. All bearer-authenticated except two bootstrap routes:
  `GET /v1/health` (liveness probe, reveals nothing but "a bridge is here")
  and `GET /v1/pair` (tailnet auto-pairing — the caller has no token yet by
  definition; gated instead by a CGNAT-range (100.64.0.0/10) remote-address
  pre-check, a `tailscale whois` confirmation that the peer belongs to the
  same tailnet user that owns this Mac, and rate limiting).
- **Off by default.** Nothing binds a port until `settings.bridge.enabled`;
  `will-quit` releases it.
- **HTTPS, self-signed, pinned.** The pairing QR carries base64 SHA-256 of the
  DER certificate and the client accepts only that one. Token, cert and key
  live at `~/.config/TerMinal/bridge/` (0600) rather than `settings.json`,
  whose `safeStorage` sealing drops secrets outright when OS encryption is
  unavailable — which would silently unpair a phone in dev builds.
- **HITL fans out to remote hosts**, so an agent blocked on `tm` still reaches
  the phone.
- **Push is an alert channel.** `createPushChannel` sits alongside
  telegram/desktop/webhook in `dispatchAlert`, and `src/main/bridge/push.ts`
  signs an ES256 JWT and posts to APNs directly from this Mac.

The client lives at [`ios/`](../ios/README.md). Design records:
[ADR-0006](decisions/0006-mobile-terminal-bridge.md) (transport, pairing,
pinning) and [ADR-0008](decisions/0008-remote-sessions-register-themselves.md)
(the registration model, superseding the terminal-mirror and transcript-chat
designs); shipping path:
[runbooks/ios-testflight.md](runbooks/ios-testflight.md).

## Plugins & tabs (auto-discovery)

Both are "just a folder" discovered with Vite `import.meta.glob`:

- **Plugins** — `src/renderer/src/plugins/<id>/index.tsx` default-exporting a
  `Plugin` (`{ id, title, icon, intervalMs, poll, render, … }`). `PluginWidget`
  runs each one's `poll` loop (interval + optional transcript-tick) and renders
  its card. Enable/hide state persists in `localStorage`.
- **Tabs** — `src/renderer/src/tabs/<id>/index.tsx` default-exporting a `Tab`
  (`{ id, title, icon, order, appliesTo(ctx), badge?, Component }`).
  `SessionView` filters by `appliesTo(tabContext)` and polls `badge(gt)` for the
  live count pill (HITL).

`icon` is a `lucide-react` component in both. **Command widgets**
(`lib/commandWidget.tsx`) wrap a declarative JSON shell-command spec as a Plugin.

## Data sources (main)

- `data.ts` — parses the session transcript
  `~/.claude/projects/<cwd-hash>/<session-id>.jsonl` (context, tokens, model,
  branch, last action, ai-title, permission mode, tool counts) and
  `~/.claude/tasks/<id>/*.json` (todos). Also computes the harness TDD/review.
- `usage.ts` — `GET /api/oauth/usage` with the keychain OAuth token; cached
  (rate-limited).
- `backlog.ts` — the markdown ticket store: tickets from `<repo>/backlog/*.md`
  (frontmatter incl. `horizon`/`hitl`); create/update write back. An optional
  `baseDir` override points the same store at an arbitrary folder (an Obsidian
  vault's `tickets/`), reusing id allocation + frontmatter unchanged.
- `ticket-provider.ts` — per-repo provider abstraction (`local | github |
  linear | obsidian`, in gitignored `.TerMinal/tickets.json`) routing
  list/get/create/update. **Obsidian** points `backlog.ts` at a dedicated
  per-repo vault (1 repo ↔ 1 vault, tickets private + outside git); it seeds a
  Dataview board + Templater template, exposes `obsidian://` deep links, and
  surfaces the vault to sessions via `OBSIDIAN_VAULT_PATH`/`OBSIDIAN_TICKETS_DIR`
  so native file tools reach it (no MCP). `github` shells out to `gh`; `linear`
  spawns its MCP over stdio from the main process. The same file's `views: [{
  label, url }]` is **provider-independent**: each entry renders in the Tickets
  tab as a read-only `<webview>` sub-tab showing the platform's own UI (reusing
  `browser/webSurface`), for team boards whose tickets don't meet our frontmatter
  spec. A view never changes where tickets are read/written — routing them through
  a provider would fabricate the owner-agent/acceptance metadata the factory
  contract depends on — so writes to those platforms go through their own MCP,
  driven in-session.
- `forge.ts` — the GitHub/GitLab seam: `forgeFor(repoRoot)` picks `gh`/`glab`
  and the `PR`/`MR` + `#`/`!` vocabulary from the remote host (or the
  `settings.forge` override). `mrs.ts` delegates here; the renderer is forge-agnostic.
- `mrs.ts` — merge/pull requests via the forge adapter, enriched with review state.
- `review.ts` — resolves code-review artifacts from in-repo `.reviews/<pr>/`
  (project-template) **or** the legacy autopilot-harness `prs/` store; handles
  the meta.json (commit-ordered) and no-meta (mtime) cases, with staleness.
- `sessions.ts` — per-repo session docs `<repo>/sessions/NNNN-slug/session.md`.
- `files.ts` — path-guarded dir/read/write/search (`git grep`), with
  `git check-ignore` marking for the dimmed tree.
- `scaffold.ts` — new-repo scaffolding from the embedded template (or a
  clone fallback in the packaged app).
- `repo.ts` — `repoForCwd` (origin → host/owner/repo), `repoRootOf`, git status.
- `settings.ts` — self-configuring persisted settings (every key has a working
  default; `''` resolves at read time) + legacy-shape migration. `env.ts`
  detects which of `claude`/`codex`/`gh`/`glab` are installed + authed.
- `agents.ts` — on-demand + scheduled + factory agent runs, each in its own git
  worktree; run records stream over IPC and persist for the Agents/Runs tabs.
  Completed in-process runs also write deterministic evaluation metadata
  (configured checks, status summary, judge-not-run state) and optional lineage
  back to a ticket or PR.
- `events.ts`, `hitl.ts`, `factory-health.ts`, `cycle.ts`, `schedules.ts` +
  `cron*.ts` + `launchd.ts`, `telegram*.ts` — the software-factory layer, below.

## Software factory & observability

A continuous, observable agent loop layered on top of the session shell. The
human gate to `main`/`master` is never crossed by the app — agents stop at "PR
open" and park true human-needs to HITL.

**Append-only global stores** under `~/.config/TerMinal/` (cross-repo, work
offline, survive a fresh clone):

- `activity.jsonl` — the event feed. `events.ts` emits in-process (and notifies
  per a `NOTIFY` map) **and** tails the file so *external* writers — the
  project-template `.claude/bin/activity` hook, CI, any script — broadcast to the
  renderer and trigger notifications too (deduped by event id). Events carry an
  optional `ref:{ticket?,pr?}` join key. Notifications fan out through the
  channel-agnostic alert layer (`notify-channels.ts`: Telegram, desktop,
  outbound webhook — per-channel toggles in Settings, failure-isolated; see
  [`docs/alert-channels.md`](./alert-channels.md)).
- `hitl.json` — the global HITL inbox (`hitl.ts`). `fileHitl` writes the item,
  mirrors a `blocked` activity event, and fires a Telegram ping. The top-right
  Inbox button badge shows the unresolved count. HITL items filed
  **out-of-process** (`bin/terminal-cli`, `bin/terminal-cron`,
  `bin/terminal-mcp-server`) ping Telegram too, but those are plain Bun
  processes that can't call Electron `safeStorage` to decrypt the token sealed
  in `settings.json` — so `settings.ts` mirrors the decrypted creds to a `0600`
  sidecar (`telegram.local.json`, `syncTelegramSidecar`, resynced on save and
  startup) that the bin filers read first, falling back to a legacy
  `telegram-notify.sh` script (cron included) when no native creds resolve.
- `schedules.json` + `cron-runs/` — the schedule store and per-run records.
- agent-run records — in `agents.ts`, surfaced globally on the Agents tab.

**Scheduling** (`schedules.ts` → `cron.ts`/`launchd.ts`): each enabled schedule
is mirrored to a per-schedule **launchd** LaunchAgent that runs a headless runner
(`bin/terminal-cron`, zero Electron imports, installed to
`~/.config/TerMinal/bin`) so it fires even when the app is closed.
`reconcileSchedules()` diffs launchd ↔ store to kill orphans and returns
`{loaded, removed, failed[]}` — `loaded` only counts jobs launchd actually
loaded (`isJobLoaded`, a plist-exists + `launchctl print` probe), so a schedule
that's enabled in the store but never bound in launchd (a "dark" schedule) is
surfaced instead of silently never firing. `syncSchedule` is idempotent
(`needsReload`: skip bootout/bootstrap when the job is already loaded and the
plist is unchanged) so an app relaunch doesn't reset a `StartInterval` job's
timer. Interval `nextRun` is anchored to `max(lastRun, jobLoadedAt)` (plist
mtime), matching launchd's actual "fires N seconds after load" semantics. A
failed (not cancelled) run auto-files a HITL item.

**Aggregation** (`factory-health.ts`): a read-only roll-up over those stores —
throughput windows, agent/cron success rates, recent failures, a daily
sparkline, top repos. **Cycle time** (`cycle.ts`, pure + unit-tested) joins a
ticket's events by `ref` (`ticket-filed{ticket}` → `pr-opened{ticket,pr}` →
`pr-merged{pr}`) into median time-to-merge, the two stage splits, and a 7-day
funnel.

**Run lineage and evaluation**: `cron-runs.ts` normalizes agent, cron,
background, and terminal-session runs into one `UnifiedRun` shape. Agent runs may
carry `trace` metadata (`ticketSlug`, `ticketRef`, `prIid`, source branch) and
an `evaluation` summary. The Runs tab renders both ahead of the raw log; the
Tickets tab uses the same run id to embed the linked log and evaluation.

## Loop engine (headless / paired / single)

A goal-convergence loop that lets the model drive: a **planner** drafts a
gradable contract, a **generator** implements against it (and may not grade
itself), and an **evaluator** adversarially scores pass/fail with evidence,
cycling `negotiate → generate → evaluate → decide` until the contract is met or
`maxIterations` is hit. It runs in its own git worktree/branch (`loop/<id>`).
`src/main/loops.ts` is the engine.

**Store:** an index at `~/.config/TerMinal/loops.json` (capped) plus per-loop
state under `<repoRoot>/.TerMinal/loops/<id>/` — `contract.md`,
`feature_list.json`, `progress.md`, `log.md`, and an append-only `events.jsonl`.
`readLoopState(id)` derives a bounded read-model (phase, iteration, last score,
assertion tallies, log tail) for the cockpit widget.

**Three modes over the same loop state** (`LoopMode = 'headless' | 'paired' | 'single'`):

- **Headless** — the engine spawns one agent turn per phase itself.
  `stepLoop(id)` builds the per-role command (`buildTurnCommand`) and spawns the
  chosen engine detached (generator runs in the worktree, other roles in the
  repo root; `--model` threaded when set), writing to `turns/<iter>-<role>.log`.
  A 5 s `startLoopWatcher()` interval tails the active turn's log and, on the
  agent's final `LOOP-DONE:` line, advances the phase (`advanceAfterTurn`).
  `decide` is deterministic — no agent turn — checking all-assertions-pass and a
  taste plateau.

- **Paired** — the mode the **Paired loop** picker launches. The engine only
  creates the loop record + worktree; the two roles are **live interactive
  sessions** the user watches side by side: a **driver** (`/loop-driver` skill,
  planner+evaluator, in the main repo) and a **worker** (`/loop-implementer`
  skill, generator, in the worktree). `stepLoop` refuses paired loops — they are
  advanced entirely by the two sessions plus the relay below. The renderer
  (`App.tsx` `startPairedLoop`) calls `loops.create({ mode: 'paired', … })`, then
  opens two sessions in a `split` grid tied together by a shared `loopId` +
  distinct `loopRole`. Each session's seed carries **only runtime params** — the
  skill invocation, loop id, worktree, state dir, and goal — because all role
  behavior lives in the slash-command skills, not the seed.

- **Single** — the mode the loop launcher's **Single** topology starts. ONE live
  generator session (in the worktree, `App.tsx` `startSingleLoop`, `loopRole:
  'worker'`) keeps warm context; TerMinal spawns a **fresh** evaluator after each
  of its turns. `stepLoop` refuses single loops — they are driven by the live
  session plus the listener's `singleTick`, which watches the generator's
  `events.jsonl` line (Claude turn-complete as a fallback), calls
  `singleEnterEvaluate` (spawns the ephemeral grader via the shared
  `spawnRoleTurn`), then on the grader's `LOOP-DONE` runs `singleDecide` and
  delivers the next generate prompt back into the same session. The
  generator/evaluator invariant survives (grader is always a fresh context); the
  softer planner/generator split is merged (the live session drafts the contract
  on turn one). **Termination is guaranteed:** a generate prompt is delivered
  only when `decide()` continues, and the stop rule — the pure `decideOutcome`
  in `loop-decide.ts` — returns `done` the moment `iteration >= maxIterations`,
  so deliveries can never exceed the cap.

**Always-on listener** (`src/main/loop-listener.ts`) is the code-driven channel
between a paired loop's two sessions (and the generator↔grader driver for single
loops). Because it lives in the persistent Electron
main process — not in an agent's prompt — it never needs re-arming: a 1.5 s
timer (`startLoopListener`) tails each loop's `events.jsonl` (the
provider-neutral base channel any engine can append to), and when one role emits
a handoff event it writes a single bounded line into the **peer** session's PTY
and submits it. This is deliberately unlike the earlier prompt/plugin-driven
relay and the CLI notify bridge, which depend on the model choosing to "keep
listening." Sessions register via `registerLoopSession(key, loopId, role)` on
start (from `StartOpts.loopId`/`loopRole`) and unregister on stop; registration
seeds the read offset at the current EOF, so prior events don't replay and a
single-mode generator turn that lands before the first tick isn't missed.
Claude-only fallbacks forward a completed turn when the agent didn't append an
`events.jsonl` handoff — `noteLoopTurnComplete` to the peer (paired),
`noteSingleLoopTurn` to kick the auto-grader (single).

**Entry points:** `loops:create|list|get|state|step|restart|stop` IPC (local
only); `startLoopWatcher()` + `startLoopListener()` boot at app startup.

## Engines & models

Four engines, in one `Engine` union (`src/renderer/src/lib/types.ts`,
mirrored in `src/main/agents.ts` + `settings.ts`):

- **claude / codex / cursor** — interactive sessions *and* agent runs. The
  launcher (`EnginePicker` for agents, `EntryScreen` for sessions) picks the
  model in a dedicated **model step/screen** (`ModelSelect`, catalog in
  `lib/engines.ts` `ENGINE_MODELS`). The chosen model threads through
  `Choice.model` → `StartOpts.model` → `startSession` (`--model` on the
  interactive PTY) and through `RunSpec.model` → `buildCmd` for standalone
  `-p`/`exec` runs.
- **openrouter** — agent/schedule runs only (not interactive: it's a one-shot
  harness). Runs via the bundled **`or-agent`** (Codex driven by an OpenRouter
  model: `codex exec -c model_provider=openrouter -m <slug>`). The model field
  is free-text (any OpenRouter slug) plus a curated menu. Disabled (shown, not
  selectable) in the session launcher.

**OpenRouter key.** `settings.openrouterApiKey` is sealed via `safeStorage`
(same as the Telegram token) and injected as `OPENROUTER_API_KEY` into the
agent spawn env; falls back to the shell's env var when unset
(`resolvedOpenRouterKey`).

**Bundled tier (self-contained).** `or-exec`/`or-agent`/`or-spend` +
`model-routing/{lib.ts,models.json}` are vendored in `bin/`, packaged as
`extraResources`, and installed to `~/.config/TerMinal/{bin,model-routing}` on
launch (`installOrTier`) — so a fresh install runs OpenRouter agents with no
global `~/.claude` dotfiles. `lib.ts` prefers a global `~/.claude/model-routing`
registry when present (unified spend) else TerMinal's own seeded copy. A blunt
non-interactive **autonomy preamble** is prepended to OpenRouter prompts so
weaker models don't stop to ask "shall I proceed?".

**Cost.** or-agent reports per-run cost; it's parsed on finalize into
`AgentRun.costUsd` and shown in the Runs tab (row + detail). OpenRouter runs are
excluded from the claude/codex AI-usage ledger (they'd be mis-priced).

## Product hierarchy

Tabs are still auto-discovered, but default visibility is curated in
`src/renderer/src/lib/tabVisibility.ts`. Primary factory surfaces stay visible:
Tickets, MRs/PRs, Agents, Runs, Schedules, CI, Browser, Observability, and
Files. Secondary surfaces — Activity, Docs, Help, Notes/Knowledge
Base, Reports, Sessions, and Agent Config — are hidden by default and can be
restored from Settings → Tabs. This keeps the default cockpit focused while
preserving the extensible "folder = tab" model.

**Telegram** (`telegram*.ts`): native Bot API (token + a single authorized
chat-id as the auth boundary) for notifications and inbound AFK commands, with
the legacy `~/.claude/bin/telegram-*.sh` scripts as a fallback. Outbound
notifications are one `NotifyChannel` of the alert fan-out
(`notify-channels.ts`, [`docs/alert-channels.md`](./alert-channels.md));
inbound control remains Telegram-only.

## Styling

Dark theme, tokens in `src/renderer/src/index.css` (`--gt-*`). Type is **IBM
Plex Sans** (chrome) + **IBM Plex Mono** (numerics/code/editor) via `@fontsource`
+ Tailwind `@theme`. Icons are **lucide-react**. The CodeMirror editor uses the
oneDark *highlight* style over a custom dark surface.

### CodeMirror single-instance constraint

CodeMirror breaks silently if any core package resolves to more than one copy
(the editor and the language parsers get different `state`/`view`/facet
instances → no highlighting). `package.json` `overrides` pin
`@codemirror/state` + `@codemirror/view` to single versions, and
`electron.vite.config.ts` `resolve.dedupe` covers the whole core
(`state`, `view`, `language`, `@lezer/common`, `@lezer/highlight`). Keep both in
sync if you touch CodeMirror deps.

## Packaging

`bun run dist` = `electron-vite build` → `electron-builder --mac` (config in
`electron-builder.yml`). Produces an unsigned `.app` + `.dmg`; `node-pty` is
`asarUnpack`'d (native `.node` can't live in the asar). arm64 needs a deep
ad-hoc re-sign to launch cleanly — see `runbooks/build-and-release.md`.
