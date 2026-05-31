<div align="center">
  <img src="src/renderer/src/assets/logo.png" width="96" height="96" alt="TerMinal" />
  <h1>TerMinal</h1>
  <p><strong>A standalone software factory for coding agents.</strong></p>
</div>

<p align="center">
  <img src="docs/terminal.png" width="900" alt="TerMinal terminal tab with the live cockpit sidebar" />
</p>

**A standalone macOS app that runs your coding agents as a software factory.**
TerMinal hosts the real [Claude Code](https://claude.com/claude-code) CLI (and
[Codex](https://github.com/openai/codex)) — many sessions as top tabs, each in
its own PTY — and wraps them in a continuous, observable build loop: backlog →
branch → PR → review → **you** merge. The human gate to `main` is never crossed
by the app; agents stop at "PR open" and park anything that needs you to a
global inbox. The workflow it drives is
**[project-template](https://github.com/trevormil/project-template)** — a
drop-in scaffold (sessions → tickets → branches → PRs → review → human merge,
with a TDD gate and in-repo `.reviews/`) you can [add to any repo](#project-template).

**Local-first.** No server, no account, no phone-home. Every artifact — the
activity feed, HITL inbox, schedules, run logs, code-review results — lives on
your machine (`~/.config/TerMinal` + in-repo `.reviews/`), renders offline, and
runs on *your* `gh`/`glab`/`claude` auth, never ours.

Every session carries its own **cockpit** — a sidebar of live telemetry for
*that* session: context-window %, token burn, your plan's **5-hour + weekly
usage** (a live `/usage` mirror), what the agent is doing _right now_, its todo
list, and the latest code-review/TDD verdict. Every number describes one
session, never an aggregate.

Around the terminal sit repo-aware **tabs** that are the factory's control
surface — tickets, MRs/PRs, an autonomous **[Factory](#factory)** orchestrator,
**Schedules** (real launchd cron), a global **HITL** inbox, cross-repo
**cycle-time** observability, plus notes and a file editor. The terminal stays
mounted when you switch tabs, so a session never drops.

> Built for a Gauntlet AI hackathon, then kept going. macOS-first. Dark theme,
> [lucide](https://lucide.dev) icons, IBM Plex type.

---

## Screenshots

<table>
  <tr>
    <td><img src="docs/tickets.png" alt="Tickets tab" /></td>
    <td><img src="docs/agents.png" alt="Agents tab" /></td>
  </tr>
  <tr>
    <td><img src="docs/runs.png" alt="Runs tab" /></td>
    <td><img src="docs/schedules.png" alt="Schedules tab" /></td>
  </tr>
</table>

## Quick start

Requires [bun](https://bun.sh) and at least one engine CLI on your `PATH`:
`claude` or `codex`.

> **Platform: macOS (Apple Silicon).** Packaging, scheduling (launchd), and the
> "open in editor/browser" handoffs (`open -a`) assume macOS. The editor and
> browser default to **Cursor** and **Brave** but are configurable in Settings.
> `bun run dev` may run on other platforms, but the OS-specific features won't.

```bash
git clone https://github.com/trevormil/TerMinal.git
cd TerMinal
git submodule update --init   # vendors project-template (for scaffolding)
bun install                   # also rebuilds node-pty against Electron's ABI
bun run dev                   # launch the dev build
```

On **first launch** a short onboarding probes your machine (which of
`claude`/`codex`/`gh`/`glab` are installed + authenticated) and confirms your
projects folder — everything has a working default, so you can skip it. After
that, `bun run dev` opens the **session picker**: resume an existing
Claude/Codex session, start a new one in any folder, or **spin up a brand-new
project from a template** (see below). Sessions launch the real engine CLI in
the selected directory and resume through that engine's native resume path.

The app is **self-configuring** — install either `claude` or `codex` to run
sessions; `gh` and `glab` are optional and enable the forge features that use
them. See
[**Setup & settings**](#setup) for the full picture.

### Install it as a real app

Package a branded, double-clickable macOS app:

```bash
bun run dist        # → dist/TerMinal-<ver>-arm64.dmg  +  dist/mac-arm64/TerMinal.app
```

It's an unsigned local build, so after packaging give it a clean ad-hoc
signature, then drag it to `/Applications` and pin it to the Dock:

```bash
codesign --force --deep --sign - "dist/mac-arm64/TerMinal.app"
cp -R "dist/mac-arm64/TerMinal.app" /Applications/
open "/Applications/TerMinal.app"   # right-click → Open the first time
```

See [`docs/runbooks/build-and-release.md`](docs/runbooks/build-and-release.md).

## Tabs

A title-bar switcher puts full-screen surfaces alongside the terminal. Tabs are
repo-aware — each shows based on the attached session's repo.

- **Terminal** — the `claude` or `codex` CLI with a session-aware cockpit sidebar.
- **Tickets** — browse/filter/create tickets from the repo's `backlog/`,
  **grouped by status** (closed/icebox collapsed by default). Inline
  status/priority edits write back to the markdown file.
- **MRs / PRs** — live merge/pull requests via `glab` (GitLab) or `gh` (GitHub),
  **auto-detected per repo** from the remote (the tab + vocabulary switch between
  "MR !N" and "PR #N"). Each opens a full review surface: description, the
  **review** body, **findings** + **suggestions**, a syntax-highlighted **diff**
  (unified/split, per-file "viewed"), forge **CI status**, and a **merge** button.
- **Agents** — on-demand agents (**Codex** or **Claude**) you **Run** from a
  button. See [Agents](#agents) below.
- **Factory** — toggle the autonomous [`/factory`](#factory) orchestrator on for
  the attached repo, watch its live log, and read cross-repo **factory health**:
  throughput (24h/7d), **cycle time** (ticket-filed → PR-merged, with stage
  splits + a funnel), agent/cron success rates, a 14-day activity sparkline,
  recent failures, and the most active repos.
- **Schedules** — real **macOS launchd cron** for agents: run an agent on an
  interval, at a calendar time, or via a raw cron expression — it fires even
  when TerMinal is closed. One **global** view across every repo with a per-repo
  filter, an **All runs** history (status / log per run), and a reconcile button
  that removes orphaned launchd jobs.
- **Browser** — an in-app webview for quick lookups, plus **Open in Brave**
  (configurable) to hand the URL to a real browser with your wallet extensions.
- **Inbox** — a **global, cross-repo HITL inbox** (`~/.config/TerMinal/hitl.json`) of
  the things waiting on a human: approvals, credentials, decisions, hard
  blockers. Agents file items here (via `.claude/bin/hitl`), each fires a
  Telegram ping, and the top-right Inbox button carries a live red count. Resolve / reopen / remove
  from one place — no need to open each repo.
- **Activity** — a realtime feed + macOS notifications: a session finishing a
  turn, a ticket filed, a session start. Global store, filterable to this
  repo/session.
- **Sessions** — the repo's working-state session docs
  (`sessions/NNNN-slug/session.md`, the [project-template](#project-template)
  convention): status, goal, linked tickets/branches/PRs, rendered body.
- **Notes** — markdown editor (edit/split/preview). Repo notes live at
  `<repo>/.TerMinal/notes.md` (auto-gitignored); Global notes span
  everything. Both autosave.
- **Files** — a lightweight editor: CodeMirror (real syntax highlighting,
  find/replace), multi-file tabs, a file tree with type icons + git-ignored
  dimming, and project-wide search (`git grep`). ⌘S save · ⌘W close · ⌘F find ·
  ⌘⇧F project search. Open the current file/dir in your editor (Cursor by
  default, configurable) from a button.
- **Help** — in-app reference for the tabs, cockpit widgets, and keyboard
  shortcuts.

## Cockpit widgets

The sidebar is a stack of widgets, each describing the attached session. Toggle
them in the **Plugins** drawer (top-right on the Terminal tab). Defaults:
**Session** (title/model/mode/branch/turns), **Context Window**, **Now Doing**
(latest tool call, live), **Plan Usage**, **Todos**, **TDD / Review**, **Git**.
Off by default but available: **Model**, **Tool Use**, **Token Burn Rate**,
**Open PRs**.

Two kinds of widget — both auto-discovered, no marketplace:

- **Code plugins** — a folder under `src/renderer/src/plugins/<id>/index.tsx`.
- **Command widgets** — declarative "run this command every N seconds", in JSON,
  including **per-repo** widgets loaded from the attached repo.

## <a name="agents"></a>Agents

On-demand agents you trigger from a **Run** button on the Agents tab. Each run
gets its **own git worktree** off the default branch; the engine does the work,
files tickets for findings, and opens a **PR/MR** for any code changes — all
streamed live into the tab (with cancel + worktree controls). A launch picker
chooses the **engine** ([Codex](https://github.com/openai/codex) or
[Claude](https://claude.com/claude-code) — only the ones installed are offered),
an optional **persona** (security, performance, frontend, …), and a **pipeline**
(single run, or chained review/iterate stages).

Eight ship **by default on every repo** — Improve docs, Deep audit, Ticket/PR
cleanup, Strengthen tests, Security sweep, Performance pass, Dependency hygiene,
and Dead-code cleanup.

Override or add your own per-repo in `.agents/agents.json` (merged by id over the
defaults):

```json
[{ "id": "perf", "title": "Perf pass", "icon": "Zap",
   "prompt": "/document  …or any codex prompt; commit + open a PR", "opensPr": true }]
```

## <a name="project-template"></a>Spin up new projects (project-template)

TerMinal pairs with
[project-template](https://github.com/trevormil/project-template) — a
self-contained workflow scaffold (sessions → tickets → branches → PRs → review →
human merge, with in-repo `.reviews/`, cadence `.checks/`, TDD gate, and the
ticket/session schemas these tabs read). It's vendored here as a git submodule
at `templates/project-template` and kept in sync with the upstream repo.

**From the session picker** — the "New project from template" card: name it,
pick a parent folder, hit Create. It copies the template into a **brand-new**
directory (never overwrites an existing one), runs `git init` + a first commit,
and opens a session there.

**From the terminal:**

```bash
bin/new-project my-app                  # → <your projects dir>/my-app
bin/new-project my-app /path/to/parent  # custom parent
```

Both refresh the template to the latest upstream before copying. To bump the
pinned submodule:

```bash
git submodule update --remote templates/project-template
```

## <a name="factory"></a>Software factory

The factory surfaces turn the workflow into a continuous, observable loop —
agents do design → ticket → branch → PR → review/CI; the **merge to
`main`/`master` is always human-only** and never bypassed.

- **`/factory`** (a project-template skill) is a continuous orchestrator: it
  reconciles ticket state with merged PRs, runs `/stacked-mr` passes (build a
  stack TDD-first → batch-review to the bar → handle verdicts), and repeats
  until the in-scope backlog is dry. No budget, per-repo, claude or codex. The
  **Factory tab** toggles it on and streams its log.
- **Schedules** registers real **launchd** jobs so agents run on a cadence even
  when TerMinal is closed (a headless runner ships in the app bundle and is
  installed to `~/.config/TerMinal/bin`). A failed (not cancelled) scheduled run
  auto-files a HITL item.
- **Inbox** is the single place agents reach you. Items live in a global
  `~/.config/TerMinal/hitl.json`, get a Telegram ping when filed, and show a red
  badge until resolved — across every repo.
- **Cycle time** is measured by linking a ticket's lifecycle events through join
  keys (`ticket-filed{ticket}` → `pr-opened{ticket,pr}` → `pr-merged{pr}` →
  `ticket-closed{ticket}`): median time-to-merge, the filed→open and open→merge
  stage splits, and a 7-day funnel — all on the Factory tab. Skills emit these
  via `.claude/bin/activity --ticket N --pr N`.

All of it reads from append-only stores under `~/.config/TerMinal/`
(`activity.jsonl`, `cron-runs/`, `hitl.json`), so the views work offline and
anything — a CI job, a shell script — can participate by appending an event.

## <a name="setup"></a>Setup & settings

Most config lives in the in-app **Settings** panel (gear icon, top-right) and is
saved to `~/.config/TerMinal/settings.json`:

- **Projects & worktrees** — where the picker looks for repos; where agent
  worktrees go; the scaffold template repo.
- **Engines** — detected `codex`/`claude` with install/auth state; per-engine
  path overrides; default engine.
- **Code forge** — `auto` (gh for GitHub remotes, glab otherwise) / force
  GitHub / force GitLab, with live install + auth readiness per CLI.
- **Telegram** — native Bot API notifications + AFK remote control (paste a
  BotFather token + chat id, hit **Test**). Falls back to legacy
  `~/.claude/bin/telegram-*.sh` scripts if no token is set.
- **Setup & integrations** — install the [`gt-notify`](docs/setup.md#5-activity-feed-hook-gt-notify)
  activity hook, and **copy a setup prompt for Claude** to install the global
  agent skills on a fresh machine.

Full walkthrough (GitHub vs GitLab, global skills, Telegram, the activity-feed
contract): [**`docs/setup.md`**](docs/setup.md).

### Environment overrides

| var                | default  | what it does                                                    |
| ------------------ | -------- | --------------------------------------------------------------- |
| `GT_CLAUDE_BIN`    | `claude` | the Claude binary to launch (Settings → Engines also sets this) |
| `GT_CONTEXT_LIMIT` | auto     | context-window cap. Auto = 200k (bumps to 1M past 200k tokens). |

```bash
GT_CONTEXT_LIMIT=1000000 bun run dev   # if you run 1M-context sessions
```

## Writing a plugin

A plugin is a folder under `src/renderer/src/plugins/<id>/index.tsx` that
default-exports one object. Drop it in — it auto-registers (Vite glob), appears
in the Plugins drawer, and mounts when toggled on.

```tsx
import { Brain } from 'lucide-react'
import { Card, Big, Gauge } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const plugin: Plugin<TranscriptStats> = {
  id: 'context',
  title: 'Context Window',
  icon: Brain, // a lucide-react icon component
  blurb: "Live % of the model's context window in use.",
  intervalMs: 2000,
  defaultEnabled: true,
  realtime: true, // also refresh the instant the transcript changes
  poll: (gt) => gt.transcript(), // read live state via the typed bridge
  render: (d) =>
    d?.ok ? (
      <Card icon={Brain} title="Context Window">
        <Big value={`${d.contextPct.toFixed(1)}%`} />
        <Gauge pct={d.contextPct} />
      </Card>
    ) : null,
}
export default plugin
```

`poll` runs on `intervalMs` (and on every transcript tick if `realtime`);
`render` draws the card. The `gt` bridge exposes the data sources
(`gt.transcript()`, `gt.usage()`, `gt.harnessTdd()`, `gt.gitStatus()`,
`gt.sessionTasks()`, …). New data source = extend `src/main/` + the preload
bridge.

## Writing a tab

Same model — a folder under `src/renderer/src/tabs/<id>/index.tsx`
default-exporting `{ id, title, icon, order, appliesTo(ctx), Component }`.
`appliesTo(ctx)` gates visibility on the attached repo; an optional
`badge(gt)` paints a live count on the tab. The global Inbox count lives in the
top-right app chrome instead of a repo tab.

## Command widgets (no code)

Declare a widget that runs a shell command on an interval and renders its
output — global (`~/.config/TerMinal/widgets.json`) or per-repo
(`<repo>/.TerMinal/widgets.json`, loaded when you attach there).

```json
[
  {
    "id": "uncommitted",
    "title": "Uncommitted",
    "command": "git status --porcelain | wc -l | tr -d ' '",
    "intervalMs": 4000,
    "mode": "big"
  }
]
```

`mode` is `text` (raw stdout), `big` (first line as a number), or `kv`
(`key: value` lines as rows). Commands run in the attached session's directory.

> **Trust:** command widgets run arbitrary shell, and per-repo widgets come from
> the repo you attach to — only attach to repos you trust (same model as running
> their npm scripts).

## How it works

- **Electron** shell. `node-pty` (main) runs `claude`; **xterm.js** (renderer)
  draws it — the same pattern VS Code's integrated terminal uses. Each session
  tab is its own PTY, keyed in main; data IPC reads the active session.
- The UI is **React + Tailwind v4**, built with **electron-vite**. Widgets and
  tabs poll a typed `gt` bridge exposed via `contextBridge`.
- **Context / burn / now-doing / todos** come from the attached session's
  transcript (`~/.claude/projects/<cwd-hash>/<session-id>.jsonl`) and task files,
  read by session id.
- **Plan usage** mirrors `/usage` via `GET /api/oauth/usage` using the OAuth
  token Claude Code stores in the macOS keychain. Cached ~2 min (rate-limited).
- **PRs / TDD / review** read code-review artifacts from the repo's in-repo
  `.reviews/<pr>/` (project-template) or the legacy autopilot-harness `prs/`
  store, computing `current` vs `stale`.

See [`docs/architecture.md`](docs/architecture.md) for the full map.

## Repo layout

```
src/main/            Electron main: PTY spawn, IPC, fs readers (transcript, backlog, mrs, files, scaffold)
src/preload/         the `gt` bridge (contextBridge)
src/renderer/src/
  App.tsx            multi-session shell (session tab bar)
  SessionView.tsx    one session: terminal + cockpit + tabs
  components/        Terminal (xterm), CodeEditor, MrDetail, TicketsBrowser, ui kit
  plugins/<id>/      one folder = one cockpit widget (auto-discovered)
  tabs/<id>/         one folder = one full-screen tab (auto-discovered)
  lib/               types, badges, file-type icons, formatters
templates/           project-template (git submodule) — scaffolding source
bin/new-project      scaffold a new repo from the template
build/               app icon (.icns/.png) for packaging
```

## Contributing

It's just code — fork it, drop a plugin or tab folder in, send a PR. `bun run
build` type-checks the bundle; `bunx tsc --noEmit` is the full type gate.

## License

[MIT](LICENSE) © Trevor Miller
