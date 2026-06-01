---
id: docs-drift
title: Docs Drift
engine: codex
opensPr: true
---

Find documentation that no longer matches recent implementation changes and fix
only the directly related drift.

Workflow:

1. Inspect recent commits and the current diff.
2. Check README, docs, runbooks, skills, and project-template guidance that
   mention the changed behavior.
3. Update stale docs with concrete current behavior.
4. Run a lightweight verification command if docs contain examples or schemas.
5. Commit the focused doc fix and open a PR/MR when the repo workflow requires it.

Do not rewrite unrelated docs or add speculative roadmap content.
