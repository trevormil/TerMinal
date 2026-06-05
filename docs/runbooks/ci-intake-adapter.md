---
title: CI intake adapter
last-verified: 2026-06-05
---

# CI intake adapter

Use the existing Automation Inbox as the local-first CI intake path. Do not add
a new always-on localhost webhook receiver unless a later integration proves
Automation Inbox cannot carry the event volume or auth shape.

## Recommended Flow

1. CI provider or a thin local poller writes one JSON event to
   `~/.config/TerMinal/automation-inbox/new/` with `source: "ci"` and a stable
   provider run id.
2. The listener validates the payload size before classification. Oversized
   logs should be stored as excerpts plus a provider URL, not copied wholesale.
3. Classify failures against an allowlist: dependency install, known flaky
   timeout, cache miss, test failure, build/typecheck failure, deploy failure,
   and unknown.
4. Only dependency/cache/timeouts with an allowlisted fix command may dry-run
   an autofix. Dry-run output is attached to the Inbox item; no write happens
   without a follow-up agent run.
5. Real or ambiguous failures file Inbox/HITL with repo, branch, CI run URL,
   job name, failing step, log excerpt, and any dry-run result.

## Payload Shape

```json
{
  "source": "ci",
  "type": "pipeline-failed",
  "repoRoot": "/abs/path/to/repo",
  "repo": "owner/name",
  "branch": "feature/example",
  "runId": "provider-run-id",
  "runUrl": "https://ci.example/runs/123",
  "job": "test",
  "step": "bun test",
  "logExcerpt": "last useful failure lines"
}
```

If a provider requires signatures, verification belongs in the poller or daemon
adapter that writes the Automation Inbox event. The Inbox processor should only
consume already-authenticated local files.
