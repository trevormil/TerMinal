# TerMinal — setup

TerMinal is self-configuring: it works on first launch with sensible
defaults and **detects** what's installed on your machine. Nothing here is
required to start — missing tools just disable the features that need them, with
a clear hint in Settings. Everything below is also reachable from the in-app
**Settings** panel (gear icon, top-right) and the first-run **Onboarding**.

> Tip: you already have a Claude instance — use it. Settings → **Setup &
> integrations → Copy global-skills setup prompt** copies a prompt you can paste
> into Claude to have it walk you through the rest (CLI auth, global skills,
> Telegram). The fastest path is to let Claude do it.

## 0. System prerequisites

TerMinal is macOS-first. Before first launch, install:

- **Bun** for local development/builds: `curl -fsSL https://bun.sh/install | bash`
- **Xcode Command Line Tools** for `git`, `codesign`, and native rebuilds:
  `xcode-select --install`
- **Homebrew** if you want the easiest path for optional CLIs (`gh`, `glab`,
  engine CLIs, etc.)

Finder/Dock-launched apps get a smaller `PATH` than your shell. TerMinal
re-resolves your login shell's `PATH` at startup, but Settings → Engines also
lets you pin explicit binary paths when a CLI lives somewhere unusual.

## Verifying a download

TerMinal ships as an **unsigned, un-notarized** `.dmg`, so macOS Gatekeeper will
ask you to right-click → **Open** the first time. Because it's unsigned, verify
the download's integrity before you do. Each release emits a `SHA256SUMS.txt`
next to the `.dmg` (produced by `bin/release`):

```bash
# from the folder holding the .dmg and SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt        # expect: TerMinal-<ver>-arm64.dmg: OK
```

If the check fails, do **not** open the app — re-download from the official
source. (Code-signing + notarization with an Apple Developer ID is tracked as a
follow-up; until then, checksums are the integrity signal.)

## Keeping the app current

The installed app is a snapshot, so it can lag `main`. **Settings** shows the
build stamp (commit sha + build time) top-right, and when the app detects it is
behind, **Settings → Updates → Update now** does the whole pull → rebuild →
reinstall → relaunch with no terminal. That path rebuilds from a local source
checkout, so it only applies if you have one — otherwise grab the next release.
See [ADR-0016](decisions/0016-one-click-rebuild-not-an-autoupdater.md).

## 1. Engines (required: one of)

Agents and sessions run through an engine CLI:

- **`claude`** — Claude Code sessions and one of the two agent engines.
- **`codex`** — Codex sessions and one of the two agent engines.

Install at least one. The app finds them on your `PATH`; if yours lives
somewhere unusual, set an explicit path in **Settings → Engines**. Pick your
default engine there too.

## 2. Code forge (optional: GitHub and/or GitLab)

The PRs/MRs tab, CI status, and the merge button work for **both** forges. The
app picks the right CLI per repo from its `origin` remote:

| Remote host | CLI | Vocabulary |
|-------------|-----|------------|
| `github.com` | `gh` | "PR", `#123` |
| anything else (GitLab) | `glab` | "MR", `!123` |

Install + authenticate whichever you use:

```sh
brew install gh    # then: gh auth login
brew install glab  # then: glab auth login
```

**Settings → Code forge** shows install + auth state per CLI, and lets you force
`github`/`gitlab` instead of auto-detect.

## 3. Global agent skills (recommended)

Agents the app spins out are plain `claude -p` / `codex exec` processes, so they
**inherit your global config** — `~/.claude/CLAUDE.md`, `~/.codex/`, and any
skills you've installed. A richer global setup → better agent runs. The
project-template workflow uses skills like `code-review`, `iterate`,
`test-suite`, `document`, `pr-creation`, `stacked-mr`, and `notify`.

Two ways to set them up:

- **Let Claude do it (recommended):** Settings → **Copy global-skills setup
  prompt**, paste into a Claude session. It checks what you have and installs the
  rest from your template repo into `~/.claude/skills` (and `~/.codex/skills`).
- **Manual:** clone your template repo (default: the TerMinal repo itself,
  which embeds the template at `templates/project-template`; configurable in
  **Settings → Projects & worktrees**) and follow its setup docs to symlink its
  skills into `~/.claude/skills` / `~/.codex/skills`.

