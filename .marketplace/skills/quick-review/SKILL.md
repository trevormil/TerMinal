# Quick Review

Use this skill when the user asks for a fast review pass on the current branch,
ticket, or recent change and does not need the full six-axis review artifact.

## Workflow

1. Identify the target diff with `git status --short`, `git branch --show-current`,
   and `git diff --stat`.
2. Run the smallest relevant test command first. Prefer `bun test` when the repo
   does not provide a narrower command.
3. Review the diff for correctness, regressions, missing tests, unsafe shell
   commands, and persistence/state migration issues.
4. Report findings first, ordered by severity, with file references.
5. If there are no findings, say that directly and name the tests that ran.

Do not rewrite code during this skill unless the user explicitly asks you to fix
the findings.
