# Ideas & backlog

Running notes for Gauntlet Terminal — deferred prompts, known gaps, and creative
ideas. Vibe-coded; this is the "what's next / what we punted" list.

## Deferred / partially-done prompts

- **`/usage` is rate-limited.** The Plan Usage widget hits `GET /api/oauth/usage`
  with the keychain OAuth token. The endpoint 429s aggressively, so the 5h/weekly
  gauges often show "cached"/empty. **Better fix (attempted next):** capture the
  `rate_limits` + `context_window` JSON that Claude Code pipes to a `statusLine`
  command — set a statusLine shim on the sessions we launch (via `--settings`)
  that tees the JSON to a cache file we read. Zero API calls, never throttled,
  and also gives an *authoritative* per-model context window size (fixes the
  200k-vs-1M guess in the context widget).
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

- **Command palette** (Cmd+K) to jump to any tab / file / ticket / MR / session.
- **Session timeline**: a scrubber of the attached session's turns (from the
  transcript) with jump-to-context.
- **Multi-session split view** (two cockpits side by side).
- **Publish the tab/plugin standard**: docs + a `create-gt-plugin` scaffold so
  others can contribute widgets/tabs.
