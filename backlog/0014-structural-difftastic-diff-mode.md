---
id: 14
title: "Structural (difftastic) diff mode in MR Diff viewer"
status: in-progress
priority: medium
horizon: now
hitl: false
type: feature
source: manual
created: 2026-07-07
updated: 2026-07-07
prs:
  - https://github.com/trevormil/TerMinal/pull/2
refs: []
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
agent_run_id: ""
agent_run_source: agent
agent_session_id: ""
agent_run_started_at: ""
agent_run_status: ""
---

## Description

TerMinal's MR detail Diff tab (`src/renderer/src/components/MrDetail.tsx`)
currently has "Unified" and "Split" toggle buttons (state `mode` at
`MrDetail.tsx:307`, buttons at `MrDetail.tsx:412-424`), but both render from
the same `parse-diff` line-based hunks with `highlight.js` syntax coloring
(`FileDiff` component, `MrDetail.tsx` ~lines 204-274). "Split" is just a naive
line-pairing side-by-side layout — not real structural/AST-aware diffing like
difftastic (`difft`). No difftastic/tree-sitter dependency exists anywhere in
`package.json`/`bun.lock`. The `DigestView.tsx` Changes tab also reuses
`FileDiff` but hardcodes `mode="unified"` with no toggle at all.

Add a third "Structural" toggle option next to Unified/Split in the MR Diff
tab that shells out to the real `difft` binary and renders its actual
tree-sitter-based structural diff output, per file.

`difft` is already installed on this machine at `/usr/local/bin/difft`,
confirming feasibility — but the app must do runtime detection since other
environments won't have it.

## Acceptance criteria

- A third "Structural" button appears in the Diff tab toolbar next to
  "Unified"/"Split" (`MrDetail.tsx` ~412-424).
- If `difft` is not found on `PATH` (checked via `which difft`, cached), the
  button is disabled with a tooltip: "Install with `brew install difftastic`"
  — same UX pattern as missing `gh`/`glab`.
- Selecting "Structural" for a given file in the tree fetches full old/new
  blob content via the forge API (not local git, since PR commits may not be
  fetched locally) and renders `difft`'s real ANSI output for that file,
  reusing the app's existing `xterm.js` dependency for rendering (no custom
  ANSI-to-HTML converter).
- Switching the selected file while in Structural mode re-runs the diff for
  the newly selected file.
- Results are cached in-memory keyed by `(iid, path, headSha)` so re-toggling
  tabs/files doesn't re-shell out unnecessarily.
- New files, deleted files (one side empty), and renamed files are handled
  correctly (verify against `difft`'s native behavior).
- Binary files fall back to the existing unified/split error/placeholder
  instead of attempting a structural diff.
- A forge API content-fetch failure (rate limit, private-repo auth) disables
  or errors only that file's Structural toggle — it does not block the rest
  of the Diff tab.

## Design notes

Proposed approach:

1. **Binary detection**: check `which difft` in the main process at startup
   or first use, cache the result.

2. **Old/new file content source**: difftastic needs full file contents on
   both sides, not a unified-diff patch. Use the forge API (consistent with
   the existing "shell out to `gh`/`glab` as source of truth" pattern in
   `src/main/forge.ts`), not local git history:
   - GitHub: `gh api repos/{owner}/{repo}/contents/{path}?ref={sha}`
     (base64-decoded)
   - GitLab: `glab api projects/:id/repository/files/{path}?ref={sha}`
   - Requires adding `baseRefOid` to `GH_VIEW_FIELDS` in
     `src/main/forge.ts:166` (currently only has `baseRefName`, a branch
     name, not a SHA) and the GitLab equivalent (`diff_refs.base_sha` from
     `glab mr view -F json`).

3. **Running difft**: write old/new blob content to temp files, invoke
   `difft --color=always --display=side-by-side <old> <new>` per file,
   capture ANSI output. Add an IPC handler (main + preload), e.g.
   `window.gt.getStructuralDiff(iid, filePath)`.

4. **Rendering**: render captured difft ANSI output in a read-only
   `xterm.js` instance embedded in the Diff tab rather than writing a custom
   ANSI-to-HTML converter — correct alignment/coloring for free, matches
   real terminal output.

5. **UI**: third button "Structural" next to "Unified"/"Split"
   (`MrDetail.tsx` ~412-424). Since difft operates per-file (unlike today's
   whole-diff unified/split), selecting it while a file is open triggers the
   IPC call for that file.

Non-goals (explicitly out of scope for this ticket):

- Bundling the `difft` binary in the Electron build (multi-arch
  packaging/signing not worth it for this personal tool) — require it on
  `PATH`, same as `gh`/`glab`.
- Wiring this into `DigestView.tsx`'s Changes tab — that's a static
  generated artifact, not an interactive per-file view; follow-up ticket if
  wanted.
- Persisting structural-diff output into the `.reviews/` review artifact —
  viewer convenience only.

Rough effort estimate: ~2-3 days (IPC handler + forge field additions
~0.5-1 day; renderer toggle + xterm embed ~0.5-1 day; edge cases + tests
~0.5-1 day).

Key files: `src/renderer/src/components/MrDetail.tsx`, `src/main/forge.ts`,
`src/main/mrs.ts`, `src/preload/index.ts`,
`src/renderer/src/lib/types.ts` (Gt API surface).
