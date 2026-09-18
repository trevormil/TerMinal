# Ideas & backlog

> **Maintainer scratch-notes, not a roadmap.** Nothing here is planned,
> promised, or prioritized, and entries go stale without being swept. Don't read
> it as a commitment or as documentation of how something works — the live
> backlog is the Tickets tab, and the authoritative docs are the rest of `docs/`.

Running notes for TerMinal — deferred prompts, known gaps, and creative
ideas. Vibe-coded; this is the "what's next / what we punted" list.

**TER-47 hygiene sweep — DONE (2026-09-18):** shipped markers reconciled through TER-46;
TER-48–50 MVPs are recorded below. `bun audit` reports zero vulnerabilities.
Mermaid remains pinned to 11.16.1. The last successful Dependabot check (TER-43)
identified 11.16.1 as the first patched version for alerts #1–5. Today's
re-check returned HTTP 403 (token cannot read alerts), so their current state
is unverified. `origin/main` still pins 11.16.0; merging remains a human action.
The previously observed registry 12.x does not by itself require a major upgrade;
the clean branch audit supports retaining the existing patch pin and lockfile.

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
- **Diagnostics — MVP DONE (TER-28).** Files → Run check offers local package
  check/typecheck/lint scripts or installed tsc/eslint. Review the command and run
  manually against saved files; bounded output and explicit pass/fail panel.
  Inline diagnostics / LSP remain deferred.
- **Format on save — DONE (TER-16).** Settings → Apps enables Prettier on ⌘S
  (default off). Uses repo Prettier/config or the bundled fallback; autosave stays raw.
- **Go-to-definition / symbol search — MVP DONE (TER-44).** Files offers a
  same-file declaration search over the live editor buffer. Search a name, list
  declarations, or jump from the cursor identifier. Common declaration heuristics
  only. **Cross-file declaration search — MVP DONE (TER-49).** Search tracked files
  locally and choose a hit to open its file/line. Limits: 500 paths, 256 KB/file,
  8 MB total, 100 hits, three-second scan budget after bounded git listing.
  Searching, truncated, skipped, empty and error states are visible. Saved files
  only; same-file navigation continues to use the active buffer. Full semantic
  resolution and LSP remain deferred. No network/server.
- **Current-file outline — MVP DONE (TER-50).** Optional Outline toggle (off
  initially) lists declarations in the active buffer and selects/scrolls to a
  chosen declaration. Uses the same TER-44 heuristics, updates while editing,
  and has an explicit empty state.
- **Replace across project — DONE.** Files search supports replacement previews,
  exclusions, and project-wide apply.
- **Git gutter — DONE (TER-20).** Files breadcrumb toggle, default on, persisted
  locally. Local saved text files up to 500 KB show additions/replacements/deletions
  vs HEAD; 350 ms debounce and five-second focused-window refresh, active editor only.
  Hidden while unsaved or when disk content differs from the buffer; no remote calls.

## MR / tickets

- **Inline ticket status edit — MVP DONE (TER-26).** Provider-backed status changes
  for local markdown and Linear, with saving/error feedback; local priority remains editable.
- **Create PR/MR from a ticket — MVP DONE (TER-37).** Tickets detail opens a
  real GitHub/GitLab create dialog for an already-pushed branch. Current branch
  and ticket-derived names are optional starting points; source, target, title,
  and description remain editable. Local tickets receive the returned URL;
  other providers can copy it manually. Missing/unsupported remotes and SSH
  workspaces explain availability. No automatic branch creation, push, or merge.
- **Comment on PR/MR discussions — MVP DONE (TER-40).** Findings has an explicit
  general-comment box for GitHub and GitLab, using the existing forge CLI/API.
  **GitLab thread browse/reply — MVP DONE (TER-46).** Open review threads lists
  paginated discussions through the configured glab host and offers explicit replies.
  **GitLab resolve/unresolve — MVP DONE (TER-48).** Resolvable discussion threads
  offer explicit Resolve / Unresolve buttons through the configured glab host.
  Failed mutations preserve the open thread and reply draft and show a retryable
  error. GitHub replies remain available; GitHub resolution stays deferred (no
  existing parity mutation). Posting never merges or submits an approval.
  API contract: [GitLab discussions](https://docs.gitlab.com/api/discussions/).
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
- **AI cost per day — MVP DONE (TER-30).** Optional cockpit widget, default off;
  today and seven calendar days of estimates from the local AI ledger, across
  repos. Explicit empty/remote states and a latest-2,000-record coverage notice.
- **Failing-test count — MVP DONE (TER-32).** Optional, default off; recorded counts
  from the latest local review artifact, with unknown and historical labels and a PR link.
- **Repo disk usage — MVP DONE (TER-33).** Optional, default off; allocated local
  disk space including dependencies/hidden files, one-minute refresh and bounded reads.
- **Usage/context soft-cap — DONE (TER-17).** Each widget exposes an optional
  warning percentage and Clear; disabled by default, never blocks work.
- **Usage/context burn-rate window — MVP DONE (TER-41).** Optional per-widget
  5/15/30-minute or 1/4-hour lookback, default off and clearable. Choice persists
  locally; observed percentage-point/hour samples live only while the widget is
  mounted. Usage tracks the five-hour quota; drops reset the baseline (quota
  resets/context compaction), and context session/model changes start fresh.
- **Widget reordering — DONE.** Cockpit ordering is user-configurable.

## Notes

- **Per-folder/file notes — MVP DONE (TER-29).** Notes → Path notes, plus Files
  File notes / Folder notes actions. Exact repo-relative paths use separate local
  sidecar knowledge storage; explicit Save, additive to Repo and Global notes.
  Notes remain at their original path after file renames.
- **Templates — MVP DONE (TER-34).** Append template control for checklist, meeting,
  and decision markdown in Repo/Global items and scratch notes, plus Path notes.
  Existing text is preserved.
- **Custom templates — MVP DONE (TER-36).** Notes → Custom templates saves and
  deletes named markdown snippets in local settings, shared across repos.
  They append alongside built-ins in scratch, markdown items, and path notes.
- **Slash templates — MVP DONE (TER-42).** Type / in scratch, markdown items,
  or path notes to fuzzy-match built-in and custom template names locally.
  Empty query shows all; Enter selects the first match or click a choice.
  Escape/click-away dismisses. Selection removes the slash query and appends
  the body without replacing other note text; the append control remains.
- **Ticket mentions — MVP DONE (TER-38).** Notes lists resolved mentions of
  ticket identifiers (including #TER-37 / TER-37) and exact local ticket slugs
  with optional .md suffix. Buttons navigate to the matching ticket or its
  Linear view. **Reverse ticket → note mentions — MVP DONE (TER-45).** Ticket
  detail scans saved repo/global knowledge items, scratch, and path notes locally;
  hits navigate to the exact note. Unsaved edits are not indexed. Markdown stays
  unchanged; a full graph remains deferred.

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
