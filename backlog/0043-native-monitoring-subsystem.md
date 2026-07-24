---
id: 43
title: "Native Monitoring subsystem — dedicated daemon, own tab, control-plane parity, replaces check-status"
status: backlog
priority: high
horizon: next
hitl: false
type: feature
source: manual
created: 2026-07-24
updated: 2026-07-24
prs: []
refs:
  - bin/terminal-cron
  - src/main/checks.ts
  - src/main/launchd.ts
  - src/main/bridge/server.ts
depends_on: []
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

Scrap the `terminal-cli check-status` contract (ADR-0010) and the Reports "Live
checks" strip; replace with a first-class **Monitoring** subsystem. Monitoring
is deterministic infrastructure observability — NOT runs/agents/schedules and
**zero inference**. If you want automation, that's a Run/Schedule (which may
call `terminal-cli monitor` from a script).

Drop-in replacement for the standalone control-plane app (github.com/trevormil/
control-plane) — full parity so that app can be deprecated. All generic and
per-user customizable; nothing stack-specific (e.g. Kubernetes) in core.

## Decisions (locked 2026-07-24)

1. **Dedicated daemon.** New `bin/terminal-monitor` (self-contained Bun script)
   fired by its OWN launchd job `com.terminal.monitor` on a tick — separate from
   `terminal-cron`. Runs even when the desktop app is closed. Mirror the
   launchd install/reconcile machinery in `src/main/launchd.ts`.
2. **`command` check is the extensibility escape hatch.** Core ships generic
   types only: `http`, `tls-cert`, `tcp`, `dns`, `command`. Kubernetes, DOKS,
   CI, anything custom = a user-configured `command` check running their own
   script (exit code, or stdout `{status,summary,metrics}` JSON). No k8s/CI code
   in core.
3. **Sequenced AFTER the #119/#123/#124 merge** — builds on the merged inbox/
   severity/bridge; branch off `main` post-merge.

## Architecture

- **Config:** `~/.config/TerMinal/monitors.json` — array of
  `{ id, name, type, target, intervalSec, config{…per-type…},
    notify{ onFailure: severity, onRecovery: bool, dailyDigest: bool,
    digestHour, renotifyAfterSec }, group?, enabled }`.
- **State:** `~/.config/TerMinal/monitor-state/<id>.json` —
  `{ status: ok|warn|fail, summary, metrics, lastCheckedAt, since,
    lastTransition, history[] }`.
- **Daemon:** `terminal-monitor tick` runs every due check, writes state, files
  Inbox items on transitions per `notify` (reuse hitl-severity + inbox). Ongoing
  failures dedupe; `renotifyAfterSec` re-pings a still-failing check (mirrors
  control-plane's alert lifecycle). `terminal-monitor run <id>` for one check.
- **terminal-cli:** `monitor add|list|remove|status|check <id>|enable|disable`.
- **Desktop tab:** new `src/renderer/src/tabs/monitoring/` — grouped monitors,
  status dots, add/edit forms per type, latest status + history sparkline, per-
  check notify prefs. NOT under Runs/Schedules. Zero inference/agents.
- **Bridge + mobile:** `GET /v1/monitors` route; the phone's Health tab becomes
  Monitoring (read-only + enable/disable). Reuse the generic detail-sections
  rendering.

## Control-plane parity mapping

- uptime HTTP probes → core `http` checks.
- TLS cert expiry → core `tls-cert` checks.
- k8s workloads / cert-manager / CI → `command` checks (kubectl / GitHub API /
  curl control.trevormil.com) — Trevor's config, not core.
- Alert dedup + renotify → daemon transition logic + `renotifyAfterSec`.

## Acceptance criteria

- Daemon runs on its own launchd job; a check fires on its interval with the app
  closed and files an Inbox item on ok→fail (severity per notify) and fail→ok.
- All five core check types work; `command` covers an arbitrary user script.
- Per-check notify prefs honored: failure/recovery/daily-digest/renotify.
- `terminal-cli monitor …` manages monitors end-to-end.
- Desktop Monitoring tab + mobile Monitoring screen render live state; zero
  inference anywhere.
- Old `check-status` contract, `src/main/checks.ts`, Reports "Live checks"
  strip, `/v1/checks`, and the template `http-check.sh`/`fleet-health.sh` are
  removed (superseded); ADR-0010 superseded by a new ADR.
- Trevor reproduces control-plane parity via his own monitor config and
  deprecates the control-plane iOS app.

## Notes

Split into a few reviewable PRs (daemon+contract+CLI, desktop tab, bridge+mobile,
parity/migration) — do NOT recreate the #124 mega-PR. See the retro note about
branch discipline.
