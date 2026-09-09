# Ideas & backlog

> **Maintainer scratch-notes, not a roadmap.** Nothing here is planned,
> promised, or prioritized, and entries go stale without being swept. Don't read
> it as a commitment or as documentation of how something works — the live
> backlog is the Tickets tab, and the authoritative docs are the rest of `docs/`.

Running notes for TerMinal — deferred prompts, known gaps, and creative
ideas. Vibe-coded; this is the "what's next / what we punted" list.

## Deferred / partially-done prompts

- **`/usage` rate-limit — DONE.** Sessions we launch now get a `statusLine` shim
  (via `--settings`) that tees Claude Code's `rate_limits` + `context_window`
  JSON to `~/.config/TerMinal/statusline/<sid>.json`. `readUsage()` reads that
  cache first (zero API calls, never throttled) and falls back to the API only
  before the first response of a session. The authoritative
  `context_window.context_window_size` also overrides the model-table guess in
  the Context widget (fixes 200k-vs-1M). See `src/main/statusline.ts`. The shim
  delegates to the user's own statusline so their in-terminal display is kept.
- **CodeMirror lazy language loading — DONE.** `src/renderer/src/lib/lazyLang.ts`
  defers the language bundle until an editor tab needs it.

## Files tab — toward "never open Cursor again"

- **Multi-file editor tabs — DONE.** Open several files; Cmd+W closes the active tab.
- **In-editor file actions — DONE (TER-24).** New file / folder, rename and confirmed
  recursive delete from the tree; open descendants follow folder operations.
- **Diagnostics**: surface tsc/eslint inline (LSP is a big lift; start with a
  "run check" command widget).
- **Format on save — DONE (TER-16).** Settings → Apps enables Prettier on ⌘S
  (default off). Uses repo Prettier/config or the bundled fallback; autosave stays raw.
- **Go-to-definition / symbol search** (CM has basic; full LSP later).
- **Replace across project — DONE.** Files search supports replacement previews,
  exclusions, and project-wide apply.
- **Git gutter — DONE (TER-20).** Files breadcrumb toggle, default on, persisted
  locally. Local saved text files up to 500 KB show additions/replacements/deletions
  vs HEAD; 350 ms debounce and five-second focused-window refresh, active editor only.
  Hidden while unsaved or when disk content differs from the buffer; no remote calls.

## MR / tickets

- **Inline ticket status edit — MVP DONE (TER-26).** Provider-backed status changes
  for local markdown and Linear, with saving/error feedback; local priority remains editable.
- **Create MR from a ticket**.
- **Comment on MR threads** from the Findings view (glab supports notes).
- **Diff layouts — DONE (TER-14/15).** Unified, split and structural choices
  persist under `gt.diffViewMode`, with invalid/unavailable storage falling back safely.
- **Mark all viewed + viewed count — DONE.** Per-file checkboxes and Mark all / Clear
  remain available. **Visual progress bar — DONE (TER-22)** in the file-tree header.

## Cockpit / plugins

- **Git ahead/behind widget — DONE.** Includes upstream and dirty-file status.
- **Open PR/MR count widget — MVP DONE (TER-21).** Optional cockpit plugin,
  default off; existing forge API, one-minute refresh, click opens the MRs tab.
  Counts the latest 100 items; a full page explicitly shows an "at least" count.
- **CI status widget — MVP DONE (TER-25).** Optional, default off; latest GitHub Actions
  or GitLab pipeline run via existing CI API, one-minute refresh, deep-link to the run.
- **More widgets**: failing-test count, disk/AICost-per-day.
- **Usage/context soft-cap — DONE (TER-17).** Each widget exposes an optional
  warning percentage and Clear; disabled by default, never blocks work.
- **Other per-widget settings** (e.g. burn-rate window) remain an idea.
- **Widget reordering — DONE.** Cockpit ordering is user-configurable.

## Notes

- **Per-folder notes within a repo** (notes attached to the open file/dir, not
  just the repo root).
- **Slash-commands / templates** in notes (e.g. insert a checklist).
- **Backlink** notes ↔ tickets (mention #id → link to the ticket tab).

## Bigger swings

- **Command palette (⌘K) — DONE.** `CommandPalette.tsx`: fuzzy list over the
  current session's tabs, other open sessions, tickets, MRs/PRs, and content
  search hits. Each row dispatches the existing `navigateTo()`/`activate()`.
  Receiving tabs honor a nav payload to pre-select (tickets→slug, mrs→iid,
  files→path/line). **Tracked-filename fuzzy-find is done (TER-13):** default
  mode uses `git ls-files`; `#` keeps content search separate.
- **Session timeline — MVP DONE (TER-18).** Optional Session Timeline cockpit
  widget (default off) reads local Claude/Codex transcripts. Pick or scrub a
  turn to show its prompt/response context; Follow latest returns to live turns.
  Latest 500 turns, 6,000-character previews, 32 MB transcript limit; no resume changes.
- **Multi-session split view** (two cockpits side by side).
- **Publish the tab/plugin standard**: docs + a `create-gt-plugin` scaffold so
  others can contribute widgets/tabs.
