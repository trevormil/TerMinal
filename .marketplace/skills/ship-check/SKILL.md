# Ship Check

Use this skill when a change is believed to be complete and needs a final,
practical readiness pass before handoff, commit, or PR.

## Workflow

1. Read `git status --short` and identify the changed files.
2. Run the relevant verification command for the change. Prefer the repo's
   documented command, then `bun test` / `bun run typecheck` when applicable.
3. Check whether docs, snippets, agents, settings, or schemas drifted from the
   implementation.
4. Confirm no unrelated files were changed.
5. Report: summary, verification, risks, and exact remaining action.

Do not merge to `main` or `master`. If the repo requires PR/MR workflow, stop at
the ready-to-review state.
