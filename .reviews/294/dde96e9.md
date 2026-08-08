---
pr: trevormil/TerMinal#294
commit: dde96e9da70ece9df4aa54c35d4b6be0a64d424f
short_sha: dde96e9
kind: review
generated: 2026-08-08T00:14:16Z
generator: codex:gpt-5
verdict: request-changes
merge_ready: false
risk_tier: medium
summary: "Slack inbox delivery is wired, but MCP resolves leave Slack messages stale."
review_scope: full
review_base_sha: null
test_status: pass
test_runner: bun test
test_command: "bun run test; bun run typecheck"
test_exit_code: 0
test_duration_seconds: 17.07
test_counts:
  passed: 2403
  failed: 0
  skipped: 1
  total: 2404
scores:
  correctness: 82
  security: 88
  architecture: 86
  conformance: 85
  quality: 84
  dependencies: 95
  overall: 82
findings_count: 1
suggestions_count: 0
screenshots_count: 0
avg_confidence: 8.0
---

## Summary

PR 294 adds Slack as an Inbox destination, including settings storage and masking, a Slack test path, category-to-channel routing, app-side HITL mirroring, sidecar support for standalone filers, and targeted unit coverage. The primary filing paths are wired from production entry points and the sidecar is synced after safeStorage registration. I found one medium correctness gap: agent-side MCP resolves update `hitl.json` directly and never stamp the Slack message as resolved.

## Tests

> `bun run test` and `bun run typecheck` passed. Unit suite: 2403/2404 pass, 1 skip, 0 fail across 208 files in 13.03s; typecheck completed with `tsc --noEmit`.

Security scan: `bun audit` reports existing advisories in unchanged dependencies (1 high, 7 moderate, 2 low). This PR does not change `package.json` or the lockfile, so there is no dependency-score deduction for newly introduced packages. Semgrep is not installed; gitleaks was skipped by default per the security-scan skill.

## Scorecard

| Axis | Score | Notes |
|---|---:|---|
| Correctness | 82/100 | Slack filing, recurrence, app resolve, settings, and tests are solid; MCP resolve misses the new Slack resolved-state behavior. |
| Security | 88/100 | Bot token is sealed/masked and sidecar is 0600; Slack mrkdwn is user-content-bearing but no secret leak or new auth boundary was found. |
| Architecture | 86/100 | Shared pure routing plus sidecar support match existing standalone-script constraints; one duplicated write path drifts from app behavior. |
| Conformance | 85/100 | ADR, tests, Bun tooling, and secret handling align with repo conventions; duplicated standalone logic needs parity coverage. |
| Quality | 84/100 | Good unit coverage for Slack routing/delivery/settings, but no regression test covers MCP resolve -> Slack reaction parity. |
| Dependencies | 95/100 | No dependency changes. |
| **Overall** | 82/100 | min of above |

## Findings

### 1. MCP resolve does not update Slack thread state [id: 3eef7bc0ab · confidence: 8/10]

- **Severity:** medium
- **Category:** bug
- **File:** `bin/terminal-mcp-server:1145`
- **Score impact:** correctness -13

The PR's Slack mirror contract includes resolve feedback: the app path calls `reactSlackResolved` after `resolveHitl` changes an item to resolved, which adds the configured Slack reaction using the stored `slackChannel`/`slackTs`. The MCP server exposes `resolve_hitl` as part of its write surface for in-session agents, but its standalone `resolveHitlTool` mutates `hitl.json` directly, emits Activity, and returns without calling Slack at all. A HITL item filed through the new MCP Slack mirror can therefore be resolved by an agent through MCP while the Slack triage channel still shows the original message as unresolved.

**Fix prompt:** Update `bin/terminal-mcp-server` so `resolveHitlTool` mirrors the app-side Slack resolve behavior. Keep the file standalone: read `slack.local.json`, and when `resolved && wasOpen && updated.slackChannel && updated.slackTs`, best-effort call Slack `reactions.add` with `white_check_mark`. Do not block the resolve on Slack failure. Add a regression test or script-level harness coverage for an MCP-resolved item with stored `slackChannel`/`slackTs` proving the Slack reaction API is invoked, and for missing Slack refs proving no call is made.

## Suggestions

No suggestions.

```findings-new
{
  "findings": [
    {
      "title": "MCP resolve does not update Slack thread state",
      "file": "bin/terminal-mcp-server",
      "line": 1145,
      "severity": "medium",
      "axis": "correctness",
      "category": "bug",
      "confidence": 8,
      "description": "The MCP resolve_hitl write path updates hitl.json directly and emits Activity, but unlike src/main/hitl.ts resolveHitl it never calls Slack reactions.add for items with stored slackChannel/slackTs.",
      "fix_prompt": "Update bin/terminal-mcp-server so resolveHitlTool best-effort reads slack.local.json and calls reactions.add with white_check_mark when a resolved open item has slackChannel/slackTs. Keep the resolve non-blocking on Slack failure and add script-level regression coverage."
    }
  ],
  "suggestions": []
}
```
