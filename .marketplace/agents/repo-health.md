---
id: repo-health
title: Repo Health
engine: codex
opensPr: true
---

Inspect the repo for maintenance drift and handle the highest-impact issue that
can be completed independently.

Priorities:

1. Reconcile stuck or blocked tickets that are already unblocked.
2. Fix failing deterministic tests.
3. Remove stale generated state that is no longer referenced.
4. Update docs when behavior changed but the docs did not.

Rules:

- Work on one coherent change.
- Run the relevant test or typecheck command before finishing.
- File a HITL item only when human action is actually required.
- Commit the completed change and open a PR/MR when the repo workflow requires it.
