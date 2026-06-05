# Ideas & backlog

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
- **Bundle size (~7.2 MB).** `@uiw/codemirror-extensions-langs` eagerly bundles
  every language grammar. Switch to lazy per-extension language loading
  (`loadLanguage` / dynamic import) or curated individual `@codemirror/lang-*`
  packages to shrink the renderer bundle + speed startup.

## Files tab — toward "never open Cursor again"

- **Multi-file editor tabs** (open several files, Cmd+W to close, tab bar).
- **In-editor file actions**: new file / new folder / rename / delete from the tree.
- **Diagnostics**: surface tsc/eslint inline (LSP is a big lift; start with a
  "run check" command widget).
- **Format on save** (prettier) for known extensions.
- **Go-to-definition / symbol search** (CM has basic; full LSP later).
- **Replace across project** (search has find; add project-wide replace).
- **Git gutter** (changed-line markers in the editor via `git diff`).

## MR / tickets

- **Inline ticket status edit** (change status/priority from the detail pane,
  write back to the file) + **create MR from a ticket**.
- **Comment on MR threads** from the Findings view (glab supports notes).
- **Diff: side-by-side mode** toggle (currently unified) + syntax highlighting in
  the diff (currently plain red/green).
- **"Mark all viewed" / viewed progress bar** in the diff file tree.

## Cockpit / plugins

- **More widgets**: git ahead/behind, failing-test count, CI status (glab
  pipelines), open-MR count for the repo, disk/AICost-per-day.
- **Per-widget settings** (e.g. usage soft-cap, burn-rate window) via a small
  config UI instead of localStorage edits.
- **Widget reordering** (drag to reorder the cockpit).

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
  files→path/line). *Possible next:* filename fuzzy-find (needs a `git ls-files`
  IPC — today files are content-search only).
- **Session timeline**: a scrubber of the attached session's turns (from the
  transcript) with jump-to-context.
- **Multi-session split view** (two cockpits side by side).
- **Publish the tab/plugin standard**: docs + a `create-gt-plugin` scaffold so
  others can contribute widgets/tabs.
