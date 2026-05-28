# ◆ Gauntlet Terminal

**Your coding agent, with a cockpit.**

An alt-terminal for [Claude Code](https://claude.com/claude-code). On launch it
shows a **session picker** — resume an existing Claude session or start a new
one. The window then **pins to that one session for its whole life**: it hosts
the real `claude` CLI on the left and a **pluggable copilot sidebar** on the
right — context window %, live token burn, your plan's **5-hour + weekly usage**
(a live `/usage` mirror), what the agent is doing _right now_, and your latest
TDD/review scores (with a stale flag). Every number describes _that session_,
never an aggregate.

Every panel is a plugin you can toggle on/off (or hide inline), and the whole
sidebar collapses. Plugins come in two flavors:

- **Code plugins** — a folder of React under `src/renderer/src/plugins/`.
- **Command widgets** — declarative "run this command every N seconds", defined
  in JSON, including **per-repo** widgets loaded from the repo you attach to.

There is no marketplace to publish to — fork the repo or drop a JSON entry.

> Built for a Gauntlet AI hackathon. macOS-first.

## Tabs

A title-bar tab switcher (Cmd+1…N) puts full-screen surfaces alongside the
terminal. The terminal stays mounted when you switch away, so the session
never drops. Tabs are repo-aware — they show based on the attached session.

- **▸ Terminal** — the `claude` CLI + the cockpit sidebar (above).
- **🎫 Tickets & MRs** — browse/filter/create tickets from the repo's
  `backlog/` (inline status/priority edit writes back to the file). Live MR
  list via `glab`, each MR opening a full review surface: rendered description,
  the harness **review** body, **findings** + **suggestions** tabs, and a
  file-by-file **diff** (syntax-highlighted, unified/split, per-file "viewed").
- **🗒️ Notes** — markdown editor (edit/split/preview). Repo notes live at
  `<repo>/.gauntlet-terminal/notes.md` (auto-gitignored, bound to the repo);
  Global notes span everything. Both autosave + persist.
- **📂 Files** — a lightweight editor: CodeMirror (syntax, find/replace) with
  multi-file tabs, a file tree with new/rename/delete, and project-wide search
  (`git grep`). ⌘S save · ⌘W close · ⌘F find · ⌘⇧F project search.

New tab = a folder under `src/renderer/src/tabs/<id>/index.tsx` default-exporting
`{ id, title, icon, appliesTo(ctx), Component }` — same auto-discovery as plugins.

## Install (macOS)

Requires [bun](https://bun.sh). One line:

```bash
curl -fsSL https://labs.gauntletai.com/trevormiller/gauntlet-terminal/-/raw/main/install.sh | bash
```

Or manually:

```bash
git clone https://labs.gauntletai.com/trevormiller/gauntlet-terminal.git
cd gauntlet-terminal
bun install        # also rebuilds node-pty against Electron's ABI
bun run dev        # launch
```

`bun run dev` opens the **session picker**. Choose a session to resume, or pick
a folder and start a new one — the window attaches to it. New sessions launch
`claude --session-id <uuid>`; resumed ones launch `claude --resume <id>` in the
session's original directory.

## Configure

Environment variables read at launch:

| var                | default  | what it does                                                       |
| ------------------ | -------- | ------------------------------------------------------------------ |
| `GT_CLAUDE_BIN`    | `claude` | the Claude Code binary to launch                                   |
| `GT_CONTEXT_LIMIT` | auto     | context-window cap. Auto = 200k (bumps to 1M past 200k tokens).    |

If you run 1M-context sessions, set the cap explicitly so the gauge is accurate:

```bash
GT_CONTEXT_LIMIT=1000000 bun run dev
```

## Writing a plugin

A plugin is a folder under `src/renderer/src/plugins/<id>/index.tsx` that
default-exports one object. Drop the folder in — it auto-registers (Vite glob),
shows up in the **⧉ Plugins** drawer, and mounts when toggled on.

```tsx
import { Card, Big, Gauge } from '../../components/ui'
import type { Plugin, TranscriptStats } from '../../lib/types'

const plugin: Plugin<TranscriptStats> = {
  id: 'context',
  title: 'Context Window',
  icon: '🧠',
  blurb: "Live % of the model's context window in use.",
  intervalMs: 2000,
  defaultEnabled: true,
  poll: (gt) => gt.transcript(), // read live state
  render: (d) =>
    d?.ok ? (
      <Card icon="🧠" title="Context Window">
        <Big value={`${d.contextPct.toFixed(1)}%`} />
        <Gauge pct={d.contextPct} />
      </Card>
    ) : null,
}
export default plugin
```

`poll` runs on `intervalMs`; `render` draws the card. The `gt` bridge exposes
the data sources (`gt.transcript()`, `gt.usage()`, `gt.harnessTdd()`,
`gt.meta()`). To add a new data source, extend `src/main/` + the preload bridge.

## Command widgets (no code)

Don't want to write React? Declare a widget that runs a shell command on an
interval and renders its output. Two locations:

- **Global** — `~/.config/gauntlet-terminal/widgets.json`
- **Per-repo** — `<repo>/.gauntlet-terminal/widgets.json` (loaded automatically
  when you attach a session inside that repo)

```json
[
  {
    "id": "uncommitted",
    "title": "Uncommitted",
    "icon": "📝",
    "command": "git status --porcelain | wc -l | tr -d ' '",
    "intervalMs": 4000,
    "mode": "big"
  }
]
```

`mode` is `text` (raw stdout), `big` (first line as a number), or `kv`
(`key: value` lines as rows). Commands run in the attached session's directory.

> **Trust:** command widgets run arbitrary shell. Per-repo widgets come from the
> repo you attach to — only attach to repos you trust (same model as running
> their npm scripts).

## How it works

- **Electron** shell. `node-pty` (main process) runs `claude`; **xterm.js**
  (renderer) draws it — the same pattern VS Code's integrated terminal uses.
- The sidebar is **React + Tailwind**. Each widget polls a typed `gt` bridge.
- **Context / burn / now-doing** come from the attached session's transcript
  (`~/.claude/projects/<cwd-hash>/<session-id>.jsonl`), read by session id.
- **Plan usage** mirrors `/usage` via `GET /api/oauth/usage` using the OAuth
  token Claude Code stores in the macOS keychain. Cached ~2 min (the endpoint is
  rate-limited); shows the last good value when throttled.
- **TDD / review** reads the autopilot-harness `prs/.../meta.json` + artifact
  frontmatter, computing `current` vs `⚠ stale`.

## Architecture

```
src/main/index.ts     Electron main: PTY spawn + IPC
src/main/data.ts      transcript + harness readers (pure node fs)
src/preload/index.ts  the `gt` bridge (contextBridge)
src/renderer/src/
  App.tsx             layout, plugin enable/persist
  components/         Terminal (xterm), PluginWidget, PluginDrawer, ui kit
  plugins/<id>/       one folder = one plugin (auto-discovered)
  lib/types.ts        Plugin + gt API types
```

## License

MIT