The app works without these — they enhance the agent/PR workflow, they don't
gate sessions.

Codex note: Codex skills are available to the model, but current Codex CLI builds
do not list custom skills in the native `/` command menu. Use `$ticket` /
`$code-review` directly in Codex. TerMinal's embedded Codex input also accepts
the mirrored `/ticket` spelling and rewrites it before submit.

## 4. Telegram (optional — notifications + AFK control)

Native Bot API, no scripts required:

1. Message **@BotFather** on Telegram → `/newbot` → copy the token.
2. Find your numeric **chat id** (e.g. message **@userinfobot**).
3. **Settings → Telegram**: paste the token + chat id, hit **Test** (you should
   get a message), then toggle **Mirror notifications** and/or **Remote
   control** (launch/cancel agents by texting the bot — that one chat id is the
   auth boundary).

If you leave the token blank but have the legacy `~/.claude/bin/telegram-*.sh`
scripts, the app falls back to those.

> Common mistake: pasting the **bot's own id** (the digits before `:` in the
> token) into the chat-id field. The app catches this and tells you to use
> *your* chat id instead — message @userinfobot to get it.

## 5. Activity feed hook (`gt-notify`)

Anything can surface in the **Activity** tab + notifications by appending one
JSON line to `~/.config/TerMinal/activity.jsonl`:

```json
{"id":"...","ts":1700000000000,"kind":"task-complete","title":"...","detail":"...","repo":"...","repoRoot":"...","sessionId":"..."}
```

`kind` is one of `deploy | task-complete | ticket-filed | pr-verdict | session-start |
agent-run | error | info`. The portable helper does the escaping for you:

```sh
gt-notify task-complete "Build passed" --detail "all green" --repo owner/proj
```

Install it from **Settings → Setup & integrations → Install gt-notify** (writes
to `~/.local/bin`), or run `bin/gt-notify` from this repo directly. Skills, CI
steps, and git hooks can call it to push events into the cockpit.

## 6. Tickets (optional — pick where a repo's backlog lives)

Each repo picks its own ticket provider in **Settings → Tickets**. Nothing here
is required: the default is a local backlog in the repo, which needs no account
and no network.

| Provider | Where tickets live | Notes |
|---|---|---|
| `local` (default) | `.TerMinal/backlog/*.md` in the repo | full read/write, works offline |
| `github` | GitHub Issues | needs `gh` (see §2); labels map to status/priority/type |
| `linear` | Linear, via its MCP | needs the Linear MCP configured |
| `obsidian` | a per-repo Obsidian vault | markdown tickets in a `tickets/` subfolder |
| `webview` | entirely in some other board's web UI | read-only embed; the app writes nothing |

Pick `webview` when a repo's tickets live somewhere TerMinal shouldn't touch — a
team board that doesn't follow the ticket schema. It embeds the board as the
Tickets tab and **refuses** ticket writes rather than silently filing them into a
local backlog nobody reads
([ADR-0015](decisions/0015-webview-ticket-provider.md)). If you want that board
*alongside* a working local backlog instead, add it under `views[]` and leave the
provider alone.

## Getting around

No setup needed for either of these, but they are the two things people miss:

- **`⌘/` opens the keyboard-shortcuts overlay** — the fastest way to learn the
  tab switches and session bindings.
- **The Runs tab is the single history of every agent run**, scheduled (launchd,
  via `bin/terminal-cron`) and in-app alike, so you don't have to guess which
  surface a run came from.

## Where settings live

`~/.config/TerMinal/settings.json` — created/migrated automatically.
Re-run the first-time walkthrough anytime via **Settings → Re-run first-time
setup**.

Important paths to check on a fresh machine:

- `projectsDir` — where the entry screen scans for repos. Blank means your home
  directory.
- `worktreesDir` — where background agents create git worktrees. Blank means
  `<projectsDir>/.worktrees`.
- `templateRepo` — project-template source. A URL is fine for new-project
  scaffolding; use a local path if you want the in-app "bootstrap this existing
  repo" helper or Telegram `/install <agent>` to copy from your checkout.
- `harnessDir` — optional legacy cross-repo artifact store. Leave blank unless
  you have one; in-repo `.reviews/` from project-template is the primary path.
