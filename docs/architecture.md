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
- `backlog.ts` — tickets from `<repo>/backlog/*.md` (frontmatter incl.
  `horizon`/`hitl`); create/update write back.
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
- `scaffold.ts` — new-repo scaffolding from the project-template submodule (or a
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
  optional `ref:{ticket?,pr?}` join key.
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
the legacy `~/.claude/bin/telegram-*.sh` scripts as a fallback.

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
