---
id: 18
title: "Salvage local structural (difft) diff onto the existing WorkingDiffView"
status: open
priority: medium
horizon: next
hitl: false
type: feature
source: code-review
created: 2026-07-09
updated: 2026-07-09
prs: []
refs:
  - "PR #5 (closed): feature/local-changes-diff-view — parallel stack, not landed"
depends_on: []
acceptance:
  - "Structural (difft) mode works for LOCAL changes in the existing Files-tab Changes pane (WorkingDiffView), not a new parallel tab"
  - "src/main/structural.ts (the difft-on-in-memory-content primitive from PR #5) is reused by both the MR path (mrs.ts) and the local path"
  - "WorkingDiffView passes allowStructural={true} with a local fetchStructural callback; the MR Diff path is unchanged"
  - "No duplicate 'Changes' surface and no second local-diff backend (local-diff.ts / local:* IPC) are introduced"
  - "Local working diff still includes untracked/new files (match getWorkingDiff's existing behavior — PR #5 regressed this)"
  - "resolveBaseBranch resolves a remote-tracking base (origin/main) when no local main exists, and the UI label reflects the actual base"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

PR #5 added local (pre-PR) structural diffing but as a **parallel stack** — its
own `local-diff.ts` backend, `local:*` IPC, and a new top-level **Changes** tab —
duplicating the working-diff feature `main` already ships (`getWorkingDiff` +
`WorkingDiffView` wired into the Files tab). It also regressed untracked-file
handling. PR #5 was **closed** rather than merged.

The genuinely valuable piece is `src/main/structural.ts`: a difft primitive that
operates on **in-memory content** (base ref + working tree), which is exactly
what `main` punted on when it shipped `WorkingDiffView` with
`allowStructural={false}` ("difft is wired to the forge API, which a local diff
lacks"). This ticket salvages that primitive.

## Approach

1. Land `src/main/structural.ts` as the shared leaf (`structuralDiffFromContent`
   + `looksBinary`), imported by both `mrs.ts` (MR path) and a small local path.
2. Flip `WorkingDiffView`'s `allowStructural` to `true` and feed it a local
   `fetchStructural(path, cols)` backed by `structural.ts` over local git blobs.
3. Do NOT reintroduce the separate `local-diff.ts` backend, `local:*` IPC, or the
   new Changes tab. Extend the existing surface only.
4. Preserve untracked-file inclusion and fix the base-branch resolution.

Reference the closed PR #5 diff for the reusable `structural.ts` +
`localStructuralDiff` code; discard the parallel-stack + tab.
