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
