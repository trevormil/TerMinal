# 10. Health checks: a status contract, not integrations

Date: 2026-07-23
Status: accepted

## Context

Monitoring/observability (uptime, certs, CI, cluster workloads) previously
lived in a separate control-plane app with its own backend, iOS client, and
APNs pipeline. Every TerMinal user has a different stack, so building
integrations (Kubernetes, Grafana, Datadog, …) into TerMinal core would be
unmaintainable sprawl. TerMinal already owns every primitive a monitoring loop
needs: scheduled agents, run history, a severity-tiered inbox with push, and
webview panels.

## Decision

TerMinal ships the **harness**; users bring the **probes**.

- `terminal-cli check-status <kind> <ok|warn|fail>` is the whole contract: a
  check script (any language, zero LLM cost) reports its state, and TerMinal
  persists it per (scope, kind) under `~/.config/TerMinal/checks/`.
- **Transitions, not states, file inbox items**: fail→`urgent`, warn→`normal`,
  recovery→`low`. An ongoing outage alerts once; a healthy check never nags.
  Daily digests are the check's own concern (`--digest` → a `normal` item).
- The app is **read-only** over these records: a Live-checks strip (Reports
  tab), `GET /v1/checks` on the bridge, and the phone's Health screen. Records
  older than 2h render stale — "I can't tell" must look different from
  "everything is fine".
- Optional `detail` is a generic `{sections: [{title, items: [{label, health,
  meta}]}]}` blob so any stack's check renders real drill-in lists on the
  phone without stack-specific UI.
- Stack-specific probes stay in user space as script agents. The shipped
  examples (`http-check.sh`, `fleet-health.sh` in the project template) cover
  the common shapes: direct probing, and polling an existing status backend.

## Consequences

- The old control-plane iOS app is deprecated in favor of TerMinal Remote; its
  backend keeps running as a data source polled by `fleet-health.sh`.
- No plugin SDK: script agents + this contract + webview panels are the
  extension surface (the capability-modules framework was already retired for
  the same reason).
- The `normal` severity tier finally has real producers (warn transitions,
  digests), making the middle notify-threshold setting meaningful.
